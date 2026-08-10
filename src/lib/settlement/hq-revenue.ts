import { BASE_AMOUNT_PER_UNIT } from './constants';
import { isOrganizationKpiEligibleContract, type OrganizationKpiContractInput } from './kpi-eligibility';
import { isSettlementEligibleContract } from './settlement-eligibility';
import {
  evaluateContractEligibility,
  happycallYmdSeoul,
  type ContractEligibilityInput,
} from './settlement-eligibility-v2';
import { contractJoinYmdInInclusiveWindow } from './settlement-window';

export type HqRevenueEligibilityMode = 'kpi' | 'settlement_v2_static';
/** 이번달(기간) 매출 집계 방식 */
export type HqRevenuePeriodEligibilityMode = 'calendar_window' | 'settlement_v2_monthly';
export type HqRevenuePeriodDateField = 'join_date' | 'happy_call_at';

/** TY갤럭시케어 본사 매출 단가 변경 적용 시작일 (당일 포함 770,000원) */
export const TY_GALAXY_CARE_HQ_PRICE_INCREASE_DATE = '2026-06-26';

/**
 * 본사 매출 단가(원/구좌).
 * - TY갤럭시케어: 해피콜 완료일 2026-06-26 이전 715,000 / 이후(7월 정산 포함) 770,000
 * - TY스페셜라이프케어·TY썬크루즈: 550,000 (7월 정산 기준)
 */
export const HQ_REVENUE_UNIT_PRICES = {
  TY갤럭시케어: { beforeIncrease: 715_000, fromIncrease: 770_000 },
  올라이프케어: 605_000,
  TY스페셜라이프케어: 550_000,
  '갤럭시케어 라이트': 500_000,
  TY케어플랜: 0,
  TY썬크루즈: 550_000,
} as const;

export type HqProductKind =
  | 'TY갤럭시케어'
  | '올라이프케어'
  | 'TY스페셜라이프케어'
  | '갤럭시케어 라이트'
  | 'TY케어플랜'
  | 'TY썬크루즈'
  | 'unknown_review';

/** 상품 판별: product_type/물품명 텍스트 포함 여부 (구체적 문구 우선) */
const PRODUCT_MATCHERS: ReadonlyArray<{ kind: HqProductKind; includes: string }> = [
  { kind: '갤럭시케어 라이트', includes: '갤럭시케어 라이트' },
  { kind: 'TY썬크루즈', includes: 'TY썬크루즈' },
  { kind: 'TY썬크루즈', includes: '썬크루즈' },
  { kind: 'TY케어플랜', includes: 'TY케어플랜' },
  { kind: 'TY케어플랜', includes: '케어플랜' },
  { kind: 'TY갤럭시케어', includes: 'TY갤럭시케어' },
  { kind: '올라이프케어', includes: 'TY올라이프케어' },
  { kind: '올라이프케어', includes: '올라이프케어' },
  // legacy: '일반가전'은 본사 매출 단가 분류상 TY스페셜라이프케어로 취급
  { kind: 'TY스페셜라이프케어', includes: '일반가전' },
  { kind: 'TY스페셜라이프케어', includes: '스페셜라이프케어' },
  { kind: 'TY스페셜라이프케어', includes: 'TY스페셜라이프케어' },
];

export type HqProductResolveInput = {
  product_type?: string | null;
  item_name?: string | null;
  source_snapshot_json?: Record<string, string | null> | null;
};

function collectHqProductTexts(input: HqProductResolveInput): string[] {
  return [
    input.product_type,
    input.item_name,
    input.source_snapshot_json?.['상품명'],
  ]
    .map((t) => String(t ?? '').trim())
    .filter(Boolean);
}

/** TY갤럭시케어 / TY갤럭시케어_무 / TY갤럭시케어_ALL 및 product_type=무 */
export function isTyGalaxyCareProductText(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t === '무') return true;
  if (t.includes('TY갤럭시케어_ALL')) return true;
  if (t.includes('TY갤럭시케어_무')) return true;
  if (t.includes('TY갤럭시케어')) return true;
  return false;
}

