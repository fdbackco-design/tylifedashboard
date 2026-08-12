import type { OrgTreeRow } from '@/lib/types';
import type { RankType } from '@/lib/types/organization';
import {
  buildChildrenByParentFromRows,
  collectSubtreeMemberIdsDownstream,
} from '@/lib/settlement/settlement-org-tree';
import {
  CENTER_CHIEF_PROMOTION_MIN_LEADERS,
  compareContractToPromotionThresholdOrder,
  comparePromotionOrderFields,
  contractJoinOrderYmd,
  isCustomerVirtualOrgMember,
  type PromotionOrderContractRef,
  type SalesMemberPromotionThreshold,
} from '@/lib/settlement/leader-promotion';

/**
 * 5번째 리더의 승급일·effective_at이 없을 때 쓰는 정렬/계산용 sentinel.
 * 의미: 기록 전 이미 센터장 → 전 계약 post. UI에는 노출하지 않는다.
 */
export const CENTER_CHIEF_THRESHOLD_UNKNOWN_DATE = '9999-12-31';

export function isCenterChiefThresholdUnknownDate(ymd: string | null | undefined): boolean {
  return String(ymd ?? '').slice(0, 10) === CENTER_CHIEF_THRESHOLD_UNKNOWN_DATE;
}

/** 감사·UI용 승급 확정일. sentinel이면 null */
export function displayCenterChiefPromotionConfirmedYmd(
  ymd: string | null | undefined,
): string | null {
  const s = String(ymd ?? '').slice(0, 10);
  if (!s || isCenterChiefThresholdUnknownDate(s)) return null;
  return s;
}

