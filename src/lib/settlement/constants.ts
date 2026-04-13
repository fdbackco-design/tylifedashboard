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

/**
 * 정산 대상 계약 상태 (is_cancelled=false 이고 이 상태에 해당해야 함).
 * 취소/해약은 제외.
 */
export const SETTLEMENT_ELIGIBLE_STATUSES: readonly ContractStatus[] = [
  '해피콜완료',
  '배송준비',
  '배송완료',
  '정산완료',
] as const;

/** 정산에서 항상 제외되는 상태 */
export const SETTLEMENT_EXCLUDED_STATUSES: readonly ContractStatus[] = [
  '취소',
  '해약',
] as const;