export function resolveHqProductKindFromContract(input: HqProductResolveInput): HqProductKind {
  const texts = collectHqProductTexts(input);
  if (texts.length === 0) return 'unknown_review';

  // 구체적 상품명 우선 (매출 0원 상품이 갤럭시 폴백에 섞이지 않도록)
  if (texts.some((t) => t.includes('갤럭시케어 라이트'))) return '갤럭시케어 라이트';
  if (texts.some((t) => t.includes('썬크루즈'))) return 'TY썬크루즈';
  if (texts.some((t) => t.includes('케어플랜'))) return 'TY케어플랜';
  if (texts.some(isTyGalaxyCareProductText)) return 'TY갤럭시케어';

  for (const text of texts) {
    for (const matcher of PRODUCT_MATCHERS) {
      if (
        matcher.kind === 'TY갤럭시케어' ||
        matcher.kind === '갤럭시케어 라이트' ||
        matcher.kind === 'TY썬크루즈' ||
        matcher.kind === 'TY케어플랜'
      ) {
        continue;
      }
      if (text.includes(matcher.includes)) return matcher.kind;
    }
  }

  return 'unknown_review';
}

export function normalizeSettlementDateYmd(date: string | null | undefined): string | null {
  if (!date) return null;
  const ymd = String(date).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null;
}

export function resolveHqProductKind(
  productTypeText: string | HqProductResolveInput | null | undefined,
): HqProductKind {
  if (productTypeText != null && typeof productTypeText === 'object') {
    return resolveHqProductKindFromContract(productTypeText);
  }
  const text = (productTypeText ?? '').trim();
  if (!text) return 'unknown_review';
  return resolveHqProductKindFromContract({ product_type: text });
}

/**
 * 본사 매출 단가(원/구좌).
 * TY갤럭시케어 6/26 단가 분기는 해피콜 완료일(happy_call_at) 기준.
 */
export function getHqRevenueUnitPrice(
  productInput: string | HqProductResolveInput | null | undefined,
  settlementDateYmd: string | null | undefined,
): number {
  const kind = resolveHqProductKind(productInput);
  const settlementDate = normalizeSettlementDateYmd(settlementDateYmd);

  if (kind === 'TY갤럭시케어') {
    if (!settlementDate) {
      return HQ_REVENUE_UNIT_PRICES.TY갤럭시케어.beforeIncrease;
    }
    return settlementDate >= TY_GALAXY_CARE_HQ_PRICE_INCREASE_DATE
      ? HQ_REVENUE_UNIT_PRICES.TY갤럭시케어.fromIncrease
      : HQ_REVENUE_UNIT_PRICES.TY갤럭시케어.beforeIncrease;
  }

  if (kind === '올라이프케어') return HQ_REVENUE_UNIT_PRICES.올라이프케어;
  if (kind === 'TY스페셜라이프케어') return HQ_REVENUE_UNIT_PRICES.TY스페셜라이프케어;
  if (kind === '갤럭시케어 라이트') return HQ_REVENUE_UNIT_PRICES['갤럭시케어 라이트'];
  if (kind === 'TY케어플랜') return HQ_REVENUE_UNIT_PRICES.TY케어플랜;
  if (kind === 'TY썬크루즈') return HQ_REVENUE_UNIT_PRICES.TY썬크루즈;

  // 미식별·레거시: 과거 단일 상품(TY갤럭시케어) 처리와 동일하게 날짜 분기 단가 적용
  if (!settlementDate) return BASE_AMOUNT_PER_UNIT;
  return settlementDate >= TY_GALAXY_CARE_HQ_PRICE_INCREASE_DATE
    ? HQ_REVENUE_UNIT_PRICES.TY갤럭시케어.fromIncrease
    : BASE_AMOUNT_PER_UNIT;
}

export type HqRevenueContractInput = OrganizationKpiContractInput & {
  id?: string;
  join_date: string | null;
  unit_count: number | null;
  product_type: string | null;
  item_name?: string | null;
  source_snapshot_json?: Record<string, string | null> | null;
  happycall_result?: string | null;
  happy_call_at?: string | null;
  invoice_registered_at?: string | null;
  settlement_deferred?: boolean | null;
  deferred_to_month?: string | null;
};

