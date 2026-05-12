'use client';

import { useEffect, useMemo, useTransition } from 'react';
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
  const [, startTransition] = useTransition();

  const current = parseYearMonth(value) ?? parseYearMonth(todayValue) ?? { year: new Date().getFullYear(), month: 1 };
  const today = parseYearMonth(todayValue) ?? current;

  const monthOptions = useMemo(() => Array.from({ length: 12 }, (_, i) => i + 1), []);

  const buildUrl = (nextYearMonth: string) => {
    const qs = new URLSearchParams(searchParams?.toString() ?? '');
    qs.set('year_month', nextYearMonth);
    if (keepQuery) {
      for (const [k, v] of Object.entries(keepQuery)) {
        if (v == null || v === '') qs.delete(k);
        else qs.set(k, v);
      }
    }
    return `${pathname}?${qs.toString()}`;
  };

  const push = (nextYearMonth: string) => {
    const url = buildUrl(nextYearMonth);
    // transition으로 UI 응답성은 유지하고, 실제 로딩 시간은 prefetch로 줄인다.
    startTransition(() => {
      router.push(url);
    });
  };

  // 클릭 전 미리 로딩: "오늘(기준월)"은 가장 많이 누르는 동작이라 mount 시 prefetch.
  // (Next.js가 내부적으로 캐시/프리패치 전략을 갖고 있어 과도한 네트워크는 제한된다.)
  useEffect(() => {
    try {
      router.prefetch(buildUrl(todayValue));
    } catch {
      // ignore (prefetch 미지원 환경 방어)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayValue, pathname]);

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
    <div className="-mx-3 px-3 sm:mx-0 sm:px-0 mb-4 sm:mb-5">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <button
          type="button"
          onClick={() => push(todayValue)}
          onMouseEnter={() => router.prefetch(buildUrl(todayValue))}
          onFocus={() => router.prefetch(buildUrl(todayValue))}
          className={`w-full sm:w-auto px-2.5 py-1.5 rounded text-xs border ${
            value === todayValue
              ? 'bg-slate-800 text-white border-slate-800'
              : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
          }`}
        >
          {todayLabel ?? '오늘(기준월)'}
        </button>

        <div className="grid grid-cols-2 gap-2 w-full sm:w-auto">
          <select
            value={String(current.year)}
            onChange={(e) => onChangeYear(e.target.value)}
            className="h-9 sm:h-7 w-full px-2 rounded text-xs border bg-white text-gray-700 border-gray-300"
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
            className="h-9 sm:h-7 w-full px-2 rounded text-xs border bg-white text-gray-700 border-gray-300"
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
    </div>
  );
}

