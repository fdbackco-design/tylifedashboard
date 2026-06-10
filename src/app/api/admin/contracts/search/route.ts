/**
 * GET /api/admin/contracts/search?q=<계약코드 또는 고객명 일부>&limit=20
 *
 * 정산 담당자 override UI 에서 계약을 빠르게 찾기 위한 검색 API.
 * - 계약코드 부분일치 + 고객명 부분일치 결과를 합쳐 최대 limit 개 반환
 * - 현재 sales_member / settlement_sales_member 정보까지 함께 내려준다.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthed } from '@/lib/admin-auth';
import { createAdminSupabaseClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  const limitRaw = url.searchParams.get('limit');
  const limit = Math.min(
    50,
    Math.max(1, limitRaw ? Math.floor(Number(limitRaw)) || 20 : 20),
  );

  if (!q) {
    return NextResponse.json({ results: [] });
  }

  const db = createAdminSupabaseClient();
  const selectCols = [
    'id',
    'contract_code',
    'join_date',
    'unit_count',
    'status',
    'sales_member_id',
    'settlement_sales_member_id',
    'sales_member_override_reason',
    'customer_id',
    'customers(name)',
  ].join(', ');

  const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;

  // 계약코드 일치 + 고객명 일치를 합산. supabase-js .or() 는 customers(name) 같은 join 컬럼을
  // 직접 가리키기 어려우므로 두 쿼리를 병렬로 실행하고 클라이언트에서 머지한다.
  const [byCode, byName] = await Promise.all([
    db
      .from('contracts')
      .select(selectCols)
      .ilike('contract_code', like)
      .order('join_date', { ascending: false })
      .limit(limit),
    db
      .from('contracts')
      .select(selectCols)
      .ilike('customers.name', like)
      // 위 ilike 조건이 join 측에 작용하므로 같은 select 로 한 번 더
      .order('join_date', { ascending: false })
      .limit(limit),
  ]);

  if (byCode.error) {
    return NextResponse.json({ error: byCode.error.message }, { status: 500 });
  }

  const seen = new Set<string>();
  const merged: any[] = [];
  for (const row of (byCode.data ?? []) as any[]) {
    if (!row?.id || seen.has(row.id)) continue;
    seen.add(row.id);
    merged.push(row);
  }
  if (!byName.error) {
    for (const row of (byName.data ?? []) as any[]) {
      if (!row?.id || seen.has(row.id)) continue;
      seen.add(row.id);
      merged.push(row);
    }
  }

  // 담당자 이름까지 매핑해서 내려준다.
  const memberIds = new Set<string>();
  for (const r of merged) {
    if (r.sales_member_id) memberIds.add(r.sales_member_id);
    if (r.settlement_sales_member_id) memberIds.add(r.settlement_sales_member_id);
  }
  const memberNameById = new Map<string, string>();
  if (memberIds.size > 0) {
    const { data: members } = await db
      .from('organization_members')
      .select('id, name, rank')
      .in('id', [...memberIds]);
    for (const m of (members ?? []) as any[]) {
      memberNameById.set(m.id, `${m.name}${m.rank ? ` (${m.rank})` : ''}`);
    }
  }

  const results = merged.slice(0, limit).map((r) => ({
    contract_id: r.id,
    contract_code: r.contract_code,
    join_date: r.join_date,
    unit_count: r.unit_count,
    status: r.status,
    customer_name: (r.customers?.name ?? null) as string | null,
    sales_member_id: r.sales_member_id ?? null,
    sales_member_name: r.sales_member_id ? memberNameById.get(r.sales_member_id) ?? null : null,
    settlement_sales_member_id: r.settlement_sales_member_id ?? null,
    settlement_sales_member_name: r.settlement_sales_member_id
      ? memberNameById.get(r.settlement_sales_member_id) ?? null
      : null,
    sales_member_override_reason: r.sales_member_override_reason ?? null,
  }));

  return NextResponse.json({ results });
}
