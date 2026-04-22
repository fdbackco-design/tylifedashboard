import type { RankType } from './organization';

export interface SettlementRule {
  id: string;
  rank: RankType;
  /** 기준 매출액 (1구좌당 원) */
  base_amount_per_unit: number;
  /** 직급별 수당 (1구좌당 원) */
  commission_per_unit: number;
  /** 유지 장려금 기준 구좌 수. null이면 장려금 없음 */
  incentive_unit_threshold: number | null;
  /** 유지 장려금 금액 */
  incentive_amount: number | null;
  effective_from: string; // 'YYYY-MM-DD'
  effective_until: string | null;
  note: string | null;
  created_at: string;
}

export interface ContractSettlementItem {
  contract_id: string;
  contract_code: string;
  unit_count: number;
  commission_per_unit: number;
  subtotal: number;
}

export interface RollupItem {
  from_member_id: string;
  from_member_name: string;
  from_rank: RankType;
  unit_count: number;
  /** 상위 직급 수당 - 하위 직급 수당 */
  rollup_amount_per_unit: number;
  subtotal: number;
}

/** 리더 승격(영업사원 → 산하 가입 20구좌) 및 유지 장려금 UI용 */
export interface LeaderPromotionSettlementDetail {
  /** DB 저장 직급 */
  db_rank: RankType;
  /** 승격 규칙 반영 후 리더로 볼지(영업사원이 산하 가입 20구좌 달성한 경우 등) */
  effective_is_leader: boolean;
  /** 산하 '가입' 누적 20구좌를 채운 계약의 가입일(없으면 null) */
  leader_promotion_first_join_date: string | null;
  /** 위와 동일한 '승격 계약' 식별자(같은 가입일 구분용) */
  leader_promotion_threshold_contract_id: string | null;
  /** 정산월 말(25일) 기준 산하 '가입' 구좌 합 */
  subtree_join_units_join_status_as_of_end: number;
  /** 표시용: 적용 단가 설명 */
  commission_rate_label: string;
  /** 적용 단가(대표값): 혼합 월은 null */
  applied_commission_per_unit: number | null;
  /** DB 규칙 기반 유지 장려금(기존 incentive_amount에 들어가는 부분) */
  rule_incentive_amount: number;
  /** 리더 유지(당월 25일까지 20구좌 이상) 1회성 장려금 */
  leader_maintenance_bonus_amount: number;
  leader_maintenance_bonus_eligible: boolean;
}

export interface SettlementCalculationDetail {
  year_month: string;
  member_id: string;
  member_name: string;
  rank: RankType;
  rule_id: string;
  direct_contracts: ContractSettlementItem[];
  rollup_items: RollupItem[];
  incentive_applied: boolean;
  incentive_threshold: number | null;
  incentive_amount: number;
  leader_promotion?: LeaderPromotionSettlementDetail | null;
  /** 특정 멤버 예외/수동 조정(합계 수당에 가감) */
  manual_adjustment_won?: number;
  manual_adjustment_reason?: string | null;
}

export interface MonthlySettlement {
  id: string;
  /** 'YYYY-MM' */
  year_month: string;
  member_id: string;
  rank: RankType;
  direct_contract_count: number;
  direct_unit_count: number;
  subordinate_unit_count: number;
  total_unit_count: number;
  base_commission: number;
  rollup_commission: number;
  incentive_amount: number;
  total_amount: number;
  calculation_detail: SettlementCalculationDetail | null;
  is_finalized: boolean;
  created_at: string;
  updated_at: string;
}

export interface MonthlySettlementInsert {
  year_month: string;
  member_id: string;
  rank: RankType;
  direct_contract_count: number;
  direct_unit_count: number;
  subordinate_unit_count: number;
  total_unit_count: number;
  base_commission: number;
  rollup_commission: number;
  incentive_amount: number;
  total_amount: number;
  calculation_detail: SettlementCalculationDetail;
  is_finalized?: boolean;
}

/** 정산 페이지 필터 */
export interface SettlementFilter {
  year_month: string;
  member_id?: string;
  rank?: RankType;
}
