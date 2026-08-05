import type { OrgTreeRow } from '@/lib/types';
import type { RankType } from '@/lib/types/organization';
import {
  buildChildrenByParentFromRows,
  collectSubtreeMemberIdsDownstream,
} from '@/lib/settlement/settlement-org-tree';
import {
  DIVISION_HEAD_PROMOTION_MIN_CENTER_CHIEFS,
  contractJoinOrderYmd,
  isCustomerVirtualOrgMember,
  type PromotionOrderContractRef,
} from '@/lib/settlement/leader-promotion';
import type { CenterChiefPromotionThreshold } from '@/lib/settlement/center-chief-promotion';
import { compareContractToCenterChiefThreshold } from '@/lib/settlement/center-chief-promotion';

/** 사업본부장 달성 경계: 산하 3번째 센터장 승격 시점 */
export type DivisionHeadPromotionThreshold = {
  /** 산하 3번째로 달성한 센터장 멤버 id */
  threshold_center_chief_member_id: string;
  /** 3번째 센터장 승격 순서일(해피콜 YMD 우선) */
  threshold_join_date: string;
  threshold_contract_id?: string | null;
  threshold_invoice_registered_at?: string | null;
  threshold_created_at?: string | null;
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

/**
 * 센터장 달성 threshold를 정렬·단가 경계용으로 정규화.
 * `9999-12-31`(기록 전 이미 달성)은 created_at 날짜로 대체한다.
 */
export function effectiveCenterChiefThresholdForOrdering(
  th: CenterChiefPromotionThreshold,
): CenterChiefPromotionThreshold {
  const join = String(th.threshold_join_date ?? '').slice(0, 10);
  if (join && join !== '9999-12-31') return th;
  const created = normalizeCreatedAt(th.threshold_created_at);
  if (created) {
    return {
      ...th,
      threshold_join_date: created.slice(0, 10),
    };
  }
  return th;
}

function centerChiefSortKey(th: CenterChiefPromotionThreshold): {
  date: string;
  invoice_registered_at: string | null;
  created_at: string | null;
  contractId: string;
  leaderId: string;
} {
  const eff = effectiveCenterChiefThresholdForOrdering(th);
  return {
    date: String(eff.threshold_join_date).slice(0, 10),
    invoice_registered_at: eff.threshold_invoice_registered_at ?? null,
    created_at: eff.threshold_created_at ?? null,
    contractId: eff.threshold_contract_id ? String(eff.threshold_contract_id) : '',
    leaderId: eff.threshold_leader_member_id,
  };
}

/** 산하 센터장을 센터장 승격 순서(3번째 = 사업본부장 달성)로 정렬 */
export function compareSubtreeCenterChiefPromotionOrder(
  aTh: CenterChiefPromotionThreshold,
  bTh: CenterChiefPromotionThreshold,
): number {
  const ka = centerChiefSortKey(aTh);
  const kb = centerChiefSortKey(bTh);
  if (ka.date !== kb.date) return ka.date.localeCompare(kb.date);
  const tie = comparePromotionOrderTieBreak(ka, kb);
  if (tie !== 0) return tie;
  if (ka.contractId !== kb.contractId) return ka.contractId.localeCompare(kb.contractId);
  return ka.leaderId.localeCompare(kb.leaderId);
}

/**
 * 사업본부장 단가 적용 여부.
 * 센터장 승급과 동일: 3번째 센터장 승급 계약 자체는 제외, **그 다음 계약부터** 본부장 단가.
 */
export function isContractAtOrAfterDivisionHeadPostRate(
  contract: PromotionOrderContractRef & { unit_count?: number },
  threshold: DivisionHeadPromotionThreshold | null,
): boolean {
  if (!threshold) return false;
  const asCc: CenterChiefPromotionThreshold = {
    threshold_leader_member_id: threshold.threshold_center_chief_member_id,
    threshold_join_date: threshold.threshold_join_date,
    threshold_contract_id: threshold.threshold_contract_id ?? null,
    threshold_invoice_registered_at: threshold.threshold_invoice_registered_at ?? null,
    threshold_created_at: threshold.threshold_created_at ?? null,
  };
  return compareContractToCenterChiefThreshold(contract, asCc) > 0;
}

/**
 * 산하(본인 제외) 센터장이 3명 이상일 때, 3번째 센터장 승격 시점을 사업본부장 달성 경계로 반환.
 */
export function computeDivisionHeadThresholdForMember(
  memberId: string,
  treeRows: OrgTreeRow[],
  rankById: Map<string, RankType>,
  centerChiefThresholdByMemberId: Map<string, CenterChiefPromotionThreshold | null>,
  externalIdByMemberId?: ReadonlyMap<string, string | null | undefined>,
): DivisionHeadPromotionThreshold | null {
  const childrenByParent = buildChildrenByParentFromRows(treeRows);
  const subtree = collectSubtreeMemberIdsDownstream(memberId, childrenByParent);

  const centerChiefs: Array<{ id: string; th: CenterChiefPromotionThreshold }> = [];
  for (const sid of subtree) {
    if (sid === memberId) continue;
    if (rankById.get(sid) !== '센터장') continue;
    if (externalIdByMemberId && isCustomerVirtualOrgMember(externalIdByMemberId.get(sid))) continue;
    const th = centerChiefThresholdByMemberId.get(sid) ?? null;
    if (!th) continue;
    centerChiefs.push({ id: sid, th });
  }

  if (centerChiefs.length < DIVISION_HEAD_PROMOTION_MIN_CENTER_CHIEFS) return null;

  centerChiefs.sort((a, b) => compareSubtreeCenterChiefPromotionOrder(a.th, b.th));

  const third = centerChiefs[DIVISION_HEAD_PROMOTION_MIN_CENTER_CHIEFS - 1]!;
  const eff = effectiveCenterChiefThresholdForOrdering(third.th);
  return {
    threshold_center_chief_member_id: third.id,
    threshold_join_date: String(eff.threshold_join_date).slice(0, 10),
    threshold_contract_id: eff.threshold_contract_id ?? null,
    threshold_invoice_registered_at: eff.threshold_invoice_registered_at ?? null,
    threshold_created_at: eff.threshold_created_at ?? null,
  };
}

export function computeDivisionHeadPromotionThresholds(
  treeRows: OrgTreeRow[],
  rankById: Map<string, RankType>,
  centerChiefThresholdByMemberId: Map<string, CenterChiefPromotionThreshold | null>,
  externalIdByMemberId?: ReadonlyMap<string, string | null | undefined>,
): Map<string, DivisionHeadPromotionThreshold | null> {
  const out = new Map<string, DivisionHeadPromotionThreshold | null>();
  for (const [memberId, rank] of rankById) {
    if (rank !== '사업본부장' && rank !== '센터장') {
      out.set(memberId, null);
      continue;
    }
    out.set(
      memberId,
      computeDivisionHeadThresholdForMember(
        memberId,
        treeRows,
        rankById,
        centerChiefThresholdByMemberId,
        externalIdByMemberId,
      ),
    );
  }
  return out;
}

/** 감사·표시용 */
export function divisionHeadPostRateStartsYmd(threshold: DivisionHeadPromotionThreshold): string {
  return String(threshold.threshold_join_date).slice(0, 10);
}

/** @internal 테스트/디버그용 */
export function contractOrderYmdForDivisionHead(contract: {
  join_date: string;
  happy_call_at?: string | null;
}): string {
  return contractJoinOrderYmd(contract);
}
