import type { OrgTreeRow } from '@/lib/types';
import type { RankType } from '@/lib/types/organization';
import {
  buildChildrenByParentFromRows,
  collectSubtreeMemberIdsDownstream,
} from '@/lib/settlement/settlement-org-tree';
import {
  CENTER_CHIEF_PROMOTION_MIN_LEADERS,
  contractJoinOrderYmd,
  isCustomerVirtualOrgMember,
  type PromotionOrderContractRef,
  type SalesMemberPromotionThreshold,
} from '@/lib/settlement/leader-promotion';

/** 센터장 달성 경계: 산하 5번째 리더 승격 시점 */
export type CenterChiefPromotionThreshold = {
  /** 산하 5번째로 달성한 리더 멤버 id */
  threshold_leader_member_id: string;
  /** 5번째 리더 승격 순서일(해피콜 YMD 우선) */
  threshold_join_date: string;
  threshold_contract_id?: string | null;
  threshold_invoice_registered_at?: string | null;
  threshold_created_at?: string | null;
};

export type CenterChiefPromotionEventRecord = {
  member_id: string;
  previous_parent_id: string | null;
  threshold_leader_member_id: string;
  threshold_join_date: string;
  threshold_contract_id: string | null;
  created_at: string | null;
};

function normalizeCreatedAt(s?: string | null): string {
  if (s == null) return '';
  return String(s).trim();
}

function comparePromotionOrderTieBreak(
  a: { invoice_registered_at?: string | null; created_at?: string | null },
  b: { invoice_registered_at?: string | null; created_at?: string | null },
): number {
  const invA = normalizeCreatedAt(a.invoice_registered_at);
  const invB = normalizeCreatedAt(b.invoice_registered_at);
  if (invA !== invB) {
    if (!invA) return 1;
    if (!invB) return -1;
    return invA.localeCompare(invB);
  }
  const ca = normalizeCreatedAt(a.created_at);
  const cb = normalizeCreatedAt(b.created_at);
  if (ca !== cb) return ca.localeCompare(cb);
  return 0;
}

function leaderPromotionSortKey(
  memberId: string,
  leaderPromotionThresholdByMemberId: Map<string, SalesMemberPromotionThreshold | null>,
  leaderRankEffectiveAtByMemberId?: Map<string, string | null>,
): {
  date: string;
  invoice_registered_at: string | null;
  created_at: string | null;
  contractId: string;
  memberId: string;
} {
  const th = leaderPromotionThresholdByMemberId.get(memberId) ?? null;
  if (th) {
    return {
      date: th.threshold_join_date,
      invoice_registered_at: th.threshold_invoice_registered_at ?? null,
      created_at: th.threshold_created_at ?? null,
      contractId: th.threshold_contract_id,
      memberId,
    };
  }
  const at = (leaderRankEffectiveAtByMemberId?.get(memberId) ?? '').trim();
  if (at) {
    return {
      date: at.slice(0, 10),
      invoice_registered_at: null,
      created_at: at,
      contractId: '',
      memberId,
    };
  }
  return {
    date: '9999-12-31',
    invoice_registered_at: null,
    created_at: null,
    contractId: '',
    memberId,
  };
}

/** 산하 리더를 리더 승격 순서(5번째 = 센터장 달성)로 정렬 */
export function compareSubtreeLeaderPromotionOrder(
  aMemberId: string,
  bMemberId: string,
  leaderPromotionThresholdByMemberId: Map<string, SalesMemberPromotionThreshold | null>,
  leaderRankEffectiveAtByMemberId?: Map<string, string | null>,
): number {
  const ka = leaderPromotionSortKey(aMemberId, leaderPromotionThresholdByMemberId, leaderRankEffectiveAtByMemberId);
  const kb = leaderPromotionSortKey(bMemberId, leaderPromotionThresholdByMemberId, leaderRankEffectiveAtByMemberId);
  if (ka.date !== kb.date) return ka.date.localeCompare(kb.date);
  const tie = comparePromotionOrderTieBreak(ka, kb);
  if (tie !== 0) return tie;
  if (ka.contractId !== kb.contractId) return ka.contractId.localeCompare(kb.contractId);
  return ka.memberId.localeCompare(kb.memberId);
}

export function centerChiefThresholdToPromotionRef(
  th: CenterChiefPromotionThreshold,
): SalesMemberPromotionThreshold {
  return {
    threshold_contract_id: th.threshold_contract_id ?? th.threshold_leader_member_id,
    threshold_join_date: th.threshold_join_date,
    threshold_invoice_registered_at: th.threshold_invoice_registered_at ?? null,
    threshold_created_at: th.threshold_created_at ?? null,
  };
}

