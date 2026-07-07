/**
 * 사전 발급 계정(user_profiles.mapping_status = 'PENDING') 을 TY 동기화로 들어온
 * 사람 데이터(organization_members + customers) 와 자동으로 매핑한다.
 *
 * 매칭 우선순위 (보수적 — 불확실하면 절대 자동 매핑하지 않고 MANUAL_REVIEW):
 *   1) 고객명 + 전화번호 완전 일치 (organization_members 의 customer 가상노드 OR customers 행)
 *   2) 담당자명 단일 후보 (organization_members 의 영업/리더/센터장/사업본부장 등 비-본사 직원)
 *   3) 고객명 후보와 담당자명 후보가 동시에 존재하는 충돌은 MANUAL_REVIEW
 *
 * 자동 매핑 금지 케이스 (모두 MANUAL_REVIEW):
 *   - 같은 이름의 PENDING 계정이 2개 이상
 *   - 같은 이름의 후보 사람이 2명 이상
 *   - 이미 다른 user_profiles 에 매핑된 사람(member_id)
 *   - 고객명 매칭에서 전화번호가 없거나 다름
 *   - 이름이 고객명 + 담당자명 양쪽에서 모두 발견됨
 *
 * 매핑은 service_role(adminDb) 로 수행한다.
 */

import { isSameNormalizedName, normalizeName, normalizePhone } from './normalize';
import { promotePreIssuedPendingSettingIfPossible } from '@/lib/pre-issued/pending-promote';

type AdminDb = any; // SupabaseClient<any, 'public', any> 캐스팅 회피용

const CUSTOMER_RANKS_FOR_NAME_MATCH = new Set([
  '영업사원',
  '리더',
  '센터장',
  '사업본부장',
]);

export type AutoMappingReason =
  | 'CUSTOMER_NAME_AND_PHONE_MATCHED'
  | 'MANAGER_NAME_SINGLE_CANDIDATE_MATCHED'
  | 'CUSTOMER_PHONE_NOT_MATCHED'
  | 'CUSTOMER_PHONE_MISSING'
  | 'MULTIPLE_CUSTOMER_CANDIDATES'
  | 'MULTIPLE_MANAGER_CANDIDATES'
  | 'MULTIPLE_PENDING_USERS'
  | 'PERSON_ALREADY_MAPPED'
  | 'CUSTOMER_AND_MANAGER_NAME_CONFLICT'
  | 'NO_CANDIDATE'
  | 'UNCERTAIN_MATCH';

export type AutoMappingCandidateType =
  | 'CUSTOMER_NAME'
  | 'MANAGER_NAME'
  | 'CONFLICT'
  | 'NONE';

export interface AutoMappingDecision {
  user_profile_id: string;
  mapping_status: 'MATCHED' | 'MANUAL_REVIEW' | 'PENDING';
  member_id: string | null;
  matched_by: 'AUTO_SYNC' | null;
  reason: AutoMappingReason;
  candidate_type: AutoMappingCandidateType;
}

export interface AutoMappingResult {
  decisions: AutoMappingDecision[];
  matched_count: number;
  manual_review_count: number;
  pending_count: number;
  scanned_count: number;
}

type PendingUserRow = {
  id: string;
  pre_issued_name: string | null;
  pre_issued_phone: string | null;
  member_id: string | null;
  mapping_status: string;
};

type MemberRow = {
  id: string;
  name: string | null;
  rank: string | null;
  phone: string | null;
  source_customer_id: string | null;
  external_id: string | null;
  is_active: boolean;
};

type CustomerRow = {
  id: string;
  name: string | null;
  phone: string | null;
};

/**
 * 한 명의 사전 발급 사용자에 대해 후보들을 보고 의사결정한다.
 *
 * @param user                대상 사전 발급 user_profiles 행 (PENDING 또는 MANUAL_REVIEW 도 재평가)
 * @param sameNamePendingIds  같은 이름의 PENDING/MANUAL_REVIEW user_profiles id 집합 (자기 포함 가능)
 * @param customerNameCands   고객명이 일치하는 organization_members(customer 가상 노드 우선) 또는 customers 행을 한 차원으로 정규화한 후보들
 * @param managerNameCands    담당자명이 일치하는 organization_members(영업/리더/센터장 등) 후보들
 * @param mappedMemberIds     이미 다른 user_profiles 에 매핑된 organization_members.id 집합
 */
