import type { RankType } from '@/lib/types/organization';
import type { RollupContractItem } from '@/lib/types/settlement';
import type { PromotionOrderContractRef, SalesMemberPromotionThreshold } from '@/lib/settlement/leader-promotion';
import {
  centerChiefPostRollupStartsYmd,
  displayCenterChiefPromotionConfirmedYmd,
  splitContractUnitsByCenterChiefThreshold,
  type CenterChiefPromotionThreshold,
} from '@/lib/settlement/center-chief-promotion';
import type { DivisionHeadPromotionThreshold } from '@/lib/settlement/division-head-promotion';
import { isContractAtOrAfterDivisionHeadPostRate } from '@/lib/settlement/division-head-promotion';
import { contractJoinOrderYmd } from '@/lib/settlement/leader-promotion';

/** 리더 롤업 수당 구간 */
export type LeaderRollupSegment = 'SALES_BEFORE_LEADER' | 'LEADER_AFTER_PROMOTION';

export function leaderRollupSegmentLabel(
  phase: 'pre' | 'post',
  nodeRank: RankType,
): LeaderRollupSegment | undefined {
  if (nodeRank !== '리더' && nodeRank !== '영업사원') return undefined;
  return phase === 'pre' ? 'SALES_BEFORE_LEADER' : 'LEADER_AFTER_PROMOTION';
}

export function buildLeaderRollupAuditFields(params: {
  contract: PromotionOrderContractRef & { join_date: string };
  nodeName: string;
  nodeRank: RankType;
  childName: string;
  ownerName: string;
  threshold: SalesMemberPromotionThreshold | null;
  phase: 'pre' | 'post';
  upperRankApplied: RankType;
  upperDirectCommissionPerUnit: number;
  lowerDirectCommissionPerUnit: number;
}): Pick<
  RollupContractItem,
  | 'contract_join_date'
  | 'contract_happy_call_ymd'
  | 'org_path_label'
  | 'leader_promotion_confirmed_ymd'
  | 'leader_rollup_segment'
  | 'upper_rank_applied'
  | 'upper_direct_commission_per_unit'
  | 'lower_direct_commission_per_unit'
> {
  const hcYmd = contractJoinOrderYmd(params.contract);
  const segment = leaderRollupSegmentLabel(params.phase, params.nodeRank);
  const confirmed = displayCenterChiefPromotionConfirmedYmd(
    params.threshold?.threshold_join_date ?? null,
  );

  return {
    contract_join_date: String(params.contract.join_date ?? '').slice(0, 10) || undefined,
    contract_happy_call_ymd: hcYmd || null,
    org_path_label: `${params.nodeName} → ${params.childName} → ${params.ownerName}`,
    leader_promotion_confirmed_ymd: confirmed,
    leader_rollup_segment: segment,
    upper_rank_applied: params.upperRankApplied,
    upper_direct_commission_per_unit: params.upperDirectCommissionPerUnit,
    lower_direct_commission_per_unit: params.lowerDirectCommissionPerUnit,
  };
}

/** 사업본부장 롤업 수당 구간 */
export type DivisionHeadRollupSegment = 'CENTER_BEFORE_DIVISION' | 'DIVISION_AFTER_PROMOTION';

export type DivisionHeadRollupUnitSplit = {
  preDivisionHeadUnits: number;
  postDivisionHeadUnits: number;
};

/**
 * 사업본부장(DB) 기준 계약별 롤업 구간 분할.
 * - threshold 없음: 전량 CENTER_BEFORE_DIVISION (센터장 단가 차액)
 * - threshold 있음: 3번째 센터장 승급 계약 다음부터 DIVISION_AFTER_PROMOTION
 */
export function splitDivisionHeadRollupUnits(
  contract: PromotionOrderContractRef & { unit_count: number },
  nodeRank: RankType,
  threshold: DivisionHeadPromotionThreshold | null,
): DivisionHeadRollupUnitSplit {
  const total = Math.max(0, contract.unit_count);
  if (nodeRank !== '사업본부장' || total === 0) {
    return { preDivisionHeadUnits: total, postDivisionHeadUnits: 0 };
  }
  if (!threshold) {
    return { preDivisionHeadUnits: total, postDivisionHeadUnits: 0 };
  }
  if (isContractAtOrAfterDivisionHeadPostRate(contract, threshold)) {
    return { preDivisionHeadUnits: 0, postDivisionHeadUnits: total };
  }
  return { preDivisionHeadUnits: total, postDivisionHeadUnits: 0 };
}

export function divisionHeadRollupSegmentLabel(
  phase: 'pre' | 'post',
  nodeRank: RankType,
): DivisionHeadRollupSegment | undefined {
  if (nodeRank !== '사업본부장') return undefined;
  return phase === 'pre' ? 'CENTER_BEFORE_DIVISION' : 'DIVISION_AFTER_PROMOTION';
}

