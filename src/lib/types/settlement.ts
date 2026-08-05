import type { RankType } from './organization';
import type { PromotionCommissionSplit, PromotionEventWalkMismatch, PromotionEventValidation } from '@/lib/settlement/leader-promotion';

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
  /** 코드 선발급 특례: 적용 단가/한도 분할 (직접판매 개인수당에만 사용) */
  pre_issued_special_applied?: boolean;
  pre_issued_special_units?: number;
  pre_issued_special_unit_price?: number;
  pre_issued_normal_units?: number;
  pre_issued_normal_unit_price?: number;
  pre_issued_special_amount?: number;
  pre_issued_normal_amount?: number;
  pre_issued_special_units_before?: number;
  pre_issued_special_units_after?: number;
  pre_issued_remaining_special_units_after?: number;
  /** 승격 누적 walk 검증용 (리더/영업사원 직접 계약) */
  promotion_cumulative_units_before?: number;
  promotion_cumulative_units_after?: number;
  promotion_is_promotion_contract?: boolean;
  promotion_reason?: string;
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

/**
 * 롤업수당의 계약 단위 근거(정산 계산 시점에 그대로 캡처해 저장).
 *
 * 주의:
 * - 이 배열은 정산 계산 로직의 결정을 바꾸지 않고, 결정된 결과를 계약 단위로 기록만 한다.
 * - subtotal 합계는 monthly_settlements.rollup_commission 및 sum(calculation_detail.rollup_items[].subtotal)와 일치한다.
 *   (구좌당 평균 단가의 표시용 반올림 외에는 동일해야 한다)
 */
export interface RollupContractItem {
  contract_id: string;
  contract_code: string;
  /** 롤업이 귀속된 "직속 자식 노드" (조직도에서 자기 다음 단계). 멤버 단위 rollup_items.from_member_id와 동일 의미. */
  from_member_id: string;
  from_member_name: string;
  from_rank: RankType;
  /**
   * 실제로 그 계약이 매달려 있던 멤버(subtree leaf). attributed origin / settlement_sales_member 등으로 결정된 결과.
   * 화면에서 "실제 계약 담당자" 컬럼으로 표시한다.
   */
  effective_sales_member_id: string;
  effective_sales_member_name?: string;
  effective_sales_member_rank?: RankType;
  unit_count: number;
  /** 해당 계약의 (상위 단가 - 하위 단가) — 계약 단위 정확값(평균 아님) */
  rollup_amount_per_unit: number;
  /** rollup_amount_per_unit * unit_count */
  subtotal: number;
  /** 디버그/분류용 라벨: 'direct_child' | 'previous_leader_pre_promotion' 등 */
  included_reason?: string;
  /** 계약 가입일 (감사) */
  contract_join_date?: string;
  /** 계약 해피콜 완료일 YMD (감사) */
  contract_happy_call_ymd?: string | null;
  /** 센터장 기준 조직 경로 (감사) */
  org_path_label?: string;
  /** 센터장 승급 확정일 = 5번째 리더 승급 계약 해피콜 완료일 */
  center_chief_promotion_confirmed_ymd?: string | null;
  /** 센터장 승급 계약 순서일(이 계약 다음부터 차액 롤업 적용) */
  center_chief_rate_starts_ymd?: string | null;
  /** LEADER_BEFORE_CENTER | CENTER_AFTER_PROMOTION */
  center_chief_rollup_segment?: 'LEADER_BEFORE_CENTER' | 'CENTER_AFTER_PROMOTION';
  /** 롤업 상위에 적용한 직급 (승급 전 구간은 리더) */
  upper_rank_applied?: RankType;
  /** 상위 직급 직접계약 단가 */
  upper_direct_commission_per_unit?: number;
  /** 직속 자식 직급 직접계약 단가 */
  lower_direct_commission_per_unit?: number;
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
  /** 정산월 말(25일) 기준 산하 '가입' 실제 구좌 합 (보너스·유지장려 판정) */
  subtree_join_units_join_status_as_of_end: number;
  /** 정산월 말 기준 산하 승급 인정 walk 누적 (더블업 반영) */
  subtree_promotion_eligible_units_as_of_end?: number;
  /** 더블업 안내 문구 (수당·보너스는 실제 구좌 기준) */
  double_up_commission_note?: string | null;
  /** 표시용: 적용 단가 설명 */
  commission_rate_label: string;
  /** 적용 단가(대표값): 혼합 월은 null */
  applied_commission_per_unit: number | null;
  /** DB 규칙 기반 유지 장려금(기존 incentive_amount에 들어가는 부분) */
  rule_incentive_amount: number;
  /** 리더 유지(당월 25일까지 20구좌 이상) 1회성 장려금 */
  leader_maintenance_bonus_amount: number;
  leader_maintenance_bonus_eligible: boolean;
  /** 산하 전체 가입 누적 walk 기준 수당 판정 근거 (검증용) */
  promotion_commission_audit?: PromotionCommissionSplit[];
  /** 승급 이벤트 vs walk 누적 불일치 감사 (하위 호환 요약) */
  promotion_event_walk_mismatch?: PromotionEventWalkMismatch | null;
  /** 승급 이벤트 신뢰도·감사 전체 */
  promotion_event_validation?: PromotionEventValidation | null;
}

export interface SettlementCalculationDetail {
  year_month: string;
  member_id: string;
  member_name: string;
  rank: RankType;
  rule_id: string;
  direct_contracts: ContractSettlementItem[];
  rollup_items: RollupItem[];
  /**
   * 롤업수당을 발생시킨 계약 단위 근거.
   * 기존 정산 데이터에는 없을 수 있으므로 옵션 필드로 둔다.
   * 합계 검증:
   *   sum(rollup_contract_items[].subtotal) === sum(rollup_items[].subtotal) === MonthlySettlement.rollup_commission
   */
  rollup_contract_items?: RollupContractItem[];
  incentive_applied: boolean;
  incentive_threshold: number | null;
  /** 보너스 합계 = 리더 유지장려금 + 그룹 보너스 + 센터장 산하 보너스 */
  incentive_amount: number;
  leader_promotion?: LeaderPromotionSettlementDetail | null;
  /**
   * 2026-06 한정 그룹 보너스(가입일+고객명+담당사원 그룹화, 2구좌당 5만원).
   * 유지장려금과 별도로 계산되어 incentive_amount에 합산되어 들어간다.
   */
  group_bonus_amount?: number;
  /**
   * 센터장 월정산 보너스(산하 정산 대상 100구좌 이상 시 300만원, 하위 센터장 조직 제외).
   * incentive_amount에 합산된다.
   */
  center_chief_subtree_bonus_amount?: number;
  /** 센터장 보너스 판정에 사용한 당월 산하 정산 구좌 합(하위 센터장 제외) */
  center_chief_subtree_units_in_month?: number;
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
