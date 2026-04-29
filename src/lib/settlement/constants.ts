import type { RankType } from '../types/organization';
import type { ContractStatus } from '../types/contract';

/** 1구좌당 기준 매출액 (원) */
export const BASE_AMOUNT_PER_UNIT = 715_000;

/**
 * 직급별 기본 수당 (1구좌당 원).
 * 사업본부장은 DB(settlement_rules)에서 조회 — 이 상수에 넣지 않음.
 */
export const DEFAULT_COMMISSION_BY_RANK: Partial<Record<RankType, number>> = {
  영업사원: 300_000,
  리더: 400_000,
  센터장: 500_000,
  // 사업본부장: settlement_rules 테이블에서 조회
  // 본사: 해당 없음
};

/**
 * 유지 장려금 기본 설정.
 * settlement_rules가 없을 때 폴백으로 사용.
 */
export const DEFAULT_INCENTIVE_CONFIG: Partial<
  Record<RankType, { threshold: number; amount: number }>
> = {
  리더: { threshold: 20, amount: 1_000_000 },
  센터장: { threshold: 100, amount: 3_000_000 },
  사업본부장: { threshold: 300, amount: 5_000_000 },
};

/** 정산에서 항상 제외되는 상태 */
export const SETTLEMENT_EXCLUDED_STATUSES: readonly ContractStatus[] = [
  '취소',
  '해약',
] as const;

/** 특정 물품 계약 차감 기준: 2구좌당 10만원 (= 1구좌당 5만원) */
export const COMMISSION_PENALTY_PER_UNIT_WON = 50_000;

/** 물품명이 펫버틀러 패널티 대상이면 건당 차감액(양수), 아니면 0 */
export function commissionPenaltyWonForItemName(
  itemName: string | null | undefined,
  unitCount?: number | null,
): number {
  const t = (itemName ?? '').trim();
  if (!t) return 0;
  // 요구: 차감 금액은 유지하되, 물품명에 '에코백스'가 포함될 때만 차감
  if (!t.includes('에코백스')) return 0;
  const units = Math.max(0, Number(unitCount ?? 0));
  return units * COMMISSION_PENALTY_PER_UNIT_WON;
}
