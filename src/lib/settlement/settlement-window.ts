/**
 * 정산 월 기준(26일~25일) 기간 계산.
 *
 * 규칙:
 * - 오늘(서울) 날짜의 일이 26 이상이면 “다음달 매출 구간”
 * - 26 미만이면 “이번달 매출 구간”
 *
 * 반환:
 * - start_date/end_date: contracts.join_date(DATE) 비교용 'YYYY-MM-DD'
 * - label_year_month: 기준 월(예: 2026-04-15 -> 2026-04, 2026-04-26 -> 2026-05)
 */

import { getHappycallWindowForYearMonth } from './settlement-eligibility-v2';

function formatYmd(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function addMonths(y: number, m: number, delta: number): { y: number; m: number } {
  // m: 1-12
  const idx = (y * 12 + (m - 1)) + delta;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return { y: ny, m: nm };
}

export function getSettlementWindowSeoul(
  now: Date = new Date(),
): { start_date: string; end_date: string; label_year_month: string } {
  // 서울 기준 오늘 날짜를 'YYYY-MM-DD'로 추출
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now); // e.g. 2026-04-15

  const [ys, ms, ds] = ymd.split('-');
  const y = parseInt(ys, 10);
  const m = parseInt(ms, 10);
  const d = parseInt(ds, 10);

  const base = d >= 26 ? addMonths(y, m, 1) : { y, m };
  const prev = addMonths(base.y, base.m, -1);

  const start_date = formatYmd(prev.y, prev.m, 26);
  const end_date = formatYmd(base.y, base.m, 25);
  const label_year_month = `${String(base.y).padStart(4, '0')}-${String(base.m).padStart(2, '0')}`;

  return { start_date, end_date, label_year_month };
}

/**
 * 특정 정산월(YYYY-MM)에 해당하는 기간(26일~25일)을 반환.
 *
 * 예: label_year_month = '2026-04' 이면
 * - start_date: 2026-03-26
 * - end_date:   2026-04-25
 */
export function getSettlementWindowForYearMonth(
  label_year_month: string,
): { start_date: string; end_date: string; label_year_month: string } {
  if (!/^\d{4}-\d{2}$/.test(label_year_month)) {
    throw new Error(`Invalid year_month: ${label_year_month}`);
  }
  const [ys, ms] = label_year_month.split('-');
  const y = parseInt(ys, 10);
  const m = parseInt(ms, 10);
  const base = { y, m };
  const prev = addMonths(base.y, base.m, -1);

  const start_date = formatYmd(prev.y, prev.m, 26);
  const end_date = formatYmd(base.y, base.m, 25);
  return { start_date, end_date, label_year_month };
}

/**
 * **표시 전용** 정산 구간 (공휴일/주말 보정 반영).
 *
 * - 정산월 마감일 = 매월 25일, 단 25일이 주말/공휴일이면 다음 영업일.
 * - 정산월 시작일 = 이전 정산월 마감일의 다음 날(이전월 종료일과 절대 겹치지 않게 +1일).
 *
 * 데이터 필터링/계산은 그대로 `getSettlementWindowForYearMonth`(전월26~당월25, 보정 없음) 또는
 * `getHappycallWindowForYearMonth`(해피콜 윈도우) 를 사용한다. 이 함수는 **화면에 보여줄 텍스트**
 * (예: "정산 구간 2026-05-27 ~ 2026-06-25") 에만 쓴다.
 *
 * 구현은 해피콜 정산 윈도우와 동일한 규칙을 따른다 (의존성: settlement-eligibility-v2).
 */
export function getSettlementWindowDisplayForYearMonth(
  yearMonth: string,
): { start_date: string; end_date: string; label_year_month: string } {
  const w = getHappycallWindowForYearMonth(yearMonth);
  return { start_date: w.start_date, end_date: w.end_date, label_year_month: yearMonth };
}

/** Next.js searchParams 등에서 `year_month` 단일 값만 안전히 꺼낸다. */
export function coalesceYearMonthSearchParam(
  raw: string | string[] | undefined | null,
): string | undefined {
  if (raw == null) return undefined;
  if (typeof raw === 'string') {
    const t = raw.trim();
    return t || undefined;
  }
  if (Array.isArray(raw)) {
    for (const x of raw) {
      if (typeof x !== 'string') continue;
      const t = x.trim();
      if (t) return t;
    }
  }
  return undefined;
}

/**
 * `year_month` 쿼리를 `YYYY-MM`으로 통일한다. (`2026-5` → `2026-05`)
 * 유효하지 않으면 null.
 */
export function normalizeYearMonthLabel(raw: string): string | null {
  const t = raw.trim();
  const m = /^(\d{4})-(\d{1,2})$/.exec(t);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || mo < 1 || mo > 12) return null;
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}`;
}

const JOIN_YMD_PREFIX_RE = /^(\d{4}-\d{2}-\d{2})/;

/**
 * contracts.join_date (DATE/문자/타임존 포함 ISO)를 정산 윈도우 비교용 `YYYY-MM-DD`로 통일.
 * DB가 DATE만 주는 경우 그대로, ISO+UTC인 경우 서울 달력 기준으로 맞춘다.
 */
export function contractJoinYmdForWindow(joinDate: unknown): string | null {
  if (joinDate == null) return null;
  if (typeof joinDate === 'number' && Number.isFinite(joinDate)) {
    const d = new Date(joinDate);
    if (Number.isNaN(d.getTime())) return null;
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  }
  if (typeof joinDate === 'string') {
    const t = joinDate.trim();
    if (!t) return null;
    // Postgres DATE 등 순수 날짜 문자열은 그대로 비교(UTC 자정 ISO로 잘못 밀리는 것 방지)
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
    const m = JOIN_YMD_PREFIX_RE.exec(t);
    if (m) return m[1];
    return null;
  }
  if (joinDate instanceof Date) {
    if (Number.isNaN(joinDate.getTime())) return null;
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(joinDate);
  }
  return null;
}

export function contractJoinYmdInInclusiveWindow(
  joinDate: unknown,
  startYmd: string,
  endYmd: string,
): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startYmd) || !/^\d{4}-\d{2}-\d{2}$/.test(endYmd)) return false;
  const jd = contractJoinYmdForWindow(joinDate);
  if (!jd) return false;
  return jd >= startYmd && jd <= endYmd;
}
