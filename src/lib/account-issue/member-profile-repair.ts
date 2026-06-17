/**
 * 동일 인물에 대한 organization_members ↔ user_profiles 정합성 회복 헬퍼.
 *
 * 배경:
 *   - customer 가 정식 영업자로 승격되는 과정에서 옛 임시 노드
 *     ("[고객] X", external_id='customer:<cid>') 와 새 노드(source_customer_id=<cid>)
 *     가 별도로 남고, user_profiles 가 옛 노드를 가리키는 부정합이 다수 발생했다.
 *
 * 본 모듈의 역할:
 *   1) 임의의 멤버 ID (또는 customer_id / phone) 를 받아 정합한 "활성 영업자 노드" 1건을 찾는다.
 *   2) user_profiles 를 자동 재매핑한다 (옛 노드 → 새 노드).
 *   3) 옛 customer-style 임시 노드를 안전 조건 충족 시 비활성화한다.
 *   4) 정합성 어긋남 케이스를 진단해 관리자 UI 에 노출한다.
 *
 * 정산 계산, 계약 저장, monthly_settlements 생성 흐름은 변경하지 않는다.
 */

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/** "010-1234-5678" → "01012345678" */
export function digitsOnlyPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  return phone.replace(/\D+/g, '');
}

/** "01012345678" → 끝 8자리 ("12345678"). user_profiles.login_code 비교용. */
export function loginDigitsFromPhone(phone: string | null | undefined): string {
  const d = digitsOnlyPhone(phone);
  if (d.length < 8) return '';
  return d.slice(-8);
}

/** user_profiles.login_code 에서 8자리 숫자만 추출한다. */
export function extractLoginCodeDigits(loginCode: string | null | undefined): string | null {
  const raw = String(loginCode ?? '').trim();
  if (!raw) return null;
  const local = raw.includes('@') ? raw.split('@')[0] : raw;
  const digits = local.replace(/\D/g, '');
  return /^\d{8}$/.test(digits) ? digits : null;
}

/**
 * login_code(8자리) → `010` + login_code 전화번호.
 * 기본 저장 형식: `010-1234-5678` (hyphenated=false 이면 `01012345678`).
 */
export function phoneFromLoginCode(
  loginCode: string | null | undefined,
  opts?: { hyphenated?: boolean },
): string | null {
  const code8 = extractLoginCodeDigits(loginCode);
  if (!code8) return null;
  const full = `010${code8}`;
  if (opts?.hyphenated === false) return full;
  return `010-${code8.slice(0, 4)}-${code8.slice(4)}`;
}

export function isMemberPhoneEmpty(phone: string | null | undefined): boolean {
  return phone == null || String(phone).trim() === '';
}

async function findLoginCodeForMemberContext(
  db: SupabaseClient,
  params: { memberId?: string | null; customerId?: string | null },
): Promise<string | null> {
  const memberId = (params.memberId ?? '').trim();
  const customerId = (params.customerId ?? '').trim();

  if (memberId) {
    const { data } = await db
      .from('user_profiles')
      .select('login_code, is_active, updated_at')
      .eq('member_id', memberId)
      .not('login_code', 'is', null)
      .order('is_active', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.login_code) return String((data as { login_code: string }).login_code);
  }

  if (customerId) {
    const { data } = await db
      .from('user_profiles')
      .select('login_code, is_active, updated_at')
      .eq('customer_id', customerId)
      .not('login_code', 'is', null)
      .order('is_active', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.login_code) return String((data as { login_code: string }).login_code);
  }

  return null;
}

/**
 * organization_members.phone 이 비어 있을 때 user_profiles.login_code 로 전화번호를 채운다.
 * (이미 phone 이 있으면 덮어쓰지 않는다.)
 */
