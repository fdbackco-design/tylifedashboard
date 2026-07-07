import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthed } from '@/lib/admin-auth';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { buildSettlementTreeRows, buildChildrenByParentFromRows, collectSubtreeMemberIdsDownstream } from '@/lib/settlement/settlement-org-tree';

type Status = 'active' | 'paused' | 'ended';

function isUuid(v: string): boolean {
  return /^[0-9a-fA-F-]{36}$/.test(v);
}

function bad(msg: string, status: number = 400): NextResponse {
  return NextResponse.json({ success: false, error: msg }, { status });
}

function toYmd(v: unknown): string {
  return String(v ?? '').slice(0, 10);
}

async function validateNoCycle(params: {
  db: ReturnType<typeof createAdminSupabaseClient>;
  memberId: string;
  parentLeaderId: string;
}): Promise<string | null> {
  // 현재 조직도 edges + 현재 설정(parent override)을 합쳐 cycle을 검사한다.
  // (월말 기준 적용은 정산에서 처리; 저장 자체는 전역 순환을 막는다.)
  const [membersRes, edgesRes, settingsRes] = await Promise.all([
    params.db
      .from('organization_members')
      .select('id,name,rank,source_customer_id')
      .eq('is_active', true),
    params.db.from('organization_edges').select('parent_id, child_id'),
    params.db
      .from('pre_issued_code_member_settings')
      .select('member_id,parent_leader_member_id,status')
      .limit(5000),
  ]);
  if (membersRes.error) return `조직원 조회 실패: ${membersRes.error.message}`;
  if (edgesRes.error) return `조직 엣지 조회 실패: ${edgesRes.error.message}`;
  if (settingsRes.error) return `코드 선발급 설정 조회 실패: ${settingsRes.error.message}`;

  const membersRaw = (membersRes.data ?? []) as any[];
  const edgesRaw = (edgesRes.data ?? []) as Array<{ parent_id: string | null; child_id: string }>;

  const override = new Map<string, string | null>();
  for (const r of (settingsRes.data ?? []) as any[]) {
    if (!r?.member_id || !r?.parent_leader_member_id) continue;
    const st = String(r.status ?? 'active') as Status;
    if (st !== 'active') continue;
    override.set(String(r.member_id), String(r.parent_leader_member_id));
  }
  // 이번 저장 요청값을 우선 적용
  override.set(params.memberId, params.parentLeaderId);

  const treeRows = buildSettlementTreeRows(
    membersRaw.map((m) => ({
      id: String(m.id),
      name: String(m.name ?? ''),
      rank: m.rank as any,
      source_customer_id: (m.source_customer_id ?? null) as string | null,
    })),
    edgesRaw,
  ).map((r) => ({
    ...r,
    parent_id: override.get(r.id) ?? r.parent_id,
  }));

  const childrenByParent = buildChildrenByParentFromRows(treeRows);
  const subtreeOfMember = collectSubtreeMemberIdsDownstream(params.memberId, childrenByParent);
  if (subtreeOfMember.has(params.parentLeaderId)) {
    return '상위리더는 하위 조직을 선택할 수 없습니다(순환 참조).';
  }
  return null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) return bad('Unauthorized', 401);
  const db = createAdminSupabaseClient();
  const sp = req.nextUrl.searchParams;
  const memberId = (sp.get('member_id') ?? '').trim();

  if (memberId) {
    if (!isUuid(memberId)) return bad('member_id는 UUID여야 합니다.');
    const { data: setting, error: sErr } = await db
      .from('pre_issued_code_member_settings')
      .select('*')
      .eq('member_id', memberId)
      .maybeSingle();
    if (sErr) return bad(sErr.message, 500);

    const { data: history, error: hErr } = await db
      .from('pre_issued_code_member_settings_audit')
      .select('id, setting_id, member_id, changed_at, changed_by, change_reason, before_json, after_json')
      .eq('member_id', memberId)
      .order('changed_at', { ascending: false })
      .limit(50);
    if (hErr) return bad(hErr.message, 500);
    return NextResponse.json({ success: true, data: { setting, history: history ?? [] } });
  }

  const { data, error } = await db
    .from('pre_issued_code_member_settings')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(5000);
  if (error) return bad(error.message, 500);
  return NextResponse.json({ success: true, data: data ?? [] });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) return bad('Unauthorized', 401);
  const db = createAdminSupabaseClient();

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return bad('Invalid JSON');
  }

  const member_id = String(body.member_id ?? '').trim();
  const parent_leader_member_id = String(body.parent_leader_member_id ?? '').trim();
  const reason = String(body.reason ?? '').trim();
  const status = (String(body.status ?? 'active') as Status).trim() as Status;
  const effective_from = toYmd(body.effective_from) || toYmd(new Date().toISOString());
  const effective_to = body.effective_to ? toYmd(body.effective_to) : null;
  const special_unit_price = Number(body.special_unit_price ?? 100000);
  const special_unit_limit = Number(body.special_unit_limit ?? 10);
  const note = body.note != null ? String(body.note) : null;
  const changed_by_raw = String(body.changed_by ?? '').trim();
  const changed_by = isUuid(changed_by_raw) ? changed_by_raw : null;
  const change_reason = String(body.change_reason ?? 'CREATED').trim() || 'CREATED';
  const change_reason_text = String(body.change_reason_text ?? '').trim() || null;

  if (!isUuid(member_id)) return bad('member_id는 UUID여야 합니다.');
  if (!isUuid(parent_leader_member_id)) return bad('parent_leader_member_id는 UUID여야 합니다.');
  if (!reason) return bad('사유(reason)는 필수입니다.');
  if (!['active', 'paused', 'ended'].includes(status)) return bad('status 값이 올바르지 않습니다.');
  if (member_id === parent_leader_member_id) return bad('상위리더는 본인과 동일할 수 없습니다.');
  if (!Number.isFinite(special_unit_price) || special_unit_price <= 0) return bad('적용단가(special_unit_price)는 0보다 커야 합니다.');
  if (!Number.isFinite(special_unit_limit) || special_unit_limit <= 0) return bad('적용구좌(special_unit_limit)는 0보다 커야 합니다.');
  if (effective_to && effective_to < effective_from) return bad('종료일은 시작일 이후여야 합니다.');

  const cycleErr = await validateNoCycle({ db, memberId: member_id, parentLeaderId: parent_leader_member_id });
  if (cycleErr) return bad(cycleErr, 400);

  const { data: before } = await db
    .from('pre_issued_code_member_settings')
    .select('*')
    .eq('member_id', member_id)
    .maybeSingle();

  const upsertPayload = {
    member_id,
    parent_leader_member_id,
    reason,
    special_unit_price: Math.round(special_unit_price),
    special_unit_limit: Math.round(special_unit_limit),
    effective_from,
    effective_to,
    status,
    note,
    updated_at: new Date().toISOString(),
    updated_by: changed_by,
  } as any;

  const { data: after, error } = await db
    .from('pre_issued_code_member_settings')
    .upsert(upsertPayload, { onConflict: 'member_id' })
    .select('*')
    .single();
  if (error) return bad(error.message, 500);

  try {
    await db.from('pre_issued_code_member_settings_audit').insert({
      setting_id: (after as any).id,
      member_id,
      changed_by,
      change_reason: change_reason_text ? `${change_reason}:${change_reason_text}` : change_reason,
      before_json: before ?? null,
      after_json: after ?? null,
    } as any);
  } catch (e) {
    console.warn('[pre-issued-code] audit insert failed', e);
  }

  return NextResponse.json({ success: true, data: after });
}