/** @deprecated 캘린더 다음날 규칙은 폐기. 승급 계약 순서일 표시용으로만 유지. */
export function addOneCalendarDayYmd(ymd: string): string {
  const parts = ymd.slice(0, 10).split('-').map((x) => Number(x));
  const y = parts[0] ?? 0;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

/**
 * 감사·표시용: 센터장 승급 계약(5번째 리더 승급 계약) 순서일.
 * 실제 post 적용은 이 계약 **다음 계약**부터(리더 승급과 동일).
 */
export function centerChiefPostRollupStartsYmd(threshold: CenterChiefPromotionThreshold): string {
  return String(threshold.threshold_join_date).slice(0, 10);
}

/**
 * 계약 vs 센터장 승급 계약 순서 비교.
 * - &lt;0: 승급 계약보다 앞 (pre)
 * - 0: 승급 계약 자체 (pre)
 * - &gt;0: 승급 계약 다음 (post)
 *
 * 순서: 해피콜 YMD → created_at → id.
 * (invoice_registered_at은 타 멤버 승급계약과 비교 시 sync 배치 시각이 섞여 순서가 뒤집힐 수 있어 쓰지 않는다.)
 */
export function compareContractToCenterChiefThreshold(
  contract: PromotionOrderContractRef,
  threshold: CenterChiefPromotionThreshold,
): number {
  const aj = contractJoinOrderYmd(contract);
  const tj = String(threshold.threshold_join_date).slice(0, 10);
  if (aj !== tj) return aj.localeCompare(tj);

  const ca = normalizeCreatedAt(contract.created_at);
  const cb = normalizeCreatedAt(threshold.threshold_created_at);
  if (ca !== cb) {
    if (!ca) return 1;
    if (!cb) return -1;
    return ca.localeCompare(cb);
  }

  const tid = threshold.threshold_contract_id ? String(threshold.threshold_contract_id) : '';
  if (!tid) return 0;
  if (contract.id === tid) return 0;
  return contract.id.localeCompare(tid);
}

/**
 * 센터장 단가/20만 롤업 적용 여부.
 * 리더 승급과 동일: 승급 계약(threshold) 자체는 제외, **그 다음 계약부터** post.
 * `9999-12-31`은 기록 전 이미 센터장 달성 → 전 계약 post.
 */
export function isContractAtOrAfterCenterChiefPostRollup(
  contract: PromotionOrderContractRef & { unit_count?: number },
  threshold: CenterChiefPromotionThreshold | null,
): boolean {
  if (!threshold) return false;
  if (String(threshold.threshold_join_date).slice(0, 10) === '9999-12-31') return true;
  return compareContractToCenterChiefThreshold(contract, threshold) > 0;
}

/** @deprecated isContractAtOrAfterCenterChiefPostRollup 사용 */
export function isContractAtOrAfterCenterChiefThreshold(
  contract: PromotionOrderContractRef,
  threshold: CenterChiefPromotionThreshold | null,
): boolean {
  return isContractAtOrAfterCenterChiefPostRollup(contract, threshold);
}

/** 센터장 승급 전(10만)/이후(20만) 구좌 분할 — 승급 계약 다음 계약부터 post */
export function splitContractUnitsByCenterChiefThreshold(
  contract: PromotionOrderContractRef & { unit_count: number },
  threshold: CenterChiefPromotionThreshold | null,
): { preCenterChiefUnits: number; postCenterChiefUnits: number } {
  const total = Math.max(0, contract.unit_count);
  if (!threshold || total === 0) {
    return { preCenterChiefUnits: total, postCenterChiefUnits: 0 };
  }
  if (String(threshold.threshold_join_date).slice(0, 10) === '9999-12-31') {
    return { preCenterChiefUnits: 0, postCenterChiefUnits: total };
  }
  if (compareContractToCenterChiefThreshold(contract, threshold) > 0) {
    return { preCenterChiefUnits: 0, postCenterChiefUnits: total };
  }
  return { preCenterChiefUnits: total, postCenterChiefUnits: 0 };
}

/**
 * 산하(본인 제외) 리더가 5명 이상일 때, 5번째 리더 승격 시점을 센터장 달성 경계로 반환.
 */
export function computeCenterChiefThresholdForMember(
  memberId: string,
  treeRows: OrgTreeRow[],
  rankById: Map<string, RankType>,
  leaderPromotionThresholdByMemberId: Map<string, SalesMemberPromotionThreshold | null>,
  leaderRankEffectiveAtByMemberId?: Map<string, string | null>,
  externalIdByMemberId?: ReadonlyMap<string, string | null | undefined>,
): CenterChiefPromotionThreshold | null {
  const childrenByParent = buildChildrenByParentFromRows(treeRows);
  const subtree = collectSubtreeMemberIdsDownstream(memberId, childrenByParent);

  const leaders: string[] = [];
  for (const sid of subtree) {
    if (sid === memberId) continue;
    if (rankById.get(sid) !== '리더') continue;
    if (externalIdByMemberId && isCustomerVirtualOrgMember(externalIdByMemberId.get(sid))) continue;
    leaders.push(sid);
  }

  if (leaders.length < CENTER_CHIEF_PROMOTION_MIN_LEADERS) return null;

  leaders.sort((a, b) =>
    compareSubtreeLeaderPromotionOrder(
      a,
      b,
      leaderPromotionThresholdByMemberId,
      leaderRankEffectiveAtByMemberId,
    ),
  );

  const fifthLeaderId = leaders[CENTER_CHIEF_PROMOTION_MIN_LEADERS - 1]!;
  const th = leaderPromotionThresholdByMemberId.get(fifthLeaderId) ?? null;
  if (th) {
    return {
      threshold_leader_member_id: fifthLeaderId,
      threshold_join_date: th.threshold_join_date,
      threshold_contract_id: th.threshold_contract_id,
      threshold_invoice_registered_at: th.threshold_invoice_registered_at ?? null,
      threshold_created_at: th.threshold_created_at ?? null,
    };
  }

  const at = (leaderRankEffectiveAtByMemberId?.get(fifthLeaderId) ?? '').trim();
  if (at) {
    return {
      threshold_leader_member_id: fifthLeaderId,
      threshold_join_date: at.slice(0, 10),
      threshold_contract_id: null,
      threshold_invoice_registered_at: null,
      threshold_created_at: at,
    };
  }

  return {
    threshold_leader_member_id: fifthLeaderId,
    threshold_join_date: '9999-12-31',
    threshold_contract_id: null,
  };
}

export function computeCenterChiefPromotionThresholds(
  treeRows: OrgTreeRow[],
  rankById: Map<string, RankType>,
  leaderPromotionThresholdByMemberId: Map<string, SalesMemberPromotionThreshold | null>,
  leaderRankEffectiveAtByMemberId?: Map<string, string | null>,
  externalIdByMemberId?: ReadonlyMap<string, string | null | undefined>,
): Map<string, CenterChiefPromotionThreshold | null> {
  const out = new Map<string, CenterChiefPromotionThreshold | null>();
  for (const [memberId, rank] of rankById) {
    if (rank !== '리더' && rank !== '센터장') {
      out.set(memberId, null);
      continue;
    }
    out.set(
      memberId,
      computeCenterChiefThresholdForMember(
        memberId,
        treeRows,
        rankById,
        leaderPromotionThresholdByMemberId,
        leaderRankEffectiveAtByMemberId,
        externalIdByMemberId,
      ),
    );
  }
  return out;
}

/**
 * `center_chief_promotion_events`에 기록된 5번째 리더·승격일을 threshold 맵 SSOT로 덮어쓴다.
 */
export function mergeCenterChiefPromotionEventThresholds(
  centerChiefThresholdByMemberId: Map<string, CenterChiefPromotionThreshold | null>,
  events: ReadonlyArray<{
    member_id?: string | null;
    threshold_leader_member_id?: string | null;
    threshold_join_date?: string | null;
    threshold_contract_id?: string | null;
    created_at?: string | null;
  }>,
  thresholdContractMetaById: ReadonlyMap<
    string,
    {
      join_date: string;
      happy_call_at?: string | null;
      invoice_registered_at?: string | null;
      created_at?: string | null;
    }
  >,
): void {
  for (const r of events) {
    if (!r?.member_id || !r.threshold_leader_member_id || !r.threshold_join_date) continue;
    const leaderId = String(r.threshold_leader_member_id);
    const cid = r.threshold_contract_id ? String(r.threshold_contract_id) : null;
    const meta = cid ? thresholdContractMetaById.get(cid) : undefined;
    centerChiefThresholdByMemberId.set(String(r.member_id), {
      threshold_leader_member_id: leaderId,
      threshold_join_date: meta
        ? contractJoinOrderYmd(meta)
        : String(r.threshold_join_date).slice(0, 10),
      threshold_contract_id: cid,
      threshold_invoice_registered_at: meta?.invoice_registered_at ?? null,
      threshold_created_at: meta?.created_at ?? (r.created_at ?? null),
    });
  }
}