export async function backfillMemberPhoneFromUserProfile(
  db: SupabaseClient,
  memberId: string,
): Promise<{ updated: boolean; phone: string | null }> {
  const id = (memberId ?? '').trim();
  if (!id) return { updated: false, phone: null };

  const { data: member, error: mErr } = await db
    .from('organization_members')
    .select('id, phone, source_customer_id')
    .eq('id', id)
    .maybeSingle();
  if (mErr || !member) return { updated: false, phone: null };

  const row = member as { id: string; phone: string | null; source_customer_id: string | null };
  if (!isMemberPhoneEmpty(row.phone)) return { updated: false, phone: row.phone };

  const loginCode = await findLoginCodeForMemberContext(db, {
    memberId: id,
    customerId: row.source_customer_id,
  });
  const phone = phoneFromLoginCode(loginCode);
  if (!phone) return { updated: false, phone: null };

  const { error: upErr } = await db.from('organization_members').update({ phone }).eq('id', id);
  if (upErr) {
    // eslint-disable-next-line no-console
    console.warn('[backfillMemberPhoneFromUserProfile] update failed', { memberId: id, error: upErr.message });
    return { updated: false, phone: null };
  }
  return { updated: true, phone };
}

/**
 * insert/update 직전 memberData.phone 이 비어 있으면 user_profiles.login_code 로 보강한다.
 */
export async function enrichMemberDataPhoneFromUserProfile(
  db: SupabaseClient,
  memberData: {
    phone?: string | null;
    source_customer_id?: string | null;
    external_id?: string | null;
  },
  memberId?: string | null,
): Promise<void> {
  if (!isMemberPhoneEmpty(memberData.phone)) return;
  const customerId =
    (memberData.source_customer_id ?? '').trim() ||
    customerIdFromExternalId(memberData.external_id) ||
    '';
  const loginCode = await findLoginCodeForMemberContext(db, {
    memberId: memberId ?? null,
    customerId: customerId || null,
  });
  const phone = phoneFromLoginCode(loginCode);
  if (phone) memberData.phone = phone;
}

/** 표시명 정규화: "[고객] X" → "X", 좌우 공백 제거 */
export function stripCustomerNamePrefix(name: string | null | undefined): string {
  return (name ?? '').replace(/^\[고객\]\s*/, '').trim();
}

/** "customer:<uuid>" external_id 에서 customer_id 만 뽑기 */
export function customerIdFromExternalId(externalId: string | null | undefined): string | null {
  if (!externalId) return null;
  if (!externalId.startsWith('customer:')) return null;
  const v = externalId.slice('customer:'.length);
  return v.length > 0 ? v : null;
}

export interface MemberRow {
  id: string;
  name: string | null;
  rank: string | null;
  phone: string | null;
  external_id: string | null;
  source_customer_id: string | null;
  is_active: boolean;
  created_at: string;
}

const MEMBER_SELECT = 'id, name, rank, phone, external_id, source_customer_id, is_active, created_at';

/**
 * 동일 인물의 활성 영업자 노드 후보를 찾는다.
 *
 * 매칭 기준 우선순위 (위에서 먼저 발견된 후보 1건만 채택):
 *   1) source_customer_id = customerId
 *   2) external_id = 'customer:' + customerId
 *   3) phone digits = phoneDigits (active 노드 한정)
 *   4) name 정규화 일치 + phone digits 일치
 *
 * 옛 임시 customer 노드(external_id LIKE 'customer:%' AND source_customer_id IS NULL)
 * 는 후보에서 제외한다(= "새 영업자 노드" 만 선호).
 *
 * 후보가 2건 이상이면 자동 매칭하지 않고 `'ambiguous'` 를 반환한다.
 */
export async function findActiveSalesMemberForCustomer(
  db: SupabaseClient,
  params: {
    customerId?: string | null;
    phone?: string | null;
    name?: string | null;
    /** 매칭 대상에서 제외할 멤버 ID (예: 옛 임시 노드 본인 제외) */
    excludeMemberIds?: string[];
  },
): Promise<
  | { kind: 'none' }
  | { kind: 'matched'; matchedBy: 'source_customer_id' | 'external_id' | 'phone' | 'name_phone'; member: MemberRow }
  | { kind: 'ambiguous'; candidates: MemberRow[] }
