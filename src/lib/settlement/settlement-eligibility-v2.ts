/**
 * 월정산 v2 판정 모듈 (해피콜 + 송장번호 기준)
 *
 * 적용 범위
 *   - `src/lib/settlement/monthly-calculate.ts` 에서만 사용한다.
 *   - 기존 `v_contract_settlement_base` 뷰, `isContractJoinCompleted`,
 *     `isSettlementEligibleContract` 등은 다른 화면(조직도/대시보드/계약 상세 등) 호환을 위해 보존한다.
 *
 * 새 정산 가입 인정 기준
 *   1) 해피콜 결과(happycall_result) ∈ { '성공', '완료', '심사완료', '계약변경' }
 *      ※ '심사완료' 는 '완료' 와 동일하게 처리한다.
 *   2) 해피콜 완료일(happy_call_at) 가 정산월 윈도우 안에 있음
 *      - 정산월 마감일 = 매월 25일, 단 주말/공휴일이면 다음 영업일.
 *      - 정산월 시작일 = 이전 정산월 마감일의 다음 날 (윈도우는 절대 겹치지 않음).
 *      - 예) 2026-05 = 2026-04-28 ~ 2026-05-26, 2026-06 = 2026-05-27 ~ 2026-06-25
 *        (2026-05-25 부처님오신날 대체공휴일이라 5월 마감일이 5/26 으로 밀림.
 *         따라서 5/26 해피콜 완료 건은 6월이 아닌 5월 정산에 포함된다.)
 *   3) 송장번호(invoice_no) 가 yearMonth 30일 23:59:59 (KST) 까지 존재
 *      ※ TY갤럭시케어_무 상품은 송장 없이 해피콜 완료만으로 가입·정산 인정
 *      - 송장 마감일은 공휴일/주말 보정을 적용하지 않는다. 매월 30일 23:59:59 KST 가 절대 마감선.
 *        (해피콜 윈도우에는 공휴일/주말 보정이 적용되는 것과 다르다.)
 *      - 30일이 없는 달(2월)은 해당 월의 말일까지(28/29일).
 *      - 2026-05 정산: "현재 시점 송장번호 존재" 로 판단 (5월 30일 시점 송장 등록일 데이터 부재로 인한 예외)
 *      - 2026-06 이후: invoice_registered_at 의 KST 일자 <= yearMonth-30 이어야 충족.
 *        invoice_registered_at 가 NULL 이고 invoice_no 가 존재하면 "자동 기록 이전부터 있던 송장"
 *        으로 간주하여 충족된 것으로 본다(=마감일 이내).
 *
 * 이월 / 제외 결정
 *   - 위 1,2 충족이지만 3 미충족 → 다음 정산월로 이월 (DEFERRED)
 *   - 1 또는 2 불충족 → 제외 (EXCLUDED)
 *   - 계약 자체 취소(is_cancelled / status '취소' / '해약' / '계약취소') → 제외
 *   - 담당자 미연결(sales_member_id null 또는 sales_link_status != 'linked') → 제외
 *
 * 수동 이월 (관리자가 contracts.settlement_deferred 등을 직접 수정한 경우)
 *   - settlement_deferred = true 이고 deferred_to_month != yearMonth → EXCLUDED ("다른 월로 이월된 계약")
 *   - settlement_deferred = true 이고 deferred_to_month == yearMonth → 이번 월 후보. 해피콜 윈도우 검사는
 *     스킵하고 송장번호 조건만 재평가한다(이미 관리자가 명시적으로 이번 월에 정산되도록 지정한 케이스).
 */

import { isKoreanHoliday } from './korean-holidays';
import {
  isTyGalaxyCareMuContract,
  meetsTyGalaxyCareMuJoinCondition,
  resolveHappycallEligibilityFields,
} from './galaxy-care-mu';
import { hasValidInvoiceNo } from '@/lib/utils/invoice-no';