function toContractEligibilityInput(c: HqRevenueContractInput): ContractEligibilityInput {
  return {
    id: String(c.id ?? ''),
    status: String(c.status ?? ''),
    is_cancelled: Boolean(c.is_cancelled ?? false),
    sales_member_id: (c.sales_member_id ?? null) as string | null,
    sales_link_status: (c.sales_link_status ?? null) as string | null,
    happy_call_at: c.happy_call_at ?? null,
    happycall_result: (c.happycall_result ?? null) as string | null,
    product_type: (c.product_type ?? null) as string | null,
    item_name: (c.item_name ?? null) as string | null,
    source_snapshot_json: (c.source_snapshot_json ?? null) as Record<string, string | null> | null,
    invoice_no: (c.invoice_no ?? null) as string | null,
    invoice_registered_at: c.invoice_registered_at ?? null,
    settlement_deferred: (c.settlement_deferred ?? false) as boolean | null,
    deferred_to_month: (c.deferred_to_month ?? null) as string | null,
  };
}

function isHqRevenuePeriodEligibleContract(
  contract: HqRevenueContractInput,
  options: {
    periodStart: string;
    periodEnd: string;
    periodEligibility: HqRevenuePeriodEligibilityMode;
    yearMonth?: string;
    periodDateField: HqRevenuePeriodDateField;
    baseEligibility: HqRevenueEligibilityMode;
  },
): boolean {
  if (options.periodEligibility === 'settlement_v2_monthly') {
    const ym = (options.yearMonth ?? '').trim();
    if (!ym) return false;
    return evaluateContractEligibility(toContractEligibilityInput(contract), ym).result === 'ELIGIBLE';
  }
  if (!isHqRevenueEligibleContract(contract, options.baseEligibility)) return false;
  return contractInHqRevenuePeriod(
    contract,
    options.periodStart,
    options.periodEnd,
    options.periodDateField,
  );
}

function contractInHqRevenuePeriod(
  contract: HqRevenueContractInput,
  periodStart: string,
  periodEnd: string,
  periodDateField: HqRevenuePeriodDateField,
): boolean {
  if (periodDateField === 'happy_call_at') {
    const ymd = happycallYmdSeoul(contract.happy_call_at);
    if (!ymd) return false;
    return ymd >= periodStart && ymd <= periodEnd;
  }
  return contractJoinYmdInInclusiveWindow(contract.join_date, periodStart, periodEnd);
}

function resolveHqUnitPriceDateYmd(
  contract: HqRevenueContractInput,
  unitPriceDateField: HqRevenuePeriodDateField,
): string | null {
  if (unitPriceDateField === 'happy_call_at') {
    const ymd = happycallYmdSeoul(contract.happy_call_at);
    return ymd || null;
  }
  return normalizeSettlementDateYmd(contract.join_date);
}

function isHqRevenueEligibleContract(
  contract: HqRevenueContractInput,
  mode: HqRevenueEligibilityMode,
): boolean {
  if (mode === 'settlement_v2_static') {
    return isSettlementEligibleContract(contract);
  }
  return isOrganizationKpiEligibleContract(contract);
}

export function calcContractHqRevenue(
  contract: {
    unit_count: number | null;
    product_type: string | null;
    item_name?: string | null;
    source_snapshot_json?: Record<string, string | null> | null;
    join_date: string | null;
    happy_call_at?: string | null;
  },
  options?: { unitPriceDateField?: HqRevenuePeriodDateField },
): number {
  const units = Math.max(0, Number(contract.unit_count ?? 0));
  if (units === 0) return 0;

  const unitPriceDateField = options?.unitPriceDateField ?? 'happy_call_at';
  const priceDateYmd = resolveHqUnitPriceDateYmd(contract as HqRevenueContractInput, unitPriceDateField);
  const unitPrice = getHqRevenueUnitPrice(
    {
      product_type: contract.product_type,
      item_name: contract.item_name ?? null,
      source_snapshot_json: contract.source_snapshot_json ?? null,
    },
    priceDateYmd,
  );
  return units * unitPrice;
}