export function decideAutoMapping(params: {
  user: PendingUserRow;
  sameNamePendingIds: ReadonlySet<string>;
  customerNameCands: ReadonlyArray<{ member_id: string; phone: string | null }>;
  managerNameCands: ReadonlyArray<{ member_id: string }>;
  mappedMemberIds: ReadonlySet<string>;
}): AutoMappingDecision {
  const { user, sameNamePendingIds, customerNameCands, managerNameCands, mappedMemberIds } = params;

  // 케이스 1: 같은 이름의 사전 발급 계정 다중 → MANUAL_REVIEW
  if (sameNamePendingIds.size > 1) {
    return {
      user_profile_id: user.id,
      mapping_status: 'MANUAL_REVIEW',
      member_id: null,
      matched_by: null,
      reason: 'MULTIPLE_PENDING_USERS',
      candidate_type: 'NONE',
    };
  }

  // 케이스 2: 고객명 후보와 담당자명 후보가 동시에 존재 → MANUAL_REVIEW (이름 충돌)
  if (customerNameCands.length > 0 && managerNameCands.length > 0) {
    return {
      user_profile_id: user.id,
      mapping_status: 'MANUAL_REVIEW',
      member_id: null,
      matched_by: null,
      reason: 'CUSTOMER_AND_MANAGER_NAME_CONFLICT',
      candidate_type: 'CONFLICT',
    };
  }

  // --- 고객명 기준 (전화번호 동일 필수) ---
  if (customerNameCands.length > 0) {
    if (customerNameCands.length > 1) {
      // 같은 고객명 후보가 여러 명
      return {
        user_profile_id: user.id,
        mapping_status: 'MANUAL_REVIEW',
        member_id: null,
        matched_by: null,
        reason: 'MULTIPLE_CUSTOMER_CANDIDATES',
        candidate_type: 'CUSTOMER_NAME',
      };
    }

    const cand = customerNameCands[0];

    // 이미 다른 계정에 매핑되어 있으면 자동 매핑 금지
    if (mappedMemberIds.has(cand.member_id)) {
      return {
        user_profile_id: user.id,
        mapping_status: 'MANUAL_REVIEW',
        member_id: null,
        matched_by: null,
        reason: 'PERSON_ALREADY_MAPPED',
        candidate_type: 'CUSTOMER_NAME',
      };
    }

    const candPhone = normalizePhone(cand.phone);
    const userPhone = normalizePhone(user.pre_issued_phone);

    // 고객명 매칭은 반드시 전화번호 동일 필요
    if (!userPhone || !candPhone) {
      return {
        user_profile_id: user.id,
        mapping_status: 'MANUAL_REVIEW',
        member_id: null,
        matched_by: null,
        reason: 'CUSTOMER_PHONE_MISSING',
        candidate_type: 'CUSTOMER_NAME',
      };
    }
    if (candPhone !== userPhone) {
      return {
        user_profile_id: user.id,
        mapping_status: 'MANUAL_REVIEW',
        member_id: null,
        matched_by: null,
        reason: 'CUSTOMER_PHONE_NOT_MATCHED',
        candidate_type: 'CUSTOMER_NAME',
      };
    }

    return {
      user_profile_id: user.id,
      mapping_status: 'MATCHED',
      member_id: cand.member_id,
      matched_by: 'AUTO_SYNC',
      reason: 'CUSTOMER_NAME_AND_PHONE_MATCHED',
      candidate_type: 'CUSTOMER_NAME',
    };
  }

  // --- 담당자명 기준 (단일 후보) ---
  if (managerNameCands.length > 0) {
    if (managerNameCands.length > 1) {
      return {
        user_profile_id: user.id,
        mapping_status: 'MANUAL_REVIEW',
        member_id: null,
        matched_by: null,
        reason: 'MULTIPLE_MANAGER_CANDIDATES',
        candidate_type: 'MANAGER_NAME',
      };
    }
    const cand = managerNameCands[0];
    if (mappedMemberIds.has(cand.member_id)) {
      return {
        user_profile_id: user.id,
        mapping_status: 'MANUAL_REVIEW',
        member_id: null,
        matched_by: null,
        reason: 'PERSON_ALREADY_MAPPED',
        candidate_type: 'MANAGER_NAME',
      };
    }
    return {
      user_profile_id: user.id,
      mapping_status: 'MATCHED',
      member_id: cand.member_id,
      matched_by: 'AUTO_SYNC',
      reason: 'MANAGER_NAME_SINGLE_CANDIDATE_MATCHED',
      candidate_type: 'MANAGER_NAME',
    };
  }

  // 후보 자체가 없음 → PENDING 유지 (다음 동기화에서 다시 시도 가능)
  return {
    user_profile_id: user.id,
    mapping_status: 'PENDING',
    member_id: null,
    matched_by: null,
    reason: 'NO_CANDIDATE',
    candidate_type: 'NONE',
  };
}

