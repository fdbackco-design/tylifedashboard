import { resolveHqProductKindFromContract } from '@/lib/settlement/hq-revenue';
import {
  happycallYmdSeoul,
  SETTLEMENT_VALID_HAPPYCALL_RESULTS,
} from '@/lib/settlement/settlement-eligibility-v2';
import { hasValidInvoiceNo } from '@/lib/utils/invoice-no';

/** 썸머 페스티벌(파타야) 참가 자격 산출 (전용 집계; 승급/정산/더블업과 무관) */
export const SUMMER_FESTIVAL_NAME = '썸머 페스티벌(파타야)';

export const SUMMER_FESTIVAL_START_YMD = '2026-06-26';
export const SUMMER_FESTIVAL_END_YMD = '2026-08-25';

export const SUMMER_FESTIVAL_DOUBLE_WINDOW_END_YMD = '2026-07-25';

const SUMMER_FESTIVAL_START_MS = Date.parse('2026-06-26T00:00:00+09:00');
const SUMMER_FESTIVAL_END_MS = Date.parse('2026-08-25T23:59:59+09:00');

const SUMMER_FESTIVAL_DOUBLE_START_MS = Date.parse('2026-06-26T00:00:00+09:00');
const SUMMER_FESTIVAL_DOUBLE_END_MS = Date.parse('2026-07-25T23:59:59+09:00');

export type SummerFestivalPeriodMultiplier = 1 | 2;

export type SummerFestivalProductKind = 'care_or_light' | 'general_appliance' | 'unknown_review';

export type SummerFestivalContractInput = {
  id: string;
  contract_code?: string | null;
  sales_member_id: string | null;
  customer_id?: string | null;
  customer_name?: string | null;
  sales_member_name?: string | null;
  unit_count: number | null;
  status?: string | null;
  is_cancelled?: boolean | null;
  sales_link_status?: string | null;
  happy_call_at?: unknown;
  happycall_result?: string | null;
  invoice_no?: string | null;
  product_type?: string | null;
  item_name?: string | null;
  source_snapshot_json?: Record<string, string | null> | null;
};

export type SummerFestivalExclusionReason =
  | 'NO_SALES_MEMBER'
  | 'CANCELLED'
  | 'SALES_NOT_LINKED'
  | 'NO_HAPPYCALL_AT'
  | 'HAPPYCALL_NOT_SUCCESS'
  | 'INVOICE_MISSING'
  | 'STATUS_NOT_ELIGIBLE'
  | 'OUTSIDE_WINDOW';

export type SummerFestivalDecision =
  | { eligible: true; happycall_ymd: string }
  | { eligible: false; exclusion_reason: SummerFestivalExclusionReason };

/**
 * 썸머 집계 대상(= 가입으로 판단되는 계약) + 해피콜 완료일 기준 윈도우 포함 여부.
 * - 산하/조직 귀속은 집계에서 일절 하지 않는다(직접판매 only).
 * - 담당 영업자 = contracts.sales_member_id.
 */