export function sumHqRevenueForContracts(
  contracts: readonly HqRevenueContractInput[],
  options: {
    periodStart: string;
    periodEnd: string;
    /** 총 매출·기간 매출( calendar_window ) 공통 정적/KPI 가입 인정 */
    eligibility?: HqRevenueEligibilityMode;
    /**
     * 이번달(기간) 매출 집계 방식.
     * - calendar_window: eligibility + periodStart~End (기본, 조직도 등)
     * - settlement_v2_monthly: evaluateContractEligibility(yearMonth) === ELIGIBLE
     *   (해피콜 윈도우·송장 마감·이월 반영, 월별 수당 정산과 동일)
     */
    periodEligibility?: HqRevenuePeriodEligibilityMode;
    /** periodEligibility=settlement_v2_monthly 일 때 필수 (YYYY-MM) */
    yearMonth?: string;
    /** calendar_window 시 기간 필터 날짜 필드 */
    periodDateField?: HqRevenuePeriodDateField;
    /** 상품별 본사 매출 단가 분기에 쓸 날짜 필드. TY갤럭시케어 6/26 분기는 해피콜 완료일 기준. */
    unitPriceDateField?: HqRevenuePeriodDateField;
  },
): { totalHqRevenue: number; periodHqRevenue: number; periodEligibleUnits: number } {
  const eligibility = options.eligibility ?? 'kpi';
  const periodEligibility = options.periodEligibility ?? 'calendar_window';
  const periodDateField = options.periodDateField ?? 'join_date';
  const unitPriceDateField = options.unitPriceDateField ?? 'happy_call_at';
  let totalHqRevenue = 0;
  let periodHqRevenue = 0;
  let periodEligibleUnits = 0;

  for (const contract of contracts) {
    const units = Math.max(0, Number(contract.unit_count ?? 0));
    const revenue = calcContractHqRevenue(contract, { unitPriceDateField });

    if (revenue > 0 && isHqRevenueEligibleContract(contract, eligibility)) {
      totalHqRevenue += revenue;
    }

    if (
      isHqRevenuePeriodEligibleContract(contract, {
        periodStart: options.periodStart,
        periodEnd: options.periodEnd,
        periodEligibility,
        yearMonth: options.yearMonth,
        periodDateField,
        baseEligibility: eligibility,
      })
    ) {
      periodEligibleUnits += units;
      if (revenue > 0) periodHqRevenue += revenue;
    }
  }

  return { totalHqRevenue, periodHqRevenue, periodEligibleUnits };
}