> {
  const customerId = (params.customerId ?? '').trim() || null;
  const phoneDigits = digitsOnlyPhone(params.phone);
  const normName = stripCustomerNamePrefix(params.name);
  const exclude = new Set((params.excludeMemberIds ?? []).filter(Boolean));

  const isPreferredCandidate = (m: MemberRow): boolean => {
    if (!m.is_active) return false;
    if (exclude.has(m.id)) return false;
    // "옛 임시 customer 노드" 는 후보 제외 (=새 영업자 노드 우선)
    if ((m.external_id ?? '').startsWith('customer:') && (m.source_customer_id ?? null) == null) {
      return false;
    }
    return true;
  };

  // 1) source_customer_id 일치
  if (customerId) {
    const { data, error } = await db
      .from('organization_members')
      .select(MEMBER_SELECT)
      .eq('source_customer_id', customerId);
    if (error) throw new Error(`organization_members lookup(source_customer_id) 실패: ${error.message}`);
    const rows = ((data ?? []) as MemberRow[]).filter(isPreferredCandidate);
    if (rows.length === 1) return { kind: 'matched', matchedBy: 'source_customer_id', member: rows[0] };
    if (rows.length > 1) return { kind: 'ambiguous', candidates: rows };
  }

  // 2) external_id = customer:<cid>
  if (customerId) {
    const { data, error } = await db
      .from('organization_members')
      .select(MEMBER_SELECT)
      .eq('external_id', `customer:${customerId}`);
    if (error) throw new Error(`organization_members lookup(external_id) 실패: ${error.message}`);
    const rows = ((data ?? []) as MemberRow[]).filter((m) => m.is_active && !exclude.has(m.id));
    // customer:* 노드 자체도 후보로 받되, source_customer_id 가 채워진 것을 선호한다.
    const withSource = rows.filter((m) => (m.source_customer_id ?? null) != null);
    const pool = withSource.length > 0 ? withSource : rows;
    if (pool.length === 1) return { kind: 'matched', matchedBy: 'external_id', member: pool[0] };
    if (pool.length > 1) return { kind: 'ambiguous', candidates: pool };
  }

  // 3) phone digits 일치 (rank '본사' 제외)
  if (phoneDigits) {
    const { data, error } = await db
      .from('organization_members')
      .select(MEMBER_SELECT)
      .eq('is_active', true);
    if (error) throw new Error(`organization_members lookup(active) 실패: ${error.message}`);
    const rows = ((data ?? []) as MemberRow[])
      .filter(isPreferredCandidate)
      .filter((m) => m.rank !== '본사')
      .filter((m) => digitsOnlyPhone(m.phone) === phoneDigits);
    if (rows.length === 1) return { kind: 'matched', matchedBy: 'phone', member: rows[0] };
    if (rows.length > 1) {
      // 4) name + phone 결합으로 한 번 더 좁혀본다.
      if (normName) {
        const narrowed = rows.filter((m) => stripCustomerNamePrefix(m.name) === normName);
        if (narrowed.length === 1) return { kind: 'matched', matchedBy: 'name_phone', member: narrowed[0] };
      }
      return { kind: 'ambiguous', candidates: rows };
    }
  }

  return { kind: 'none' };
}

/**
 * user_profiles 한 행을 새 멤버 ID 로 재매핑한다.
 * - member_id 갱신
 * - display_name 의 "[고객] " 접두어 제거
 * - updated_at = now()
 */