/** 센터장 달성 경계: 산하 5번째 리더 승격 시점 */
export type CenterChiefPromotionThreshold = {
  /** 산하 5번째로 달성한 리더 멤버 id */
  threshold_leader_member_id: string;
  /** 5번째 리더 승격 순서일(해피콜 YMD 우선) */
  threshold_join_date: string;
  threshold_contract_id?: string | null;
  /** 승격 계약 실제 가입일 (동일 해피콜일 tie-break) */
  threshold_contract_join_date?: string | null;
  /** 승격 계약 sequence_no */
  threshold_sequence_no?: number | null;
  /** @deprecated 정렬에는 사용하지 않음 */
  threshold_invoice_registered_at?: string | null;
  /** @deprecated 정렬에는 사용하지 않음 */
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

function leaderPromotionSortKey(
  memberId: string,
  leaderPromotionThresholdByMemberId: Map<string, SalesMemberPromotionThreshold | null>,
  leaderRankEffectiveAtByMemberId?: Map<string, string | null>,
): {
  date: string;
  join_date: string | null;
  sequence_no: number | null;
  contractId: string;
  memberId: string;
} {
  const th = leaderPromotionThresholdByMemberId.get(memberId) ?? null;
  if (th) {
    return {
      date: th.threshold_join_date,
      join_date: th.threshold_contract_join_date ?? null,
      sequence_no: th.threshold_sequence_no ?? null,
      contractId: th.threshold_contract_id,
      memberId,
    };
  }
  const at = (leaderRankEffectiveAtByMemberId?.get(memberId) ?? '').trim();
  if (at) {
    return {
      date: at.slice(0, 10),
      join_date: at.slice(0, 10),
      sequence_no: null,
      contractId: '',
      memberId,
    };
  }
  return {
    date: CENTER_CHIEF_THRESHOLD_UNKNOWN_DATE,
    join_date: null,
    sequence_no: null,
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
  const tie = comparePromotionOrderFields(
    { happy_call_at: null, join_date: ka.join_date, sequence_no: ka.sequence_no, id: ka.contractId },
    { happy_call_at: null, join_date: kb.join_date, sequence_no: kb.sequence_no, id: kb.contractId },
  );
  if (tie !== 0) return tie;
  return ka.memberId.localeCompare(kb.memberId);
}

export function centerChiefThresholdToPromotionRef(
  th: CenterChiefPromotionThreshold,
): SalesMemberPromotionThreshold {
  return {
    threshold_contract_id: th.threshold_contract_id ?? th.threshold_leader_member_id,
    threshold_join_date: th.threshold_join_date,
    threshold_contract_join_date: th.threshold_contract_join_date ?? null,
    threshold_sequence_no: th.threshold_sequence_no ?? null,
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
 * 계약 vs 센터장 승급 계약(5번째 리더 승급 계약) 순서 비교.
 * - &lt;0: 승급 계약보다 앞 (pre)
 * - 0: 승급 계약 자체 (pre)
 * - &gt;0: 승급 계약 다음 (post)
 *
 * 리더 승급 walk와 동일: 해피콜 성공일 → 가입일자 → 계약 순번 → id.
 * (created_at만 쓰면 동일 해피콜 배치에서 가입일·순번과 어긋나 post 단가가 잘못 붙을 수 있다.)
 */
export function compareContractToCenterChiefThreshold(
  contract: PromotionOrderContractRef,
  threshold: CenterChiefPromotionThreshold,
): number {
  return compareContractToPromotionThresholdOrder(
    contract,
    centerChiefThresholdToPromotionRef(threshold),
  );
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
  if (isCenterChiefThresholdUnknownDate(threshold.threshold_join_date)) return true;
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
  if (isCenterChiefThresholdUnknownDate(threshold.threshold_join_date)) {
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
      threshold_contract_join_date: th.threshold_contract_join_date ?? null,
      threshold_sequence_no: th.threshold_sequence_no ?? null,
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
      threshold_contract_join_date: at.slice(0, 10),
      threshold_sequence_no: null,
      threshold_invoice_registered_at: null,
      threshold_created_at: at,
    };
  }

  return {
    threshold_leader_member_id: fifthLeaderId,
    threshold_join_date: CENTER_CHIEF_THRESHOLD_UNKNOWN_DATE,
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
    // 사업본부장도 과거 센터장 경계를 재계산할 수 있게 포함한다(산하 리더 5명 이상일 때).
    if (rank !== '리더' && rank !== '센터장' && rank !== '사업본부장') {
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
 * `center_chief_promotion_events`를 threshold 맵에 반영한다.
 * - live compute에 유효한 경계가 있으면 **덮어쓰지 않는다** (가입 순서 재계산 SSOT).
 * - live가 없거나 sentinel일 때만 이벤트 값으로 채운다(산하 리더 수 부족 등 역사 보존).
 * - 이벤트에 sentinel(9999)/계약 누락이 있으면 해당 리더의 리더 승급 threshold로 보정한다.
 * - 보정 후에도 sentinel이면 이벤트를 무시하고 live compute 값을 유지한다.
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
      sequence_no?: number | null;
      invoice_registered_at?: string | null;
      created_at?: string | null;
    }
  >,
  leaderPromotionThresholdByMemberId?: ReadonlyMap<string, SalesMemberPromotionThreshold | null>,
): void {
  for (const r of events) {
    if (!r?.member_id || !r.threshold_leader_member_id || !r.threshold_join_date) continue;
    const memberId = String(r.member_id);
    const live = centerChiefThresholdByMemberId.get(memberId) ?? null;
    if (live && !isCenterChiefThresholdUnknownDate(live.threshold_join_date)) {
      continue;
    }
    const leaderId = String(r.threshold_leader_member_id);
    let cid = r.threshold_contract_id ? String(r.threshold_contract_id) : null;
    let joinDate = String(r.threshold_join_date).slice(0, 10);
    let contractJoinDate: string | null = null;
    let sequenceNo: number | null = null;
    let invoiceAt: string | null = null;
    let createdAt: string | null = r.created_at ?? null;

    const needsLeaderFallback = !cid || isCenterChiefThresholdUnknownDate(joinDate);
    if (needsLeaderFallback) {
      const leaderTh = leaderPromotionThresholdByMemberId?.get(leaderId) ?? null;
      if (leaderTh) {
        if (!cid && leaderTh.threshold_contract_id) {
          cid = String(leaderTh.threshold_contract_id);
        }
        if (isCenterChiefThresholdUnknownDate(joinDate)) {
          joinDate = String(leaderTh.threshold_join_date).slice(0, 10);
        }
        contractJoinDate = leaderTh.threshold_contract_join_date ?? contractJoinDate;
        sequenceNo = leaderTh.threshold_sequence_no ?? sequenceNo;
        invoiceAt = leaderTh.threshold_invoice_registered_at ?? invoiceAt;
        createdAt = leaderTh.threshold_created_at ?? createdAt;
      }
    }

    const meta = cid ? thresholdContractMetaById.get(cid) : undefined;
    if (meta) {
      joinDate = contractJoinOrderYmd(meta);
      contractJoinDate = String(meta.join_date ?? '').slice(0, 10) || contractJoinDate;
      sequenceNo =
        meta.sequence_no == null || !Number.isFinite(Number(meta.sequence_no))
          ? sequenceNo
          : Number(meta.sequence_no);
      invoiceAt = meta.invoice_registered_at ?? invoiceAt;
      createdAt = meta.created_at ?? createdAt;
    }

    // 여전히 sentinel이면 잘못된 이벤트(예: 승급일 없는 멤버를 5번째로 기록) → live 유지
    if (isCenterChiefThresholdUnknownDate(joinDate)) continue;

    centerChiefThresholdByMemberId.set(memberId, {
      threshold_leader_member_id: leaderId,
      threshold_join_date: joinDate,
      threshold_contract_id: cid,
      threshold_contract_join_date: contractJoinDate,
      threshold_sequence_no: sequenceNo,
      threshold_invoice_registered_at: invoiceAt,
      threshold_created_at: createdAt,
    });
  }
}