export function evaluateSummerFestivalEligibility(
  c: Pick<
    SummerFestivalContractInput,
    | 'sales_member_id'
    | 'is_cancelled'
    | 'sales_link_status'
    | 'status'
    | 'happy_call_at'
    | 'happycall_result'
    | 'invoice_no'
  >,
): SummerFestivalDecision {
  if (!c.sales_member_id) return { eligible: false, exclusion_reason: 'NO_SALES_MEMBER' };
  if (c.is_cancelled) return { eligible: false, exclusion_reason: 'CANCELLED' };
  if ((c.sales_link_status ?? 'linked') !== 'linked') {
    return { eligible: false, exclusion_reason: 'SALES_NOT_LINKED' };
  }
  const hcYmd = happycallYmdSeoul(c.happy_call_at);
  if (!hcYmd) return { eligible: false, exclusion_reason: 'NO_HAPPYCALL_AT' };
  if (!isSummerFestivalWindow(c.happy_call_at)) {
    return { eligible: false, exclusion_reason: 'OUTSIDE_WINDOW' };
  }

  const status = String(c.status ?? '').trim();
  // 취소·해약·무효 계약은 무조건 제외 (운영 안전)
  if (status === '취소' || status === '해약' || status === '계약취소' || status === '무효') {
    return { eligible: false, exclusion_reason: 'STATUS_NOT_ELIGIBLE' };
  }

  // 해피콜 결과가 성공/완료(SETTLEMENT_VALID_HAPPYCALL_RESULTS)인 계약만 인정
  const hc = String(c.happycall_result ?? '').trim();
  if (!SETTLEMENT_VALID_HAPPYCALL_RESULTS.has(hc)) {
    return { eligible: false, exclusion_reason: 'HAPPYCALL_NOT_SUCCESS' };
  }

  // 가입으로 판단 가능한 계약만 인정 (기존 join 인정과 유사하되, 썸머는 "성공/완료" 필터가 항상 선행)
  if (status === '가입') return { eligible: true, happycall_ymd: hcYmd };
  if (status === '준비' || status === '대기') {
    if (!hasValidInvoiceNo(c.invoice_no)) {
      return { eligible: false, exclusion_reason: 'INVOICE_MISSING' };
    }
    return { eligible: true, happycall_ymd: hcYmd };
  }

  return { eligible: false, exclusion_reason: 'STATUS_NOT_ELIGIBLE' };
}

/** 2026-06-26 00:00:00 이상, 2026-08-25 23:59:59 이하 */
export function isSummerFestivalWindow(happyCallAt: unknown): boolean {
  if (happyCallAt == null) return false;
  const ymd = happycallYmdSeoul(happyCallAt);
  if (!ymd) return false;
  if (ymd < SUMMER_FESTIVAL_START_YMD || ymd > SUMMER_FESTIVAL_END_YMD) return false;
  if (typeof happyCallAt === 'string' || happyCallAt instanceof Date) {
    const ms = happyCallAt instanceof Date ? happyCallAt.getTime() : Date.parse(String(happyCallAt));
    if (!Number.isNaN(ms)) {
      if (ms < SUMMER_FESTIVAL_START_MS || ms > SUMMER_FESTIVAL_END_MS) return false;
    }
  }
  return true;
}

/** 2026-06-26~2026-07-25 => ×2, 2026-07-26~2026-08-25 => ×1 */
export function summerFestivalPeriodMultiplier(happyCallAt: unknown): SummerFestivalPeriodMultiplier {
  if (!isSummerFestivalWindow(happyCallAt)) return 1;
  const ymd = happycallYmdSeoul(happyCallAt);
  if (!ymd) return 1;
  if (ymd > SUMMER_FESTIVAL_DOUBLE_WINDOW_END_YMD) return 1;
  if (typeof happyCallAt === 'string' || happyCallAt instanceof Date) {
    const ms = happyCallAt instanceof Date ? happyCallAt.getTime() : Date.parse(String(happyCallAt));
    if (!Number.isNaN(ms)) {
      if (ms < SUMMER_FESTIVAL_DOUBLE_START_MS || ms > SUMMER_FESTIVAL_DOUBLE_END_MS) return 1;
    }
  }
  return 2;
}

export function summerFestivalProductKind(c: Pick<
  SummerFestivalContractInput,
  'product_type' | 'item_name' | 'source_snapshot_json'
>): SummerFestivalProductKind {
  const kind = resolveHqProductKindFromContract({
    product_type: c.product_type ?? null,
    item_name: c.item_name ?? null,
    source_snapshot_json: c.source_snapshot_json ?? null,
  });
  if (kind === 'TY스페셜라이프케어') return 'general_appliance';
  if (kind === 'TY갤럭시케어' || kind === '올라이프케어' || kind === '갤럭시케어 라이트') {
    return 'care_or_light';
  }
  return 'unknown_review';
}