export const SETTLEMENT_VALID_HAPPYCALL_RESULTS: ReadonlySet<string> = new Set([
  '성공',
  '완료',
  '심사완료',
  '계약변경',
]);

export const SETTLEMENT_CANCELLED_HAPPYCALL_RESULTS: ReadonlySet<string> = new Set([
  '해약',
  '계약취소',
  '취소',
  '기타',
  '부재',
]);

/** 2026-05 정산 특례: 5/30 시점 송장 등록일 데이터가 없어 "현재 시점 송장번호 존재" 로 판단 */
export const MAY_2026_INVOICE_EXCEPTION_YM = '2026-05';

function addDaysYmd(ymd: string, delta: number): string {
  const [ys, ms, ds] = ymd.split('-');
  const d = new Date(Number(ys), Number(ms) - 1, Number(ds));
  d.setDate(d.getDate() + delta);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function isWeekendYmd(ymd: string): boolean {
  const [ys, ms, ds] = ymd.split('-');
  const day = new Date(Number(ys), Number(ms) - 1, Number(ds)).getDay();
  return day === 0 || day === 6;
}

function isNonWorkdayYmd(ymd: string): boolean {
  return isWeekendYmd(ymd) || isKoreanHoliday(ymd);
}

/**
 * 주말 또는 한국 공휴일이면 다음 영업일까지 미루어 반환.
 *
 * 예) 2026-04-26 (일) → 2026-04-27 (월)
 *     2026-05-24 (일·부처님오신날) → 2026-05-26 (화) — 25(월)이 대체공휴일이므로 한 번 더 미룸
 *     2026-05-25 (월·부처님오신날 대체공휴일) → 2026-05-26 (화)
 *
 * 안전장치: 연속 비영업일이 30일을 넘어가면 무한루프 방지를 위해 그 시점 값을 반환한다.
 */
function shiftToNextWorkday(ymd: string): string {
  let cur = ymd;
  for (let i = 0; i < 30; i++) {
    if (!isNonWorkdayYmd(cur)) return cur;
    cur = addDaysYmd(cur, 1);
  }
  return cur;
}

/**
 * 특정 정산월의 해피콜 마감일을 공식(25일→다음 영업일) 대신 강제 지정하는 예외.
 *
 * 마감일은 "이 달 종료일 = 마감일" 이자 "다음 달 시작일 = 마감일 + 1" 의 기준이므로,
 * 이 값을 통해 마감일만 바꾸면 다음 정산월 시작일도 자동으로 함께 이동해 윈도우가 겹치지 않는다.
 */
const HAPPYCALL_DEADLINE_OVERRIDES: Record<string, string> = {
  // 2026-07: 7/25(토) → 공식상 7/27(월)이지만, 마감일을 7/28로 연장한다.
  //          이에 따라 2026-07 윈도우 = 2026-06-26 ~ 2026-07-28,
  //          2026-08 시작일은 7/29로 밀린다(겹침 없음).
  '2026-07': '2026-07-28',
};

/** 정산월의 해피콜 마감일 YYYY-MM-DD (25일→다음 영업일, 단 예외 오버라이드가 있으면 우선). */
function happycallDeadlineForYearMonth(yearMonth: string): string {
  return HAPPYCALL_DEADLINE_OVERRIDES[yearMonth] ?? shiftToNextWorkday(`${yearMonth}-25`);
}

/**
 * 정산월의 해피콜 인정 윈도우.
 *
 * 계산 규칙:
 *   - 정산월 마감일 = 매월 25일. 단, 25일이 주말/공휴일이면 다음 영업일.
 *   - 정산월 시작일 = "이전 정산월 마감일"의 다음 날.
 *     (이전 정산월 종료일과 시작일이 절대 겹치지 않도록 +1 일 보정)
 *
 * 예) 2026-05 정산: 2026-05-25(대체공휴일) → 다음 영업일 2026-05-26 이 마감일.
 *     ⇒ 2026-05 윈도우 = 2026-04-28 ~ 2026-05-26
 *       (2026-04-25 토 → 다음 영업일 2026-04-27 월 = 4월 마감, 시작은 그 다음 날인 2026-04-28)
 *     ⇒ 2026-06 윈도우 = 2026-05-27 ~ 2026-06-25
 *
 * 따라서 2026-05-26 해피콜 완료 계약은 2026-06 이 아니라 2026-05 정산에 포함된다.
 */
export function getHappycallWindowForYearMonth(yearMonth: string): {
  start_date: string;
  end_date: string;
} {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
    throw new Error(`Invalid year_month: ${yearMonth}`);
  }
  const [ys, ms] = yearMonth.split('-');
  const y = parseInt(ys, 10);
  const m = parseInt(ms, 10);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const prevYm = `${String(py).padStart(4, '0')}-${String(pm).padStart(2, '0')}`;

  const thisEnd = happycallDeadlineForYearMonth(yearMonth);
  const prevEnd = happycallDeadlineForYearMonth(prevYm);
  const start = addDaysYmd(prevEnd, 1);
  return {
    start_date: start,
    end_date: thisEnd,
  };
}

