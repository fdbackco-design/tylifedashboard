'use client';

import { useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toYearMonth(year: number, month: number): string {
  return `${year}-${pad2(month)}`;
}

function parseYearMonth(value: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  if (month < 1 || month > 12) return null;
  return { year, month };
}

export default function YearMonthSelector(props: {
  /** 현재 선택된 year_month (YYYY-MM) */
  value: string;
  /** "오늘(기준월)" 버튼이 가리킬 year_month (YYYY-MM) */
  todayValue: string;
  /** 드롭다운에 표시할 연도 목록 */
  years: number[];
  /** year_month 외에 항상 유지할 쿼리 파라미터 */
  keepQuery?: Record<string, string | null | undefined>;
  /** 라벨 커스터마이즈 */
  todayLabel?: string;
}) {
  const { value, todayValue, years, keepQuery, todayLabel } = props;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const current = parseYearMonth(value) ?? parseYearMonth(todayValue) ?? { year: new Date().getFullYear(), month: 1 };
  const today = parseYearMonth(todayValue) ?? current;

  const monthOptions = useMemo(() => Array.from({ length: 12 }, (_, i) => i + 1), []);

  const push = (nextYearMonth: string) => {
    const qs = new URLSearchParams(searchParams?.toString() ?? '');
    qs.set('year_month', nextYearMonth);
    if (keepQuery) {
      for (const [k, v] of Object.entries(keepQuery)) {
        if (v == null || v === '') qs.delete(k);
        else qs.set(k, v);
      }
    }
    router.push(`${pathname}?${qs.toString()}`);
  };

  const onChangeYear = (yearStr: string) => {
    const y = Number(yearStr);
    if (!Number.isFinite(y)) return;
    push(toYearMonth(y, current.month));
  };

  const onChangeMonth = (monthStr: string) => {
    const m = Number(monthStr);
    if (!Number.isFinite(m)) return;
    if (m < 1 || m > 12) return;
    push(toYearMonth(current.year, m));
  };

  return (
    <div className="flex gap-2 mb-4 sm:mb-5 items-center overflow-x-auto whitespace-nowrap -mx-3 px-3 sm:mx-0 sm:px-0">
      <button
        type="button"
        onClick={() => push(todayValue)}
        className={`px-2.5 py-1 rounded text-xs border ${
          value === todayValue
            ? 'bg-slate-800 text-white border-slate-800'
            : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
        }`}
      >
        {todayLabel ?? '오늘(기준월)'}
      </button>

      <div className="flex items-center gap-1">
        <select
          value={String(current.year)}
          onChange={(e) => onChangeYear(e.target.value)}
          className="h-7 px-2 rounded text-xs border bg-white text-gray-700 border-gray-300"
          aria-label="연도 선택"
        >
          {years.map((y) => (
            <option key={y} value={String(y)}>
              {y}년
            </option>
          ))}
        </select>

        <select
          value={pad2(current.month)}
          onChange={(e) => onChangeMonth(e.target.value)}
          className="h-7 px-2 rounded text-xs border bg-white text-gray-700 border-gray-300"
          aria-label="월 선택"
        >
          {monthOptions.map((m) => (
            <option key={m} value={pad2(m)}>
              {pad2(m)}월
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

