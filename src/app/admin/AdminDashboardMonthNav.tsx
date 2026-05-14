'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useTransition } from 'react';

function ymLabel(ym: string): string {
  const [y, m] = ym.split('-');
  return y && m ? `${y}년 ${m}월` : ym;
}

export default function AdminDashboardMonthNav(props: {
  yearMonth: string;
  defaultYearMonth: string;
  months: string[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const monthOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const m of props.months) {
      if (seen.has(m)) continue;
      seen.add(m);
      out.push(m);
    }
    return out;
  }, [props.months]);

  const go = (m: string) => {
    if (m === props.yearMonth) return;
    const qs = new URLSearchParams();
    qs.set('year_month', m);
    const url = `/admin?${qs.toString()}`;
    try {
      router.prefetch(url);
    } catch {
      // ignore
    }
    startTransition(() => {
      router.push(url);
    });
  };

  const isDefault = props.yearMonth === props.defaultYearMonth;

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-3 shadow-sm ring-1 ring-slate-900/[0.035] sm:inline-flex sm:max-w-full sm:flex-row sm:flex-wrap sm:items-center sm:gap-2 sm:p-2.5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => go(props.defaultYearMonth)}
          className={`h-9 shrink-0 rounded-lg border px-3 text-xs font-medium transition-colors disabled:opacity-60 ${
            isDefault
              ? 'border-orange-300 bg-orange-50 text-orange-900 shadow-inner'
              : 'border-slate-200 bg-white text-slate-600 hover:border-orange-200 hover:bg-orange-50/60'
          }`}
        >
          오늘 기준월
        </button>
        <select
          value={props.yearMonth}
          disabled={isPending}
          onChange={(e) => go(e.target.value)}
          className="h-9 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2.5 text-sm font-medium text-slate-800 shadow-sm outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-200/70 disabled:cursor-wait disabled:opacity-60 sm:min-w-[11rem] sm:max-w-xs"
          aria-label="집계 기준월 선택"
        >
          {monthOptions.map((m) => (
            <option key={m} value={m}>
              {ymLabel(m)}
            </option>
          ))}
        </select>
      </div>
      {isPending ? (
        <p className="mt-2 text-[11px] font-medium text-orange-800/80 sm:mt-0 sm:pl-1" role="status">
          불러오는 중…
        </p>
      ) : null}
    </div>
  );
}