/**
 * 사전 발급 계정 전체를 한 번에 평가해 매핑한다.
 *
 * 호출 시점:
 *   - TY 동기화(runSync) 의 contracts/members upsert 가 끝난 직후
 *   - 또는 관리자 검토 화면에서 "재평가" 트리거
 *
 * @param adminDb service_role 클라이언트
 * @param opts.dryRun true 면 실제 UPDATE 없이 decision 만 반환 (테스트/감사용)
 */
export async function runPreIssuedAccountAutoMapping(
  adminDb: AdminDb,
  opts: { dryRun?: boolean } = {},
): Promise<AutoMappingResult> {
  const dryRun = opts.dryRun === true;

  // 1) PENDING/MANUAL_REVIEW user_profiles 로드
  const { data: pendingRows, error: pErr } = await adminDb
    .from('user_profiles')
    .select('id, pre_issued_name, pre_issued_phone, member_id, mapping_status, login_code, display_name, phone')
    .in('mapping_status', ['PENDING', 'MANUAL_REVIEW'])
    .eq('role', 'member');
  if (pErr) throw new Error(`pending user_profiles 조회 실패: ${pErr.message}`);
  const pending = ((pendingRows ?? []) as any[]) as PendingUserRow[];

  if (pending.length === 0) {
    return { decisions: [], matched_count: 0, manual_review_count: 0, pending_count: 0, scanned_count: 0 };
  }

  // pre_issued_name 이 비어있으면 (예: 과거 잔존 NULL member_id 행) display_name 으로 보완해서 평가
  const userEffectiveName = (u: PendingUserRow & { display_name?: string | null }): string =>
    normalizeName(u.pre_issued_name ?? (u as any).display_name ?? '');

  // 2) 자동 매칭에 사용할 사람 데이터 후보 로딩
  //    - organization_members: 활성·비-본사 만 (본사 노드와의 충돌 방지)
  const { data: memberRows, error: mErr } = await adminDb
    .from('organization_members')
    .select('id, name, rank, phone, source_customer_id, external_id, is_active')
    .eq('is_active', true);
  if (mErr) throw new Error(`organization_members 조회 실패: ${mErr.message}`);
  const allMembers = ((memberRows ?? []) as any[]) as MemberRow[];

  //    - customers: 사전 발급 계정의 이름이 customer 만 존재할 수도 있으므로 보조 인덱스로 활용.
  //      단, 매핑 대상 id 자체는 organization_members.id 이므로,
  //      customers 매칭이 잡혀도 해당 customer 에 매핑된 organization_members 가 있어야 자동 매핑한다.
  const { data: customerRows, error: cErr } = await adminDb
    .from('customers')
    .select('id, name, phone');
  if (cErr) throw new Error(`customers 조회 실패: ${cErr.message}`);
  const allCustomers = ((customerRows ?? []) as any[]) as CustomerRow[];

  // 3) 이미 매핑된 member_id 집합 (다른 user_profiles 에 매핑됨)
  const { data: mappedRows, error: mapErr } = await adminDb
    .from('user_profiles')
    .select('id, member_id')
    .not('member_id', 'is', null);
  if (mapErr) throw new Error(`기존 매핑 조회 실패: ${mapErr.message}`);
  const mappedMemberIds = new Set<string>();
  for (const r of (mappedRows ?? []) as any[]) {
    const mid = (r.member_id ?? null) as string | null;
    if (mid) mappedMemberIds.add(mid);
  }

  // 4) 같은 이름의 PENDING 계정 인덱스 (이름 정규화 키 기준)
  const pendingIdsByName = new Map<string, Set<string>>();
  for (const u of pending) {
    const key = userEffectiveName(u);
    if (!key) continue;
    const set = pendingIdsByName.get(key) ?? new Set<string>();
    set.add(u.id);
    pendingIdsByName.set(key, set);
  }

  // 5) 이름별 후보 인덱스
  // customer-virtual 멤버(source_customer_id != null 또는 external_id LIKE 'customer:%') 는 "고객명 후보"
  // 그 외 활성 비-본사 멤버는 "담당자명 후보"
  const customerCandsByName = new Map<string, Array<{ member_id: string; phone: string | null }>>();
  const managerCandsByName = new Map<string, Array<{ member_id: string }>>();

  const isCustomerVirtualMember = (m: MemberRow): boolean => {
    if (m.source_customer_id) return true;
    if (m.external_id && m.external_id.startsWith('customer:')) return true;
    return false;
  };

  for (const m of allMembers) {
    const nameKey = normalizeName(m.name ?? '');
    if (!nameKey) continue;
    if (m.rank === '본사') continue;

    if (isCustomerVirtualMember(m)) {
      // customer 가상 노드 → 고객명 후보로 분류 (phone 은 organization_members.phone 또는 customers.phone fallback)
      let phone = m.phone ?? null;
      if (!phone && m.source_customer_id) {
        const c = allCustomers.find((c) => c.id === m.source_customer_id);
        if (c) phone = c.phone ?? null;
      }
      const arr = customerCandsByName.get(nameKey) ?? [];
      arr.push({ member_id: m.id, phone });
      customerCandsByName.set(nameKey, arr);
    } else if (CUSTOMER_RANKS_FOR_NAME_MATCH.has(m.rank ?? '')) {
      const arr = managerCandsByName.get(nameKey) ?? [];
      arr.push({ member_id: m.id });
      managerCandsByName.set(nameKey, arr);
    }
  }

  // 6) 각 사전 발급 행에 대해 의사결정
  const decisions: AutoMappingDecision[] = [];
  for (const u of pending) {
    const nameKey = userEffectiveName(u);
    if (!nameKey) {
      decisions.push({
        user_profile_id: u.id,
        mapping_status: u.mapping_status === 'MANUAL_REVIEW' ? 'MANUAL_REVIEW' : 'PENDING',
        member_id: u.member_id,
        matched_by: null,
        reason: 'UNCERTAIN_MATCH',
        candidate_type: 'NONE',
      });
      continue;
    }
    const sameNamePending = pendingIdsByName.get(nameKey) ?? new Set<string>();
    const customerCands = customerCandsByName.get(nameKey) ?? [];
    const managerCands = managerCandsByName.get(nameKey) ?? [];

    decisions.push(
      decideAutoMapping({
        user: u,
        sameNamePendingIds: sameNamePending,
        customerNameCands: customerCands,
        managerNameCands: managerCands,
        mappedMemberIds,
      }),
    );
  }

  // 7) DB 반영 + 로그
  let matched = 0;
  let manualReview = 0;
  let pendingCount = 0;

  for (const d of decisions) {
    if (d.mapping_status === 'MATCHED') matched++;
    else if (d.mapping_status === 'MANUAL_REVIEW') manualReview++;
    else pendingCount++;
  }

  if (!dryRun) {
    for (const d of decisions) {
      const target = pending.find((p) => p.id === d.user_profile_id);
      // 변경이 필요 없는 케이스는 스킵 (이미 같은 상태인데 PENDING 인 경우)
      const noChange =
        d.mapping_status === 'PENDING' &&
        target?.mapping_status === 'PENDING' &&
        (target?.member_id ?? null) === d.member_id;
      if (!noChange) {
        const updates: Record<string, unknown> = {
          mapping_status: d.mapping_status,
          mapping_reason: d.reason,
        };
        if (d.mapping_status === 'MATCHED' && d.member_id) {
          updates.member_id = d.member_id;
          updates.matched_at = new Date().toISOString();
          updates.matched_by = d.matched_by;
        } else if (d.mapping_status === 'MANUAL_REVIEW') {
          // MANUAL_REVIEW 로 전환할 때는 임시 member_id 를 비워두어 권한 없음 화면 유지
          updates.member_id = null;
          updates.matched_at = null;
          updates.matched_by = null;
        }
        const { error: uErr } = await adminDb
          .from('user_profiles')
          .update(updates)
          .eq('id', d.user_profile_id);
        if (uErr) {
          // 한 행 실패가 전체를 막지 않도록 로그만 남기고 계속 진행
          // eslint-disable-next-line no-console
          console.warn(`[auto-mapping] user_profiles update 실패(${d.user_profile_id}): ${uErr.message}`);
        }
      }

      // MATCHED 로 전환된 경우: 예약 등록된 코드 선발급 설정이 있으면 즉시 승격
      if (d.mapping_status === 'MATCHED') {
        try {
          await promotePreIssuedPendingSettingIfPossible({
            db: adminDb,
            userProfileId: d.user_profile_id,
            changedBy: 'AUTO_SYNC',
          });
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn(`[auto-mapping] pending promote 실패(${d.user_profile_id}) (mapping은 정상):`, e);
        }
      }

      // 감사 로그 (PENDING 으로 그대로 둔 NO_CANDIDATE 도 기록해두면 추적에 유리)
      await adminDb.from('account_mapping_logs').insert({
        action: 'PRE_ISSUED_ACCOUNT_AUTO_MAPPING',
        user_profile_id: d.user_profile_id,
        member_id: d.member_id,
        pre_issued_name: target?.pre_issued_name ?? null,
        pre_issued_phone: target?.pre_issued_phone ?? null,
        mapping_status: d.mapping_status,
        matched_by: d.matched_by,
        candidate_type: d.candidate_type,
        reason: d.reason,
        admin_id: null,
      });
    }
  }

  return {
    decisions,
    matched_count: matched,
    manual_review_count: manualReview,
    pending_count: pendingCount,
    scanned_count: pending.length,
  };
}
