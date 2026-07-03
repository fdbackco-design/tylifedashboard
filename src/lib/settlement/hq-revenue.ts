import { BASE_AMOUNT_PER_UNIT } from './constants';
import { isOrganizationKpiEligibleContract, type OrganizationKpiContractInput } from './kpi-eligibility';
import { isSettlementEligibleContract } from './settlement-eligibility';
import { happycallYmdSeoul } from './settlement-eligibility-v2';
import { contractJoinYmdInInclusiveWindow } from './settlement-window';

export type HqRevenueEligibilityMode = 'kpi' | 'settlement_v2_static';
export type HqRevenuePeriodDateField = 'join_date' | 'happy_call_at';

/** TY갤럭시케어 본사 매출 단가 변경 적용 시작일 (당일 포함 770,000원) */
export const TY_GALAXY_CARE_HQ_PRICE_INCREASE_DATE = '2026-06-26';

export const HQ_REVENUE_UNIT_PRICES = {
  TY갤럭시케어: { beforeIncrease: 715_000, fromIncrease: 770_000 },
  올라이프케어: 605_000,
  일반가전: 550_000,
  '갤럭시케어 라이트': 500_000,
} as const;

export type HqProductKind =
  | 'TY갤럭시케어'
  | '올라이프케어'
  | '일반가전'
  | '갤럭시케어 라이트'
  | 'unknown_review';

/** 상품 판별: product_type 텍스트 포함 여부 (구체적 문구 우선) */
const PRODUCT_MATCHERS: ReadonlyArray<{ kind: HqProductKind; includes: string }> = [
  { kind: '갤럭시케어 라이트', includes: '갤럭시케어 라이트' },
  { kind: 'TY갤럭시케어', includes: 'TY갤럭시케어' },
  { kind: '올라이프케어', includes: '올라이프케어' },
  { kind: '일반가전', includes: '일반가전' },
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

  if (texts.some((t) => t.includes('갤럭시케어 라이트'))) return '갤럭시케어 라이트';
  if (texts.some(isTyGalaxyCareProductText)) return 'TY갤럭시케어';

  for (const text of texts) {
    for (const matcher of PRODUCT_MATCHERS) {
      if (matcher.kind === 'TY갤럭시케어') continue;
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
  if (kind === '일반가전') return HQ_REVENUE_UNIT_PRICES.일반가전;
  if (kind === '갤럭시케어 라이트') return HQ_REVENUE_UNIT_PRICES['갤럭시케어 라이트'];

  // 미식별·레거시: 과거 단일 상품(TY갤럭시케어) 처리와 동일하게 날짜 분기 단가 적용
  if (!settlementDate) return BASE_AMOUNT_PER_UNIT;
  return settlementDate >= TY_GALAXY_CARE_HQ_PRICE_INCREASE_DATE
    ? HQ_REVENUE_UNIT_PRICES.TY갤럭시케어.fromIncrease
    : BASE_AMOUNT_PER_UNIT;
}

export type HqRevenueContractInput = OrganizationKpiContractInput & {
  join_date: string | null;
  unit_count: number | null;
  product_type: string | null;
  item_name?: string | null;
  source_snapshot_json?: Record<string, string | null> | null;
  happycall_result?: string | null;
  happy_call_at?: string | null;
};

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
    /** 조직 KPI(기본) vs 정산 v2 정적 가입 인정 */
    eligibility?: HqRevenueEligibilityMode;
    /** 이번달(기간) 매출 집계에 쓸 날짜 필드. 정산현황·조직도는 happy_call_at. */
    periodDateField?: HqRevenuePeriodDateField;
    /** 상품별 본사 매출 단가 분기에 쓸 날짜 필드. TY갤럭시케어 6/26 분기는 해피콜 완료일 기준. */
    unitPriceDateField?: HqRevenuePeriodDateField;
  },
): { totalHqRevenue: number; periodHqRevenue: number } {
  const eligibility = options.eligibility ?? 'kpi';
  const periodDateField = options.periodDateField ?? 'join_date';
  const unitPriceDateField = options.unitPriceDateField ?? 'happy_call_at';
  let totalHqRevenue = 0;
  let periodHqRevenue = 0;

  for (const contract of contracts) {
    if (!isHqRevenueEligibleContract(contract, eligibility)) continue;

    const revenue = calcContractHqRevenue(contract, { unitPriceDateField });
    totalHqRevenue += revenue;

    if (contractInHqRevenuePeriod(contract, options.periodStart, options.periodEnd, periodDateField)) {
      periodHqRevenue += revenue;
    }
  }

  return { totalHqRevenue, periodHqRevenue };
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

  assertEq('일반가전', getHqRevenueUnitPrice('일반가전', '2026-01-01'), 550_000);
  assertEq('갤럭시케어 라이트', getHqRevenueUnitPrice('갤럭시케어 라이트', '2026-01-01'), 500_000);
  assertKind('라이트 우선', resolveHqProductKind('갤럭시케어 라이트'), '갤럭시케어 라이트');
  assertKind('TY갤럭시케어_무', resolveHqProductKindFromContract({ product_type: '무' }), 'TY갤럭시케어');
  assertKind(
    'TY갤럭시케어_ALL',
    resolveHqProductKindFromContract({
      source_snapshot_json: { 상품명: 'TY갤럭시케어_ALL' },
    }),
    'TY갤럭시케어',
  );
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