/**
 * 정산월의 송장번호 마감일 YYYY-MM-DD (=해당 월 30일, 주말/공휴일 보정 없이 절대값) 반환.
 *
 * - 매월 30일이 마감(KST 23:59:59).
 * - 30일이 없는 달(2월)은 그 달의 마지막 날(28/29).
 * - 공휴일/주말 보정은 적용하지 않는다. (해피콜 윈도우와 의도적으로 다름)
 *
 * yearMonth 자체가 invalid 일 경우 빈 문자열 반환.
 */
export function getInvoiceDeadlineYmd(yearMonth: string): string {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) return '';
  const [ys, ms] = yearMonth.split('-');
  const y = Number(ys);
  const m = Number(ms);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return '';
  // new Date(year, monthIndex+1, 0) → 그 month 의 마지막 날
  const lastDayOfMonth = new Date(y, m, 0).getDate();
  const targetDay = Math.min(30, lastDayOfMonth);
  return `${yearMonth}-${String(targetDay).padStart(2, '0')}`;
}

export function computeNextYearMonth(yearMonth: string): string {
  const [ys, ms] = yearMonth.split('-');
  const y = parseInt(ys, 10);
  const m = parseInt(ms, 10);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return yearMonth;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}`;
}

/**
 * happy_call_at(timestamptz | 문자열) → 서울 기준 YYYY-MM-DD.
 *
 * TY 외부 데이터의 timestamp는 시각 정보가 0시인 경우가 많아 .slice(0,10) 으로 충분하지만,
 * 다른 시각이 들어와도 안전하도록 Intl 변환을 시도한다.
 */
export function happycallYmdSeoul(ts: unknown): string {
  if (ts == null) return '';
  if (typeof ts === 'string') {
    const t = ts.trim();
    if (!t) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    const d = new Date(t);
    if (!Number.isNaN(d.getTime())) {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(d);
    }
    return t.slice(0, 10);
  }
  if (ts instanceof Date) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(ts);
  }
  return '';
}

export type ContractEligibilityInput = {
  id: string;
  status: string;
  is_cancelled: boolean | null;
  sales_member_id: string | null;
  sales_link_status: string | null;
  happy_call_at: unknown;
  happycall_result: string | null;
  product_type?: string | null;
  item_name?: string | null;
  source_snapshot_json?: Record<string, string | null> | null;
  invoice_no: string | null;
  /**
   * 송장번호가 처음 들어온 시점(timestamptz). 정산 v2 에서 yearMonth 30일까지 존재했는지 판정에 사용.
   *
   * - 2026-05 정산: 본 필드와 무관하게 "현재 invoice_no 존재" 로 판단 (특례).
   * - 2026-06 이후: invoice_registered_at YMD <= getInvoiceDeadlineYmd(yearMonth) 이어야 충족.
   *   NULL 이고 invoice_no 존재 시에는 "자동 기록 이전부터 있던 송장" 으로 충족 처리한다.
   */
  invoice_registered_at: unknown;
  settlement_deferred: boolean | null;
  deferred_to_month: string | null;
};

export type ContractEligibilityDecision =
  | { result: 'ELIGIBLE'; happycall_ymd: string }
  | { result: 'DEFERRED'; reason: string; deferred_to_month: string; happycall_ymd: string }
  | { result: 'EXCLUDED'; reason: string };

/**
 * yearMonth 정산에서 한 계약이 정산 대상인지 판정.
 *
 * 송장번호 충족 기준은 "현재 시점에 invoice_no가 존재" — 5월 정산 특례와 동일한 방식.
 * 추후 송장번호 등록일이 도입되면 ELIGIBILITY 평가 시점에 옵션으로 전달할 수 있도록 분리 가능.
 */
export function evaluateContractEligibility(
  c: ContractEligibilityInput,
  yearMonth: string,
): ContractEligibilityDecision {
  if (c.is_cancelled) return { result: 'EXCLUDED', reason: 'is_cancelled' };
  if (c.status === '취소') return { result: 'EXCLUDED', reason: 'status:취소' };
  if (c.status === '해약') return { result: 'EXCLUDED', reason: 'status:해약' };
  if (c.status === '계약취소') return { result: 'EXCLUDED', reason: 'status:계약취소' };
  if (!c.sales_member_id) return { result: 'EXCLUDED', reason: 'no_sales_member' };
  if ((c.sales_link_status ?? 'linked') !== 'linked') {
    return { result: 'EXCLUDED', reason: 'sales_link_status_not_linked' };
  }

  const isMu = isTyGalaxyCareMuContract(c);
  const { ymd: hcYmdResolved, result: hcResult } = resolveHappycallEligibilityFields(
    c.happy_call_at,
    c.happycall_result,
  );
  if (SETTLEMENT_CANCELLED_HAPPYCALL_RESULTS.has(hcResult)) {
    return { result: 'EXCLUDED', reason: `happycall_result:${hcResult}` };
  }

  // 수동/자동 이월 우선 처리
  const manualDeferToThis =
    !!c.settlement_deferred && (c.deferred_to_month ?? '') === yearMonth;
  const manualDeferToOther =
    !!c.settlement_deferred &&
    (c.deferred_to_month ?? '').trim() !== '' &&
    (c.deferred_to_month ?? '') !== yearMonth;
  if (manualDeferToOther) {
    return { result: 'EXCLUDED', reason: `deferred_to:${c.deferred_to_month}` };
  }

  // 해피콜 결과/일시 검증
  if (isMu) {
    if (!meetsTyGalaxyCareMuJoinCondition(c)) {
      return { result: 'EXCLUDED', reason: 'mu_happycall_not_valid' };
    }
  } else if (!SETTLEMENT_VALID_HAPPYCALL_RESULTS.has(hcResult)) {
    return { result: 'EXCLUDED', reason: 'happycall_result_not_valid' };
  }

  const hcYmd = hcYmdResolved || happycallYmdSeoul(c.happy_call_at);
  if (!manualDeferToThis) {
    if (!hcYmd) return { result: 'EXCLUDED', reason: 'happycall_at_missing' };
    const w = getHappycallWindowForYearMonth(yearMonth);
    if (hcYmd < w.start_date || hcYmd > w.end_date) {
      return { result: 'EXCLUDED', reason: `happycall_at_out_of_window:${hcYmd}` };
    }
  }

  // TY갤럭시케어_무: 송장 없이 해피콜 완료만으로 정산 가입 인정
  if (isMu) {
    return { result: 'ELIGIBLE', happycall_ymd: hcYmd };
  }

  // 송장번호 검증
  // - 2026-05 정산: 현 시점 invoice_no 존재 여부로 판단 (특례)
  // - 2026-06 이후: invoice_registered_at 의 ymd <= yearMonth-30(공휴일 보정) 이어야 충족.
  //   invoice_registered_at IS NULL 이면서 invoice_no 가 존재하면 "자동 기록 이전부터 있던 송장"
  //   으로 간주(=충족된 것으로 처리). 자동 기록 도입 이전 데이터 보호용.
  const hasInvoice = hasValidInvoiceNo(c.invoice_no);
  if (!hasInvoice) {
    return {
      result: 'DEFERRED',
      reason: 'invoice_missing',
      deferred_to_month: computeNextYearMonth(yearMonth),
      happycall_ymd: hcYmd,
    };
  }

  if (yearMonth !== MAY_2026_INVOICE_EXCEPTION_YM) {
    const regYmd = happycallYmdSeoul(c.invoice_registered_at);
    if (regYmd) {
      const deadline = getInvoiceDeadlineYmd(yearMonth);
      if (deadline && regYmd > deadline) {
        // 송장번호는 있지만 yearMonth 30일 이후에 등록된 케이스 → 다음 정산월로 이월
        return {
          result: 'DEFERRED',
          reason: `invoice_registered_after_deadline:${regYmd}`,
          deferred_to_month: computeNextYearMonth(yearMonth),
          happycall_ymd: hcYmd,
        };
      }
    }
    // regYmd 가 빈 문자열(=invoice_registered_at NULL) 인 경우는 자동 기록 이전부터 존재한
    // 송장으로 간주하여 충족 처리한다.
  }

  return { result: 'ELIGIBLE', happycall_ymd: hcYmd };
}

/**
 * yearMonth 와 무관한 v2 "정적" 가입 인정 조건.
 *
 * - 정산월 윈도우/송장 마감일/이월 같은 시간 의존 조건은 `evaluateContractEligibility` 가 담당.
 * - 본 helper 는 조직도/누적 구좌/전체 기간 카운트 등 "월에 종속되지 않는" 화면 카운트에서
 *   v2 와 동일한 기준으로 가입 인정 여부를 판정하기 위해 사용한다.
 *
 * 통과 조건:
 *   1) is_cancelled / status('취소'·'해약'·'계약취소') 아님
 *   2) sales_member_id 존재 & sales_link_status == 'linked' (null 은 linked 로 간주)
 *   3) happycall_result ∈ SETTLEMENT_VALID_HAPPYCALL_RESULTS (and NOT in CANCELLED set)
 *   4) invoice_no 가 존재(공백 제외) — TY갤럭시케어_무 는 해피콜 일시+결과만으로 인정
 */
export type ContractEligibilityStaticInput = {
  status?: string | null;
  is_cancelled?: boolean | null;
  sales_member_id?: string | null;
  sales_link_status?: string | null;
  happy_call_at?: unknown;
  happycall_result?: string | null;
  product_type?: string | null;
  item_name?: string | null;
  source_snapshot_json?: Record<string, string | null> | null;
  invoice_no?: string | null;
};

export function isV2EligibleStatic(c: ContractEligibilityStaticInput): boolean {
  if (c.is_cancelled) return false;
  const status = String(c.status ?? '');
  if (status === '취소' || status === '해약' || status === '계약취소') return false;
  if (!c.sales_member_id) return false;
  if ((c.sales_link_status ?? 'linked') !== 'linked') return false;
  const { result: hc } = resolveHappycallEligibilityFields(c.happy_call_at, c.happycall_result);
  if (SETTLEMENT_CANCELLED_HAPPYCALL_RESULTS.has(hc)) return false;
  if (isTyGalaxyCareMuContract(c)) {
    return meetsTyGalaxyCareMuJoinCondition(c);
  }
  if (!SETTLEMENT_VALID_HAPPYCALL_RESULTS.has(hc)) return false;
  if (!hasValidInvoiceNo(c.invoice_no)) return false;
  return true;
}

