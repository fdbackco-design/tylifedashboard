import {
  buildSettlementTreeRows,
  buildChildrenByParentFromRows,
  collectSubtreeMemberIdsDownstream,
} from '@/lib/settlement/settlement-org-tree';

type AdminDb = any; // SupabaseClient<any, 'public', any>
type Status = 'active' | 'paused' | 'ended';

function toYmd(v: unknown): string {
  return String(v ?? '').slice(0, 10);
}

async function validateNoCycle(params: {
  db: AdminDb;
  memberId: string;
  parentLeaderId: string;
}): Promise<string | null> {
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

  const override = new Map<string, string | null>();
  for (const r of (settingsRes.data ?? []) as any[]) {
    if (!r?.member_id || !r?.parent_leader_member_id) continue;
    const st = String(r.status ?? 'active') as Status;
    if (st !== 'active') continue;
    override.set(String(r.member_id), String(r.parent_leader_member_id));
  }
  override.set(params.memberId, params.parentLeaderId);

  const treeRows = buildSettlementTreeRows(
    ((membersRes.data ?? []) as any[]).map((m) => ({
      id: String(m.id),
      name: String(m.name ?? ''),
      rank: m.rank as any,
      source_customer_id: (m.source_customer_id ?? null) as string | null,
    })),
    (edgesRes.data ?? []) as any,
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

export async function promotePreIssuedPendingSettingIfPossible(params: {
  db: AdminDb;
  userProfileId: string;
  changedBy: string;
}): Promise<{ ok: boolean; promoted: boolean; message: string }> {
  const { db, userProfileId, changedBy } = params;

  const { data: pending, error: pErr } = await db
    .from('pre_issued_code_pending_settings')
    .select('*')
    .eq('user_profile_id', userProfileId)
    .maybeSingle();
  if (pErr) return { ok: false, promoted: false, message: pErr.message };
  if (!pending) return { ok: true, promoted: false, message: '예약 설정 없음' };
  if ((pending as any).promoted) return { ok: true, promoted: true, message: '이미 승격 완료' };

  const { data: profile, error: uErr } = await db
    .from('user_profiles')
    .select('id, member_id')
    .eq('id', userProfileId)
    .maybeSingle();
  if (uErr) return { ok: false, promoted: false, message: uErr.message };
  const memberId = String((profile as any)?.member_id ?? '').trim();
  if (!memberId) return { ok: true, promoted: false, message: 'member_id 매핑 대기' };

  const parentId = String((pending as any).desired_parent_leader_member_id ?? '').trim();
  if (!parentId) return { ok: false, promoted: false, message: '상위리더가 비어 있습니다.' };
  if (parentId === memberId) return { ok: false, promoted: false, message: '상위리더가 본인입니다.' };

  const cycleErr = await validateNoCycle({ db, memberId, parentLeaderId: parentId });
  if (cycleErr) {
    await db
      .from('pre_issued_code_pending_settings')
      .update({
        last_promotion_error: cycleErr,
        updated_at: new Date().toISOString(),
        updated_by: changedBy,
      })
      .eq('id', (pending as any).id);
    return { ok: false, promoted: false, message: cycleErr };
  }

  const { data: before } = await db
    .from('pre_issued_code_member_settings')
    .select('*')
    .eq('member_id', memberId)
    .maybeSingle();

  const upsertPayload = {
    member_id: memberId,
    parent_leader_member_id: parentId,
    reason: String((pending as any).reason ?? ''),
    special_unit_price: Number((pending as any).special_unit_price ?? 100000),
    special_unit_limit: Number((pending as any).special_unit_limit ?? 10),
    effective_from: toYmd((pending as any).effective_from) || toYmd(new Date().toISOString()),
    effective_to: (pending as any).effective_to ? toYmd((pending as any).effective_to) : null,
    status: String((pending as any).desired_status ?? 'active') as Status,
    note: (pending as any).note ?? null,
    updated_at: new Date().toISOString(),
    updated_by: changedBy,
  } as any;

  const { data: after, error: sErr } = await db
    .from('pre_issued_code_member_settings')
    .upsert(upsertPayload, { onConflict: 'member_id' })
    .select('*')
    .single();
  if (sErr) {
    await db
      .from('pre_issued_code_pending_settings')
      .update({
        last_promotion_error: sErr.message,
        updated_at: new Date().toISOString(),
        updated_by: changedBy,
      })
      .eq('id', (pending as any).id);
    return { ok: false, promoted: false, message: sErr.message };
  }

  try {
    await db.from('pre_issued_code_member_settings_audit').insert({
      setting_id: (after as any).id,
      member_id: memberId,
      changed_by: changedBy,
      change_reason: 'PROMOTED_FROM_PENDING',
      before_json: before ?? null,
      after_json: after ?? null,
    } as any);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[pre-issued-code][promote] member_settings audit failed', e);
  }

  await db
    .from('pre_issued_code_pending_settings')
    .update({
      promoted: true,
      promoted_at: new Date().toISOString(),
      promoted_member_id: memberId,
      promoted_setting_id: (after as any).id,
      last_promotion_error: null,
      updated_at: new Date().toISOString(),
      updated_by: changedBy,
    })
    .eq('id', (pending as any).id);

  return { ok: true, promoted: true, message: '승격 완료' };
}

