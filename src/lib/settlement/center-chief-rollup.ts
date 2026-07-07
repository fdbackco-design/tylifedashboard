import type { RankType } from '@/lib/types/organization';
import type { RollupContractItem } from '@/lib/types/settlement';
import type { PromotionOrderContractRef } from '@/lib/settlement/leader-promotion';
import {
  centerChiefPostRollupStartsYmd,
  type CenterChiefPromotionThreshold,
} from '@/lib/settlement/center-chief-promotion';
import { contractJoinOrderYmd } from '@/lib/settlement/leader-promotion';

/** 센터장 롤업 수당 구간 (감사·정산 상세용) */
export type CenterChiefRollupSegment = 'LEADER_BEFORE_CENTER' | 'CENTER_AFTER_PROMOTION';

export type CenterChiefRollupUnitSplit = {
  preCenterChiefUnits: number;
  postCenterChiefUnits: number;
};

/**
 * 센터장(DB) 기준 계약별 롤업 구간 분할.
 * - threshold 없음(5명 미달 등): 전량 LEADER_BEFORE_CENTER
 * - threshold 있음: 해피콜 완료일 다음날부터 CENTER_AFTER_PROMOTION
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
  if (!threshold) {
    return { preCenterChiefUnits: total, postCenterChiefUnits: 0 };
  }
  const orderYmd = contractJoinOrderYmd(contract);
  const postStarts = centerChiefPostRollupStartsYmd(threshold);
  if (orderYmd >= postStarts) {
    return { preCenterChiefUnits: 0, postCenterChiefUnits: total };
  }
  return { preCenterChiefUnits: total, postCenterChiefUnits: 0 };
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
  const confirmed = params.threshold?.threshold_join_date ?? null;
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