export function summerFestivalBaseWeight(c: Pick<
  SummerFestivalContractInput,
  'product_type' | 'item_name' | 'source_snapshot_json'
>): number {
  const pk = summerFestivalProductKind(c);
  if (pk === 'general_appliance') return 0.5;
  // 기본 규칙: (TY)스페셜라이프케어 외(갤럭시케어/올라이프/라이트 등) = 1.0
  return 1.0;
}

export function summerFestivalPerUnitValue(params: {
  baseWeight: number;
  periodMultiplier: SummerFestivalPeriodMultiplier;
}): number {
  const raw = params.baseWeight * params.periodMultiplier;
  return Math.min(1.0, raw);
}

export type SummerFestivalContractAuditRow = {
  contract_id: string;
  contract_code: string | null;
  happycall_ymd: string | null;
  happycall_result: string | null;
  contract_status: string | null;
  sales_member_id: string | null;
  sales_member_name: string | null;
  customer_id: string | null;
  customer_name: string | null;
  attribution_sales_label: string | null;
  product_raw_name: string | null;
  product_standard_category: string;
  product_kind: SummerFestivalProductKind;
  actual_unit_count: number;
  base_weight: number;
  period_multiplier: SummerFestivalPeriodMultiplier;
  per_unit_value: number;
  summer_units: number;
  eligible: boolean;
  exclusion_reason: SummerFestivalExclusionReason | null;
};

export function buildSummerFestivalContractAuditRow(
  c: SummerFestivalContractInput,
): SummerFestivalContractAuditRow {
  const actualUnits = Math.max(0, c.unit_count ?? 0);
  const hcYmd = happycallYmdSeoul(c.happy_call_at) || null;
  const decision = evaluateSummerFestivalEligibility(c);
  const baseWeight = summerFestivalBaseWeight(c);
  const multiplier = summerFestivalPeriodMultiplier(c.happy_call_at);
  const perUnit = summerFestivalPerUnitValue({ baseWeight, periodMultiplier: multiplier });
  const summerUnits = decision.eligible ? actualUnits * perUnit : 0;
  const rawName = [
    c.product_type,
    c.item_name,
    c.source_snapshot_json?.['상품명'],
  ]
    .map((t) => String(t ?? '').trim())
    .filter(Boolean)
    .join(' / ');
  const standardCategory =
    summerFestivalProductKind(c) === 'general_appliance'
      ? '스페셜라이프케어'
      : summerFestivalProductKind(c) === 'care_or_light'
        ? '케어·라이트'
        : '검토 필요';
  return {
    contract_id: c.id,
    contract_code: c.contract_code ?? null,
    happycall_ymd: hcYmd,
    happycall_result: c.happycall_result ? String(c.happycall_result) : null,
    contract_status: c.status ? String(c.status) : null,
    sales_member_id: c.sales_member_id ?? null,
    sales_member_name: c.sales_member_name ?? null,
    customer_id: c.customer_id ?? null,
    customer_name: c.customer_name ?? null,
    attribution_sales_label:
      c.sales_member_id ? '계약 담당 영업자(직접판매)' : null,
    product_raw_name: rawName || null,
    product_standard_category: standardCategory,
    product_kind: summerFestivalProductKind(c),
    actual_unit_count: actualUnits,
    base_weight: baseWeight,
    period_multiplier: multiplier,
    per_unit_value: perUnit,
    summer_units: summerUnits,
    eligible: decision.eligible,
    exclusion_reason: decision.eligible ? null : decision.exclusion_reason,
  };
}

export type SummerFestivalStatus =
  | '참가 확정'
  | '근접 대상'
  | '진행 중'
  | '실적 없음';

export function summerFestivalStatus(totalSummerUnits: number): SummerFestivalStatus {
  if (totalSummerUnits >= 20) return '참가 확정';
  if (totalSummerUnits >= 10) return '근접 대상';
  if (totalSummerUnits >= 1) return '진행 중';
  return '실적 없음';
}

