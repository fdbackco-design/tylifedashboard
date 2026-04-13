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
