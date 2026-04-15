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