/** 요구사항 예시·경계일 자가 검증 (스크립트/수동 확인용) */
export function runHqRevenueSelfCheck(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  const assertEq = (label: string, actual: number, expected: number) => {
    if (actual !== expected) failures.push(`${label}: expected ${expected}, got ${actual}`);
  };

  const assertKind = (label: string, actual: HqProductKind, expected: HqProductKind) => {
    if (actual !== expected) failures.push(`${label}: expected ${expected}, got ${actual}`);
  };

  assertEq('TY 2026-06-25', calcContractHqRevenue({
    product_type: 'TY갤럭시케어',
    join_date: '2026-06-25',
    happy_call_at: '2026-06-25',
    unit_count: 2,
  }), 1_430_000);

  assertEq('TY 2026-06-26', calcContractHqRevenue({
    product_type: 'TY갤럭시케어',
    join_date: '2026-06-20',
    happy_call_at: '2026-06-26',
    unit_count: 1,
  }), 770_000);

  assertEq('올라이프케어', calcContractHqRevenue({
    product_type: '올라이프케어',
    join_date: '2026-06-26',
    unit_count: 3,
  }), 1_815_000);

  assertEq('TY스페셜라이프케어', getHqRevenueUnitPrice('TY스페셜라이프케어', '2026-01-01'), 550_000);
  assertEq('일반가전 → TY스페셜라이프케어', getHqRevenueUnitPrice('일반가전', '2026-01-01'), 550_000);
  assertEq('TY올라이프케어', getHqRevenueUnitPrice({ item_name: 'TY올라이프케어' }, '2026-07-01'), 605_000);
  assertEq('갤럭시케어 라이트', getHqRevenueUnitPrice('갤럭시케어 라이트', '2026-01-01'), 500_000);
  assertEq('TY케어플랜', getHqRevenueUnitPrice('TY케어플랜', '2026-07-01'), 0);
  assertEq('TY썬크루즈', getHqRevenueUnitPrice({ item_name: 'TY썬크루즈' }, '2026-07-01'), 550_000);
  assertKind('라이트 우선', resolveHqProductKind('갤럭시케어 라이트'), '갤럭시케어 라이트');
  assertKind('TY갤럭시케어_무', resolveHqProductKindFromContract({ product_type: '무' }), 'TY갤럭시케어');
  assertKind(
    'TY갤럭시케어_ALL',
    resolveHqProductKindFromContract({
      source_snapshot_json: { 상품명: 'TY갤럭시케어_ALL' },
    }),
    'TY갤럭시케어',
  );
  assertKind('TY케어플랜', resolveHqProductKind('TY케어플랜'), 'TY케어플랜');
  assertKind('TY썬크루즈', resolveHqProductKindFromContract({ item_name: 'TY썬크루즈' }), 'TY썬크루즈');
  assertEq(
    'TY갤럭시케어_무 단가',
    calcContractHqRevenue({
      product_type: '무',
      source_snapshot_json: { 상품명: 'TY갤럭시케어_무' },
      join_date: '2026-06-20',
      happy_call_at: '2026-06-26',
      unit_count: 1,
    }),
    770_000,
  );
  assertEq(
    'TY케어플랜 매출 0',
    calcContractHqRevenue({
      product_type: 'TY케어플랜',
      join_date: '2026-07-01',
      happy_call_at: '2026-07-01',
      unit_count: 5,
    }),
    0,
  );
  assertEq(
    'TY썬크루즈 매출 55만/구좌',
    calcContractHqRevenue({
      product_type: 'TY갤럭시케어',
      item_name: 'TY썬크루즈',
      join_date: '2026-07-01',
      happy_call_at: '2026-07-01',
      unit_count: 2,
    }),
    1_100_000,
  );
  assertEq(
    '7월 갤럭시케어 77만',
    getHqRevenueUnitPrice('TY갤럭시케어', '2026-07-15'),
    770_000,
  );
  assertEq(
    '7월 스페셜 55만',
    getHqRevenueUnitPrice('TY스페셜라이프케어', '2026-07-15'),
    550_000,
  );

  const sample = sumHqRevenueForContracts(
    [
      {
        status: '가입',
        is_cancelled: false,
        sales_member_id: 'm1',
        sales_link_status: 'linked',
        rental_request_no: null,
        invoice_no: null,
        join_date: '2026-06-25',
        happy_call_at: '2026-06-25',
        unit_count: 2,
        product_type: 'TY갤럭시케어',
      },
      {
        status: '가입',
        is_cancelled: false,
        sales_member_id: 'm1',
        sales_link_status: 'linked',
        rental_request_no: null,
        invoice_no: null,
        join_date: '2026-06-20',
        happy_call_at: '2026-06-26',
        unit_count: 1,
        product_type: 'TY갤럭시케어',
      },
      {
        status: '가입',
        is_cancelled: false,
        sales_member_id: 'm1',
        sales_link_status: 'linked',
        rental_request_no: null,
        invoice_no: null,
        join_date: '2026-06-26',
        happy_call_at: '2026-06-26',
        unit_count: 3,
        product_type: '올라이프케어',
      },
    ],
    { periodStart: '2026-06-01', periodEnd: '2026-06-30' },
  );
  assertEq('기간 합계', sample.periodHqRevenue, 4_015_000);

  return { ok: failures.length === 0, failures };
}
