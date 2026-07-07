import type { RankType } from '@/lib/types/organization';
import { DEFAULT_INCENTIVE_CONFIG } from './constants';

/**
 * 센터장 월정산 보너스: 해당 정산월에 산하(본인 포함 조직 전체) 정산 대상 구좌가
 * 기준 이상이면 지급. (DEFAULT_INCENTIVE_CONFIG.센터장: 100구좌 / 300만원)
 */
export function calculateCenterChiefSubtreeBonus(params: {
  rank: RankType;
  /** 정산월 대상 계약 기준, 센터장 조직 subtree 전체 구좌 합(본인 직접 포함) */
  subtreeSettlementUnits: number;
}): number {
  if (params.rank !== '센터장') return 0;
  const cfg = DEFAULT_INCENTIVE_CONFIG.센터장;
  if (!cfg) return 0;
  if (params.subtreeSettlementUnits < cfg.threshold) return 0;
  return cfg.amount;
}

export function centerChiefSubtreeBonusThreshold(): number {
  return DEFAULT_INCENTIVE_CONFIG.센터장?.threshold ?? 100;
}
