import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function isAuthorized(req: NextRequest): boolean {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;

  const token = authHeader.slice(7);
  const secret = process.env.SYNC_API_SECRET;
  if (!secret) return false;

  const encoder = new TextEncoder();
  const a = encoder.encode(token);
  const b = encoder.encode(secret);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

type BackfillRequest = {
  limit?: number;
  /** true면 이미 customer edge가 있는 대상은 스킵 */
  only_missing?: boolean;
  /** 특정 고객명만 처리(디버그 용) */
  customer_name?: string;
};

async function getHqMemberId(db: ReturnType<(typeof import('@/lib/supabase/server'))['createAdminSupabaseClient']>): Promise<string | null> {
  const { data } = await db
    .from('organization_members')
    .select('id')
    .eq('name', '안성준')
    .limit(1)
    .maybeSingle();
  if (data) return (data as { id: string }).id;

  const { data: hq } = await db
    .from('organization_members')
    .select('id')
    .eq('rank', '본사')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return hq ? (hq as { id: string }).id : null;
}

async function findSingleEmployeeMemberIdByName(
  db: ReturnType<(typeof import('@/lib/supabase/server'))['createAdminSupabaseClient']>,
  name: string,
): Promise<string | null> {
  const n = name.trim();
  if (!n) return null;
  const { data, error } = await db
    .from('organization_members')
    .select('id, rank')
    .eq('name', n)
    .is('external_id', null)
    .neq('rank', '본사')
    .order('created_at', { ascending: true })
    .limit(2);
  if (error) throw new Error(`organization_members 조회 실패: ${error.message}`);
  const rows = (data ?? []) as Array<{ id: string; rank: string }>;
  if (rows.length !== 1) return null;
  return rows[0].id;
}

async function attachCustomerIdentityToMember(
  db: ReturnType<(typeof import('@/lib/supabase/server'))['createAdminSupabaseClient']>,
  memberId: string,
  customer: { id: string; phone: string | null },
): Promise<void> {
  const { data: cur, error } = await db
    .from('organization_members')
    .select('id, source_customer_id, phone, rank')
    .eq('id', memberId)
    .maybeSingle();
  if (error) throw new Error(`organization_members 조회 실패: ${error.message}`);
  if (!cur) return;
  if ((cur as any).rank === '본사') return;

  const next: Record<string, unknown> = {};
  if ((cur as any).source_customer_id == null) next.source_customer_id = customer.id;
  if (((cur as any).phone == null || String((cur as any).phone).trim() === '') && customer.phone) next.phone = customer.phone;
  if (Object.keys(next).length === 0) return;

  const { error: upErr } = await db.from('organization_members').update(next).eq('id', memberId);
  if (upErr) throw new Error(`organization_members 업데이트 실패: ${upErr.message}`);
}

async function ensureOrgEdgeWithSource(
  db: ReturnType<(typeof import('@/lib/supabase/server'))['createAdminSupabaseClient']>,
  parentId: string,
  childId: string,
  sourceContractId: string,
  createdBy: string,
): Promise<{ created: boolean; edge_id: string }> {
  const { data: existing, error: exErr } = await db
    .from('organization_edges')
    .select('id, parent_id')
    .eq('child_id', childId)
    .maybeSingle();
  if (exErr) throw new Error(`organization_edges 조회 실패: ${exErr.message}`);

  if (existing) {
    const ex = existing as { id: string; parent_id: string | null };
    if (ex.parent_id && ex.parent_id !== parentId) {
      return { created: false, edge_id: ex.id };
    }
    await db.from('organization_edge_sources').upsert(
      { edge_id: ex.id, source_contract_id: sourceContractId, created_by: createdBy },
      { onConflict: 'edge_id,source_contract_id' },
    );
    return { created: false, edge_id: ex.id };
  }

  const { data: ins, error: insErr } = await db
    .from('organization_edges')
    .insert({ parent_id: parentId, child_id: childId })
    .select('id')
    .single();
  if (insErr) throw new Error(`organization_edges 생성 실패: ${insErr.message}`);
  const edgeId = (ins as { id: string }).id;
  await db.from('organization_edge_sources').upsert(
    { edge_id: edgeId, source_contract_id: sourceContractId, created_by: createdBy },
    { onConflict: 'edge_id,source_contract_id' },
  );
  return { created: true, edge_id: edgeId };
}

async function ensureOrgEdgeForceParentWithSource(
  db: ReturnType<(typeof import('@/lib/supabase/server'))['createAdminSupabaseClient']>,
  parentId: string,
  childId: string,
  sourceContractId: string,
  createdBy: string,
): Promise<{ edge_id: string }> {
  if (parentId === childId) {
    // self-loop 금지
    return { edge_id: '' };
  }

  // cycle 방지(간단 parent-chain 검사)
  const visited = new Set<string>();
  let cur: string | null = parentId;
  while (cur) {
    if (cur === childId) {
      return { edge_id: '' };
    }
    if (visited.has(cur)) break;
    visited.add(cur);
    const { data: parentRow } = (await db
      .from('organization_edges')
      .select('parent_id')
      .eq('child_id', cur)
      .maybeSingle()) as { data: { parent_id: string | null } | null };
    cur = parentRow ? ((parentRow as { parent_id: string | null }).parent_id as string | null) : null;
  }

  const { data: edge, error } = await db
    .from('organization_edges')
    .upsert({ parent_id: parentId, child_id: childId }, { onConflict: 'child_id' })
    .select('id')
    .single();
  if (error) throw new Error(`organization_edges upsert 실패: ${error.message}`);
  const edgeId = (edge as { id: string }).id;
  await db.from('organization_edge_sources').upsert(
    { edge_id: edgeId, source_contract_id: sourceContractId, created_by: createdBy },
    { onConflict: 'edge_id,source_contract_id' },
  );
  return { edge_id: edgeId };
}

async function ensureCustomerMemberId(params: {
  db: ReturnType<(typeof import('@/lib/supabase/server'))['createAdminSupabaseClient']>;
  customer: { id: string; name: string; phone: string | null };
}): Promise<{ member_id: string | null; created: boolean; reused_employee: boolean }> {
  const { db, customer } = params;
  const customerName = (customer.name ?? '').trim();
  if (!customerName) return { member_id: null, created: false, reused_employee: false };
  if (customerName.replace(/^\[고객\]\s*/, '') === '안성준') return { member_id: null, created: false, reused_employee: false };

  // 1) source_customer_id 우선
  const { data: bySource } = await db
    .from('organization_members')
    .select('id')
    .eq('source_customer_id', customer.id)
    .neq('rank', '본사')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (bySource) return { member_id: (bySource as { id: string }).id, created: false, reused_employee: false };

  // 2) external_id=customer:{id}
  const { data: byExt } = await db
    .from('organization_members')
    .select('id')
    .eq('external_id', `customer:${customer.id}`)
    .neq('rank', '본사')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (byExt) return { member_id: (byExt as { id: string }).id, created: false, reused_employee: false };

  // 3) 동일 이름의 직원 노드가 단 1개면 재사용 + identity 부여
  const existingEmployeeId = await findSingleEmployeeMemberIdByName(db, customerName);
  if (existingEmployeeId) {
    await attachCustomerIdentityToMember(db, existingEmployeeId, { id: customer.id, phone: customer.phone });
    return { member_id: existingEmployeeId, created: false, reused_employee: true };
  }

  // 4) 없으면 customer 노드 생성
  const displayName = customerName.startsWith('[고객] ') ? customerName : `[고객] ${customerName}`;
  const { data: ins, error } = await db
    .from('organization_members')
    .insert({
      name: displayName,
      rank: '영업사원',
      external_id: `customer:${customer.id}`,
      phone: customer.phone,
      is_active: true,
      source_customer_id: customer.id,
    } as any)
    .select('id')
    .single();
  if (error) throw new Error(`customer organization_member 생성 실패: ${error.message}`);
  return { member_id: (ins as { id: string }).id, created: true, reused_employee: false };
}

async function runBackfill(params: {
  db: ReturnType<(typeof import('@/lib/supabase/server'))['createAdminSupabaseClient']>;
  limit: number;
  only_missing: boolean;
  customer_name?: string;
  apply: boolean;
}): Promise<any> {
  const { db, limit, only_missing, customer_name, apply } = params;
  const hqId = await getHqMemberId(db);
  if (!hqId) throw new Error('본사(HQ) 멤버 id를 찾지 못했습니다.');

  // 최신 linked 계약 기준으로 customer->sales를 확정한다.
  const q = db
    .from('contracts')
    .select('id, customer_id, sales_member_id, join_date, created_at, sales_link_status')
    .eq('sales_link_status', 'linked')
    .not('sales_member_id', 'is', null)
    .order('join_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  const { data: contractRows, error: cErr } = await q;
  if (cErr) throw new Error(`contracts 조회 실패: ${cErr.message}`);

  const latestByCustomerId = new Map<string, { contract_id: string; sales_member_id: string }>();
  for (const r of (contractRows ?? []) as any[]) {
    const cid = r.customer_id as string | null;
    const sid = r.sales_member_id as string | null;
    if (!cid || !sid) continue;
    if (!latestByCustomerId.has(cid)) {
      latestByCustomerId.set(cid, { contract_id: r.id as string, sales_member_id: sid });
    }
  }

  const customerIds = [...latestByCustomerId.keys()];
  const { data: customers, error: cuErr } = await db
    .from('customers')
    .select('id, name, phone')
    .in('id', customerIds);
  if (cuErr) throw new Error(`customers 조회 실패: ${cuErr.message}`);
  const customerById = new Map<string, { id: string; name: string; phone: string | null }>();
  for (const c of (customers ?? []) as any[]) {
    customerById.set(c.id as string, { id: c.id as string, name: c.name as string, phone: (c.phone ?? null) as string | null });
  }

  const targets: Array<{
    customer: { id: string; name: string; phone: string | null };
    contract_id: string;
    sales_member_id: string;
  }> = [];

  for (const [cid, v] of latestByCustomerId.entries()) {
    const customer = customerById.get(cid) ?? null;
    if (!customer) continue;
    if (customer_name && customer.name !== customer_name) continue;
    targets.push({ customer, contract_id: v.contract_id, sales_member_id: v.sales_member_id });
  }

  const report = {
    apply,
    limit,
    only_missing,
    hq_id: hqId,
    scanned_contract_rows: (contractRows ?? []).length,
    target_customers: targets.length,
    created_customer_members: 0,
    reused_employee_members: 0,
    created_sales_hq_edges: 0,
    created_or_updated_customer_sales_edges: 0,
    skipped_existing_customer_edges: 0,
    skipped_cycle_or_self_loop: 0,
    items: [] as any[],
  };

  for (const t of targets) {
    const item: any = {
      customer_id: t.customer.id,
      customer_name: t.customer.name,
      sales_member_id: t.sales_member_id,
      source_contract_id: t.contract_id,
      will_create_sales_hq_edge: false,
      will_set_customer_sales_edge: false,
      notes: [] as string[],
    };

    if (!apply) {
      item.will_create_sales_hq_edge = true;
      item.will_set_customer_sales_edge = true;
      report.items.push(item);
      continue;
    }

    // 1) customer member 확보
    const cm = await ensureCustomerMemberId({ db, customer: t.customer });
    if (!cm.member_id) {
      item.notes.push('customer member 생성/재사용 실패(이름 없음 또는 본사 고객)');
      report.items.push(item);
      continue;
    }
    if (cm.created) report.created_customer_members += 1;
    if (cm.reused_employee) report.reused_employee_members += 1;
    const customerMemberId = cm.member_id;

    // 2) sales -> HQ 폴백 (없을 때만)
    const resSales = await ensureOrgEdgeWithSource(
      db,
      hqId,
      t.sales_member_id,
      t.contract_id,
      'org-backfill',
    );
    if (resSales.created) report.created_sales_hq_edges += 1;

    // 3) customer -> sales (최신 linked 계약 담당자로 force)
    if (only_missing) {
      const { data: ex } = await db
        .from('organization_edges')
        .select('id, parent_id')
        .eq('child_id', customerMemberId)
        .maybeSingle();
      if (ex && (ex as any).parent_id != null) {
        report.skipped_existing_customer_edges += 1;
        item.notes.push('customer edge 이미 존재(only_missing 스킵)');
        report.items.push(item);
        continue;
      }
    }

    const r = await ensureOrgEdgeForceParentWithSource(
      db,
      t.sales_member_id,
      customerMemberId,
      t.contract_id,
      'org-backfill',
    );
    if (!r.edge_id) {
      report.skipped_cycle_or_self_loop += 1;
      item.notes.push('cycle/self-loop 방지로 customer edge 스킵');
    } else {
      report.created_or_updated_customer_sales_edges += 1;
    }
    report.items.push(item);
  }

  return report;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (process.env.VERCEL !== '1') return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const limit = Math.max(1, Math.min(5000, parseInt(url.searchParams.get('limit') ?? '500', 10) || 500));
  const only_missing = (url.searchParams.get('only_missing') ?? 'true') !== 'false';
  const customer_name = (url.searchParams.get('customer_name') ?? '').trim() || undefined;

  const { createAdminSupabaseClient } = await import('@/lib/supabase/server');
  const db = createAdminSupabaseClient();

  try {
    const report = await runBackfill({ db, limit, only_missing, customer_name, apply: false });
    return NextResponse.json({ success: true, dry_run: true, report });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (process.env.VERCEL !== '1') return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: BackfillRequest = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const limit = Math.max(1, Math.min(5000, Number(body.limit ?? 500) || 500));
  const only_missing = body.only_missing ?? true;
  const customer_name = (body.customer_name ?? '').trim() || undefined;

  const { createAdminSupabaseClient } = await import('@/lib/supabase/server');
  const db = createAdminSupabaseClient();

  try {
    const report = await runBackfill({ db, limit, only_missing, customer_name, apply: true });
    return NextResponse.json({ success: true, report });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