export function buildDivisionHeadRollupAuditFields(params: {
  contract: PromotionOrderContractRef & { join_date: string };
  nodeName: string;
  nodeRank: RankType;
  childName: string;
  ownerName: string;
  threshold: DivisionHeadPromotionThreshold | null;
  phase: 'pre' | 'post';
  upperRankApplied: RankType;
  upperDirectCommissionPerUnit: number;
  lowerDirectCommissionPerUnit: number;
}): Pick<
  RollupContractItem,
  | 'contract_join_date'
  | 'contract_happy_call_ymd'
  | 'org_path_label'
  | 'upper_rank_applied'
  | 'upper_direct_commission_per_unit'
  | 'lower_direct_commission_per_unit'
> & {
  division_head_promotion_confirmed_ymd?: string | null;
  division_head_rate_starts_ymd?: string | null;
  division_head_rollup_segment?: DivisionHeadRollupSegment;
} {
  const hcYmd = contractJoinOrderYmd(params.contract);
  const segment = divisionHeadRollupSegmentLabel(params.phase, params.nodeRank);
  const confirmed = displayCenterChiefPromotionConfirmedYmd(
    params.threshold?.threshold_join_date ?? null,
  );

  return {
    contract_join_date: String(params.contract.join_date ?? '').slice(0, 10) || undefined,
    contract_happy_call_ymd: hcYmd || null,
    org_path_label: `${params.nodeName} → ${params.childName} → ${params.ownerName}`,
    division_head_promotion_confirmed_ymd: confirmed,
    division_head_rate_starts_ymd: confirmed,
    division_head_rollup_segment: segment,
    upper_rank_applied: params.upperRankApplied,
    upper_direct_commission_per_unit: params.upperDirectCommissionPerUnit,
    lower_direct_commission_per_unit: params.lowerDirectCommissionPerUnit,
  };
}

/** 센터장 롤업 수당 구간 (감사·정산 상세용) */
export type CenterChiefRollupSegment = 'LEADER_BEFORE_CENTER' | 'CENTER_AFTER_PROMOTION';

export type CenterChiefRollupUnitSplit = {
  preCenterChiefUnits: number;
  postCenterChiefUnits: number;
};

/**
 * 센터장(DB) 기준 계약별 롤업 구간 분할.
 * - threshold 없음(5명 미달 등): 전량 LEADER_BEFORE_CENTER
 * - threshold 있음: 승급 계약 다음 계약부터 CENTER_AFTER_PROMOTION (리더 승급과 동일)
 */
export function splitCenterChiefRollupUnits(
  contract: PromotionOrderContractRef & { unit_count: number },
  nodeRank: RankType,
  threshold: CenterChiefPromotionThreshold | null,
): CenterChiefRollupUnitSplit {
  const total = Math.max(0, contract.unit_count);
  if (nodeRank !== '센터장' || total === 0) {
    return { preCenterChiefUnits: total, postCenterChiefUnits: 0 };
  }
  return splitContractUnitsByCenterChiefThreshold(contract, threshold);
}

export function centerChiefRollupSegmentLabel(
  phase: 'pre' | 'post',
  nodeRank: RankType,
): CenterChiefRollupSegment | undefined {
  if (nodeRank !== '센터장') return undefined;
  return phase === 'pre' ? 'LEADER_BEFORE_CENTER' : 'CENTER_AFTER_PROMOTION';
}

export function buildCenterChiefRollupAuditFields(params: {
  contract: PromotionOrderContractRef & { join_date: string };
  nodeName: string;
  nodeRank: RankType;
  childName: string;
  ownerName: string;
  threshold: CenterChiefPromotionThreshold | null;
  phase: 'pre' | 'post';
  upperRankApplied: RankType;
  upperDirectCommissionPerUnit: number;
  lowerDirectCommissionPerUnit: number;
}): Pick<
  RollupContractItem,
  | 'contract_join_date'
  | 'contract_happy_call_ymd'
  | 'org_path_label'
  | 'center_chief_promotion_confirmed_ymd'
  | 'center_chief_rate_starts_ymd'
  | 'center_chief_rollup_segment'
  | 'upper_rank_applied'
  | 'upper_direct_commission_per_unit'
  | 'lower_direct_commission_per_unit'
> {
  const hcYmd = contractJoinOrderYmd(params.contract);
  const segment = centerChiefRollupSegmentLabel(params.phase, params.nodeRank);
  const confirmed = displayCenterChiefPromotionConfirmedYmd(
    params.threshold?.threshold_join_date ?? null,
  );
  const rateStarts = confirmed ? centerChiefPostRollupStartsYmd(params.threshold!) : null;

  return {
    contract_join_date: String(params.contract.join_date ?? '').slice(0, 10) || undefined,
    contract_happy_call_ymd: hcYmd || null,
    org_path_label: `${params.nodeName} → ${params.childName} → ${params.ownerName}`,
    center_chief_promotion_confirmed_ymd: confirmed,
    center_chief_rate_starts_ymd: rateStarts,
    center_chief_rollup_segment: segment,
    upper_rank_applied: params.upperRankApplied,
    upper_direct_commission_per_unit: params.upperDirectCommissionPerUnit,
    lower_direct_commission_per_unit: params.lowerDirectCommissionPerUnit,
  };
}