export async function repairUserProfileMembership(
  db: SupabaseClient,
  params: { profileId: string; newMemberId: string },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const profileId = (params.profileId ?? '').trim();
  const newMemberId = (params.newMemberId ?? '').trim();
  if (!profileId || !newMemberId) {
    return { ok: false, message: 'profileId / newMemberId 가 필요합니다.' };
  }
  // 현재 display_name 을 읽어 정규화한 값으로 갱신한다 (SQL REPLACE 보다 안전).
  const { data: cur, error: selErr } = await db
    .from('user_profiles')
    .select('id, display_name')
    .eq('id', profileId)
    .maybeSingle();
  if (selErr) return { ok: false, message: selErr.message };
  if (!cur) return { ok: false, message: 'user_profiles 행을 찾을 수 없습니다.' };
  const cleanName = stripCustomerNamePrefix((cur as { display_name?: string | null }).display_name);
  const { error: upErr } = await db
    .from('user_profiles')
    .update({
      member_id: newMemberId,
      display_name: cleanName || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', profileId);
  if (upErr) return { ok: false, message: upErr.message };
  await backfillMemberPhoneFromUserProfile(db, newMemberId);
  return { ok: true };
}

/**
 * 특정 영업자 멤버에 대해 user_profiles 매핑이 어긋나 있다면 자동 재매핑한다.
 *
 * 트리거 조건 (다음 중 하나라도 만족하는 user_profiles 가 있으면 → newMemberId 로 갱신):
 *   (a) user_profiles.member_id = 옛 customer-style 임시 노드 ID (= 동일 customer_id 의 임시 노드)
 *   (b) user_profiles.customer_id = newMember.source_customer_id  (이미 같은 customer 를 가리킴)
 *   (c) user_profiles.login_code = newMember.phone 의 끝 8자리
 *
 * 단, 후보 user_profiles 가 여러 개면 자동 매칭 위험이 있으므로 ambiguous 만 반환.
 *
 * @returns 어떤 작업이 일어났는지 요약. UI 표시·로깅용.
 */
export async function reconcileUserProfileForActiveMember(
  db: SupabaseClient,
  newMember: Pick<MemberRow, 'id' | 'source_customer_id' | 'phone'>,
): Promise<{
  repairedProfileIds: string[];
  ambiguousProfileIds: string[];
  reason: string;
}> {
  const newMemberId = newMember.id;
  const customerId = (newMember.source_customer_id ?? '').trim() || null;
  const loginDigits = loginDigitsFromPhone(newMember.phone);

  // 1) 같은 customer_id 를 가진 옛 임시 노드 ID 들 (제외 = newMemberId)
  const legacyMemberIds: string[] = [];
  if (customerId) {
    const { data: legacyRows } = await db
      .from('organization_members')
      .select('id, external_id, source_customer_id')
      .or(`external_id.eq.customer:${customerId},source_customer_id.eq.${customerId}`);
    for (const m of ((legacyRows ?? []) as Array<{ id: string; external_id: string | null; source_customer_id: string | null }>)) {
      if (m.id === newMemberId) continue;
      legacyMemberIds.push(m.id);
    }
  }

  // 2) 매핑 어긋난 user_profiles 후보 수집
  const profileIds = new Set<string>();
  const orClauses: string[] = [];
  if (customerId) orClauses.push(`customer_id.eq.${customerId}`);
  if (loginDigits) orClauses.push(`login_code.eq.${loginDigits}`);
  if (legacyMemberIds.length > 0) {
    const inExpr = `(${legacyMemberIds.join(',')})`;
    orClauses.push(`member_id.in.${inExpr}`);
  }
  if (orClauses.length === 0) {
    return { repairedProfileIds: [], ambiguousProfileIds: [], reason: '재매핑 신호 없음' };
  }

  const { data: profileRows, error: pErr } = await db
    .from('user_profiles')
    .select('id, member_id, customer_id, login_code, display_name, is_active')
    .or(orClauses.join(','));
  if (pErr) {
    return { repairedProfileIds: [], ambiguousProfileIds: [], reason: `user_profiles 조회 실패: ${pErr.message}` };
  }

  for (const r of ((profileRows ?? []) as Array<{ id: string; member_id: string | null }>)) {
    if (r.member_id === newMemberId) continue; // 이미 정상 매핑
    profileIds.add(r.id);
  }

  if (profileIds.size === 0) {
    return { repairedProfileIds: [], ambiguousProfileIds: [], reason: '재매핑 대상 없음' };
  }
  if (profileIds.size > 1) {
    return {
      repairedProfileIds: [],
      ambiguousProfileIds: Array.from(profileIds),
      reason: '재매핑 후보가 2개 이상이라 자동 매칭하지 않음',
    };
  }

  const profileId = Array.from(profileIds)[0];
  const res = await repairUserProfileMembership(db, { profileId, newMemberId });
  if (!res.ok) {
    return {
      repairedProfileIds: [],
      ambiguousProfileIds: [profileId],
      reason: `재매핑 실패: ${res.message}`,
    };
  }
  return { repairedProfileIds: [profileId], ambiguousProfileIds: [], reason: '자동 재매핑 완료' };
}

/**
 * 특정 멤버를 비활성화해도 안전한지 검사한다. (참조가 모두 새 멤버로 이동했거나 0건일 때만 안전)
 */
export async function isLegacyMemberSafeToDeactivate(
  db: SupabaseClient,
  legacyMemberId: string,
): Promise<{ safe: boolean; references: Record<string, number> }> {
  const counts: Record<string, number> = {};

  const checks: Array<{ key: string; table: string; column: string }> = [
    { key: 'contracts.sales_member_id', table: 'contracts', column: 'sales_member_id' },
    { key: 'contracts.contractor_member_id', table: 'contracts', column: 'contractor_member_id' },
    { key: 'contracts.settlement_sales_member_id', table: 'contracts', column: 'settlement_sales_member_id' },
    { key: 'organization_edges.parent_id', table: 'organization_edges', column: 'parent_id' },
    { key: 'organization_edges.child_id', table: 'organization_edges', column: 'child_id' },
    { key: 'user_profiles.member_id', table: 'user_profiles', column: 'member_id' },
  ];

  for (const c of checks) {
    const { count } = await db
      .from(c.table)
      .select('id', { count: 'exact', head: true })
      .eq(c.column, legacyMemberId);
    counts[c.key] = Number(count ?? 0);
  }

  // monthly_settlements 는 0/0 인 빈 행은 무시 (이미 마이그레이션에서 정리한 패턴과 동일)
  const { data: msRows } = await db
    .from('monthly_settlements')
    .select('id, direct_unit_count, total_amount')
    .eq('member_id', legacyMemberId);
  const nonzeroSettlements = ((msRows ?? []) as Array<{ direct_unit_count: number | null; total_amount: number | null }>).filter(
    (r) => Number(r.direct_unit_count ?? 0) !== 0 || Number(r.total_amount ?? 0) !== 0,
  );
  counts['monthly_settlements.nonzero'] = nonzeroSettlements.length;

  const safe = Object.values(counts).every((n) => n === 0);
  return { safe, references: counts };
}

/**
 * 같은 customer 의 옛 임시 customer-style 노드를 안전 조건 충족 시 비활성화한다.
 *
 * 안전 조건: `isLegacyMemberSafeToDeactivate` 가 safe=true.
 * 안전하지 않으면 그대로 두고 referenceCounts 만 반환 (호출자가 진단 UI 에 노출 가능).
 */
export async function deactivateLegacyCustomerNodesIfSafe(
  db: SupabaseClient,
  params: { customerId: string; keepMemberId: string },
): Promise<{
  deactivatedMemberIds: string[];
  skipped: Array<{ memberId: string; references: Record<string, number> }>;
}> {
  const customerId = (params.customerId ?? '').trim();
  const keepMemberId = (params.keepMemberId ?? '').trim();
  if (!customerId || !keepMemberId) {
    return { deactivatedMemberIds: [], skipped: [] };
  }

  const { data: legacyRows } = await db
    .from('organization_members')
    .select('id, external_id, source_customer_id, is_active')
    .or(`external_id.eq.customer:${customerId},source_customer_id.eq.${customerId}`);

  const candidates = ((legacyRows ?? []) as Array<{
    id: string;
    external_id: string | null;
    source_customer_id: string | null;
    is_active: boolean;
  }>).filter((m) => {
    if (m.id === keepMemberId) return false;
    if (!m.is_active) return false;
    // 옛 임시 노드만 대상으로 한다 (= external_id 가 customer:* 인 행).
    // source_customer_id 가 채워진 또 다른 정상 노드는 자동 비활성화 대상에서 제외.
    return (m.external_id ?? '').startsWith('customer:');
  });

  const deactivated: string[] = [];
  const skipped: Array<{ memberId: string; references: Record<string, number> }> = [];

  for (const m of candidates) {
    const safety = await isLegacyMemberSafeToDeactivate(db, m.id);
    if (!safety.safe) {
      skipped.push({ memberId: m.id, references: safety.references });
      continue;
    }
    // 빈 monthly_settlements 행 정리 후 비활성화
    await db
      .from('monthly_settlements')
      .delete()
      .eq('member_id', m.id)
      .eq('direct_unit_count', 0)
      .eq('total_amount', 0);
    const { error } = await db
      .from('organization_members')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', m.id);
    if (!error) deactivated.push(m.id);
  }

  return { deactivatedMemberIds: deactivated, skipped };
}

/**
 * 한 영업자 멤버 단위의 정합성 회복 절차 (sync-service/계정 발급 등에서 사용).
 *
 *  1) 해당 멤버의 source_customer_id 가 채워져 있고
 *  2) user_profiles 매핑 어긋남이 있다면 자동 재매핑
 *  3) 옛 customer 임시 노드는 안전 조건 충족 시 비활성화
 *
 * 본 함수는 best-effort 이며 실패해도 throw 하지 않는다 (sync 전체 실패를 막기 위해).
 */
export async function repairMemberProfileIntegrity(
  db: SupabaseClient,
  memberId: string,
): Promise<void> {
  try {
    const { data: m } = await db
      .from('organization_members')
      .select(MEMBER_SELECT)
      .eq('id', memberId)
      .maybeSingle();
    if (!m) return;
    const member = m as MemberRow;
    if (!member.is_active) return;
    // 본사 노드는 정합성 회복 대상이 아님
    if (member.rank === '본사') return;

    await reconcileUserProfileForActiveMember(db, {
      id: member.id,
      source_customer_id: member.source_customer_id,
      phone: member.phone,
    });

    if (member.source_customer_id) {
      await deactivateLegacyCustomerNodesIfSafe(db, {
        customerId: member.source_customer_id,
        keepMemberId: member.id,
      });
    }

    await backfillMemberPhoneFromUserProfile(db, memberId);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[repairMemberProfileIntegrity] best-effort 실패', {
      memberId,
      error: (e as Error).message,
    });
  }
}

/* ───────────────────────────────────────────────────────────
 * 진단 (관리자 UI 표시용)
 * ─────────────────────────────────────────────────────────── */

export interface DiagnosticsResult {
  /** 정산 데이터가 있는데 user_profiles.login_code 가 없는 영업자 */
  noProfileButHasSettlement: Array<{
    member: MemberRow;
    settlementTotal: number;
    settlementYearMonth: string | null;
  }>;
  /** user_profiles 가 비활성/옛 고객 노드를 가리키는 영업자 (active 멤버 기준) */
  profilePointsToLegacyMember: Array<{
    profileId: string;
    profileMemberId: string;
    profileMemberName: string | null;
    activeMember: MemberRow;
    profileLoginCode: string | null;
    profileDisplayName: string | null;
  }>;
  /** 동일 phone 을 가진 active member 중복 (본사 제외) */
  duplicateActivePhones: Array<{
    phoneDigits: string;
    members: MemberRow[];
  }>;
  /** "[고객]" prefix 가 남아 있는 활성 영업자 노드 */
  legacyPrefixActiveMembers: MemberRow[];
}

/**
 * /admin/settlement_sheet 페이지에 표시할 진단 정보를 모은다.
 */
export async function diagnoseMemberProfileIntegrity(
  db: SupabaseClient,
  options?: { yearMonth?: string },
): Promise<DiagnosticsResult> {
  // (a) 정산 데이터 있는데 login_code 가 없는 영업자
  const { data: msRows } = await db
    .from('monthly_settlements')
    .select('member_id, year_month, direct_unit_count, total_amount');
  const settlementByMember = new Map<string, { year_month: string; total: number }>();
  for (const r of ((msRows ?? []) as Array<{
    member_id: string;
    year_month: string;
    direct_unit_count: number | null;
    total_amount: number | null;
  }>)) {
    const isNonzero = Number(r.direct_unit_count ?? 0) !== 0 || Number(r.total_amount ?? 0) !== 0;
    if (!isNonzero) continue;
    const cur = settlementByMember.get(r.member_id);
    if (!cur || r.year_month > cur.year_month) {
      settlementByMember.set(r.member_id, { year_month: r.year_month, total: Number(r.total_amount ?? 0) });
    }
  }
  const settlementMemberIds = Array.from(settlementByMember.keys());

  let allMembers: MemberRow[] = [];
  if (settlementMemberIds.length > 0) {
    const { data } = await db
      .from('organization_members')
      .select(MEMBER_SELECT)
      .in('id', settlementMemberIds);
    allMembers = ((data ?? []) as MemberRow[]);
  }

  let profilesByMemberId: Map<string, { login_code: string | null }> = new Map();
  if (settlementMemberIds.length > 0) {
    const { data: profileRows } = await db
      .from('user_profiles')
      .select('member_id, login_code, is_active, updated_at')
      .in('member_id', settlementMemberIds)
      .order('is_active', { ascending: false })
      .order('updated_at', { ascending: false });
    for (const p of ((profileRows ?? []) as Array<{
      member_id: string | null;
      login_code: string | null;
    }>)) {
      if (!p.member_id) continue;
      if (!profilesByMemberId.has(p.member_id)) {
        profilesByMemberId.set(p.member_id, { login_code: p.login_code ?? null });
      }
    }
  }

  const noProfileButHasSettlement = allMembers
    .filter((m) => m.is_active && m.rank !== '본사')
    .filter((m) => {
      const p = profilesByMemberId.get(m.id);
      return !p || !p.login_code;
    })
    .map((m) => {
      const s = settlementByMember.get(m.id);
      return {
        member: m,
        settlementTotal: s?.total ?? 0,
        settlementYearMonth: s?.year_month ?? null,
      };
    });

  // (b) user_profiles 가 비활성/옛 고객 노드를 가리키는 영업자 (active 영업자 기준)
  // → user_profiles.member_id 가 inactive 멤버 또는 customer-only 노드를 가리키는 케이스
  const { data: brokenProfileRows } = await db
    .from('user_profiles')
    .select('id, member_id, customer_id, display_name, login_code, is_active')
    .not('member_id', 'is', null);
  const brokenProfileList = ((brokenProfileRows ?? []) as Array<{
    id: string;
    member_id: string;
    customer_id: string | null;
    display_name: string | null;
    login_code: string | null;
    is_active: boolean | null;
  }>);

  const profilePointsToLegacyMember: DiagnosticsResult['profilePointsToLegacyMember'] = [];
  if (brokenProfileList.length > 0) {
    const targetMemberIds = Array.from(new Set(brokenProfileList.map((p) => p.member_id)));
    const { data: targetMembers } = await db
      .from('organization_members')
      .select(MEMBER_SELECT)
      .in('id', targetMemberIds);
    const memberById = new Map(((targetMembers ?? []) as MemberRow[]).map((m) => [m.id, m]));
    for (const p of brokenProfileList) {
      const m = memberById.get(p.member_id);
      if (!m) continue;
      const looksLegacy =
        !m.is_active ||
        ((m.external_id ?? '').startsWith('customer:') && (m.source_customer_id ?? null) == null) ||
        (m.name ?? '').startsWith('[고객]');
      if (!looksLegacy) continue;

      const lookup = await findActiveSalesMemberForCustomer(db, {
        customerId: p.customer_id,
        phone: m.phone,
        name: m.name,
        excludeMemberIds: [m.id],
      });
      if (lookup.kind !== 'matched') continue;
      profilePointsToLegacyMember.push({
        profileId: p.id,
        profileMemberId: p.member_id,
        profileMemberName: m.name,
        activeMember: lookup.member,
        profileLoginCode: p.login_code,
        profileDisplayName: p.display_name,
      });
    }
  }

  // (c) 동일 phone 가진 active 멤버 중복 (본사 제외)
  const { data: activeRows } = await db
    .from('organization_members')
    .select(MEMBER_SELECT)
    .eq('is_active', true);
  const activeList = ((activeRows ?? []) as MemberRow[]).filter((m) => m.rank !== '본사');
  const phoneBucket = new Map<string, MemberRow[]>();
  for (const m of activeList) {
    const d = digitsOnlyPhone(m.phone);
    if (!d || d.length < 8) continue;
    const arr = phoneBucket.get(d) ?? [];
    arr.push(m);
    phoneBucket.set(d, arr);
  }
  const duplicateActivePhones: DiagnosticsResult['duplicateActivePhones'] = [];
  for (const [phoneDigits, members] of phoneBucket.entries()) {
    if (members.length > 1) duplicateActivePhones.push({ phoneDigits, members });
  }

  // (d) "[고객]" prefix 가 남아 있는 활성 영업자 노드
  const legacyPrefixActiveMembers = activeList.filter((m) => (m.name ?? '').startsWith('[고객]'));

  void options;
  return {
    noProfileButHasSettlement,
    profilePointsToLegacyMember,
    duplicateActivePhones,
    legacyPrefixActiveMembers,
  };
}
