import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import YearMonthSelector from '@/components/YearMonthSelector';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import {
  buildDashboardAggregations,
  type DashboardAggRow,
  type DashboardDirectPerfRow,
} from '@/lib/dashboard/aggregations';
import { getSettlementWindowSeoul } from '@/lib/settlement/settlement-window';

export const metadata: Metadata = { title: '대시보드' };

export const dynamic = 'force-dynamic';

function SectionCard(props: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm ring-1 ring-slate-900/[0.035]">
      <div className="border-b border-orange-100/90 bg-gradient-to-r from-orange-50/50 to-white px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
          <h3 className="text-sm font-semibold text-orange-950">{props.title}</h3>
          {props.subtitle ? <p className="text-xs text-slate-500">{props.subtitle}</p> : null}
        </div>
      </div>
      <div className="p-4 sm:p-6">{props.children}</div>
    </section>
  );
}

function DataTable(props: {
  rows: DashboardAggRow[];
  /** true면 가입완료 누적 표: 최근 가입일 열 표시(집계 구간 내 해당 담당자 기준 최신 join_date) */
  showLatestJoinDate?: boolean;
  /** false면 구좌 수 옆 비율 막대 숨김 */
  showUnitBar?: boolean;
}) {
  const { rows, showLatestJoinDate, showUnitBar = true } = props;
  const maxUnits = showUnitBar ? rows.reduce((m, r) => Math.max(m, r.unit_sum), 0) : 0;
  const colSpan = showLatestJoinDate ? 4 : 3;

  return (
    <div className="overflow-auto rounded-lg border border-slate-200/90 max-h-[420px] lg:max-h-[520px]">
      <table className="min-w-full text-sm">
        <thead className="sticky top-0 z-10 bg-orange-50/80">
          <tr className="text-xs uppercase tracking-wide text-slate-500">
            <th className="text-left font-medium px-4 py-2 whitespace-nowrap">상위 조직</th>
            <th className="text-left font-medium px-4 py-2 whitespace-nowrap">담당자</th>
            {showLatestJoinDate ? (
              <th className="text-right font-medium px-4 py-2 whitespace-nowrap">가입일</th>
            ) : null}
            <th className="text-right font-medium px-4 py-2 whitespace-nowrap">구좌 수</th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((r, idx) => (
              <tr key={`${r.member_name}-${idx}`} className="border-t border-gray-100">
                <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{r.parent_name}</td>
                <td className="px-4 py-2 text-gray-900 whitespace-nowrap font-medium">
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-[11px] text-gray-600 tabular-nums"
                      aria-label={`순위 ${idx + 1}위`}
                    >
                      {idx + 1}
                    </span>
                    <span className="font-medium">{r.member_name}</span>
                  </span>
                </td>
                {showLatestJoinDate ? (
                  <td className="px-4 py-2 text-right tabular-nums text-gray-700 whitespace-nowrap">
                    {r.latest_join_date ?? '—'}
                  </td>
                ) : null}
                <td className="px-4 py-2 text-right tabular-nums text-gray-900">
                  <div
                    className={
                      showUnitBar ? 'flex items-center justify-end gap-3' : 'flex items-center justify-end'
                    }
                  >
                    <span className="min-w-[64px] text-right font-medium">{r.unit_sum.toLocaleString()}구좌</span>
                    {showUnitBar ? (
                      <div className="w-28">
                        <div className="h-2 rounded-full bg-gray-100">
                          <div
                            className="h-2 rounded-full bg-orange-500"
                            style={{
                              width: `${maxUnits > 0 ? Math.round((r.unit_sum / maxUnits) * 100) : 0}%`,
                            }}
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td className="px-4 py-6 text-center text-gray-400" colSpan={colSpan}>
                데이터 없음
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function DirectPerfTable(props: { rows: DashboardDirectPerfRow[] }) {
  return (
    <div className="overflow-auto rounded-lg border border-slate-200/90 max-h-[420px] lg:max-h-[520px]">
      <table className="min-w-full text-sm">
        <thead className="sticky top-0 z-10 bg-orange-50/80">
          <tr className="text-xs uppercase tracking-wide text-slate-500">
            <th className="text-left font-medium px-4 py-2 whitespace-nowrap">담당자</th>
            <th className="text-right font-medium px-4 py-2 whitespace-nowrap">구좌 수</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.length ? (
            props.rows.map((r, idx) => (
              <tr key={`${r.member_name}-${idx}`} className="border-t border-gray-100">
                <td className="px-4 py-2 text-gray-900 whitespace-nowrap font-medium">
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-[11px] text-gray-600 tabular-nums"
                      aria-label={`순위 ${idx + 1}위`}
                    >
                      {idx + 1}
                    </span>
                    <span>{r.member_name}</span>
                  </span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-900">
                  {r.unit_sum.toLocaleString()}구좌
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td className="px-4 py-6 text-center text-gray-400" colSpan={2}>
                데이터 없음
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function SummaryCard(props: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex min-h-0 flex-col rounded-xl border border-slate-200/85 bg-gradient-to-b from-white to-slate-50/80 p-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.06)] ring-1 ring-slate-900/[0.02] sm:p-4">
      <p className="break-keep text-[10px] font-medium leading-snug text-slate-400 sm:text-xs sm:text-slate-500">
        {props.label}
      </p>
      <p className="mt-1.5 text-xl font-semibold tabular-nums tracking-tight text-orange-700 sm:mt-2 sm:text-2xl lg:text-3xl">
        {props.value}
      </p>
      {props.hint ? (
        <p className="mt-1 text-[10px] leading-snug text-slate-400 break-keep sm:mt-2 sm:text-xs sm:text-slate-500">
          {props.hint}
        </p>
      ) : null}
    </div>
  );
}

export default async function DashboardPage(props: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const db = createAdminSupabaseClient();
  const sp = (await props.searchParams) ?? {};

  // 기본값: "오늘 날짜가 포함되는 정산 윈도우(26~25)"의 기준월(label_year_month)
  // 필요 시 year_month=YYYY-MM 쿼리로 바꿀 수 있다.
  const yearMonthRaw = sp.year_month;
  const defaultYearMonth = getSettlementWindowSeoul().label_year_month;
  const requestedYearMonth = typeof yearMonthRaw === 'string' ? yearMonthRaw : defaultYearMonth;
  const year_month = /^\d{4}-\d{2}$/.test(requestedYearMonth) ? requestedYearMonth : defaultYearMonth;

  const agg = await buildDashboardAggregations({ db, year_month });

  const yearsForPicker = (() => {
    const base = parseInt(year_month.slice(0, 4), 10);
    const out: number[] = [];
    for (let y = base; y >= base - 4; y--) out.push(y);
    return out;
  })();

  const summaryCards = [
    {
      label: `${agg.year_month} 누적 신청 구좌 수`,
      value: `${agg.monthlyTotalSlots.total_units.toLocaleString()}구좌`,
      hint: ``,
    },
    {
      label: `전날(${agg.briefing.base_date_ymd}) 신청 구좌 수`,
      value: `${agg.dailyTotalSlots.total_units.toLocaleString()}구좌`,
      hint: '',
    },
    {
      label: `${agg.year_month} 가입완료 구좌 수`,
      value: `${agg.monthlyJoinedSlots.total_units.toLocaleString()}구좌`,
      hint: ``,
    },
    {
      label: `${agg.year_month} 가입 보류 구좌 수`,
      value: `${agg.monthlyJoinDeferredSlots.total_units.toLocaleString()}구좌`,
      hint: '',
    },
    {
      label: '총 누적 가입완료 구좌 수',
      value: `${agg.allTimeJoinedSlots.total_units.toLocaleString()}구좌`,
      hint: '',
    },
  ];

  return (
    <div className="space-y-5 p-4 sm:space-y-8 sm:p-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">대시보드</h2>
        </div>
        <div className="text-xs text-slate-500 sm:text-right">
          <div>브리핑 생성일: {agg.briefing.run_date_ymd}</div>
          <div>브리핑 기준일(전날): {agg.briefing.base_date_ymd}</div>
        </div>
      </header>

      {/* 집계 기준월 — /organization과 동일 YearMonthSelector (연·월 분리) */}
      <section className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-3 shadow-sm ring-1 ring-slate-900/[0.035] sm:p-4">
        <YearMonthSelector
          layout="compact-toolbar"
          className="min-w-0"
          value={year_month}
          todayValue={defaultYearMonth}
          years={yearsForPicker}
          todayLabel="오늘 기준월"
        />
      </section>

      {/* 1) 상단: 핵심 요약 카드 — 5장: 모바일 2열, 중간 3열, 넓은 화면 5열 */}
      <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3 xl:grid-cols-5 xl:gap-3">
        {summaryCards.map((c) => (
          <SummaryCard key={c.label} label={c.label} value={c.value} hint={c.hint} />
        ))}
      </div>

      {/* 2) 중단: 상세 데이터 테이블 */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 xl:gap-8">
        <SectionCard
          title={`${agg.year_month} 누적 신청 구좌 수`}
          subtitle={`${agg.month_window.start_date} ~ ${agg.month_window.end_date} (상태 전체 포함)`}
        >
          <DataTable rows={agg.monthlyTotalSlots.rows} />
        </SectionCard>

        <SectionCard title={`전날(${agg.briefing.base_date_ymd}) 신청 구좌 수`} subtitle="상태 전체 포함">
          <DataTable rows={agg.dailyTotalSlots.rows} />
        </SectionCard>

        <SectionCard
          title={`${agg.year_month} 가입완료 구좌 수`}
          subtitle={`${agg.month_window.start_date} ~ ${agg.month_window.end_date} (가입기준 충족)`}
        >
          <DataTable rows={agg.monthlyJoinedSlots.rows} />
        </SectionCard>

        <SectionCard
          title="전체 누적 가입완료 구좌 수"
          subtitle="전체 기간(가입기준 충족)"
        >
          <DataTable rows={agg.allTimeJoinedSlots.rows} showLatestJoinDate showUnitBar={false} />
        </SectionCard>

        {/* "담당자별 전날 영업 실적" 섹션은 숨김 처리 */}
      </div>

      <SectionCard
        title={`${agg.year_month} 담당자별 실적`}
        subtitle={`${agg.month_window.start_date} ~ ${agg.month_window.end_date}`}
      >
        <DirectPerfTable rows={agg.monthlyDirectJoinedBySalesMember.rows} />
      </SectionCard>

      {/* 3) 하단: 텍스트 브리핑 박스 */}
      <SectionCard title="아침 브리핑 (복붙용)" subtitle="그대로 복사해서 공유">
        <div className="grid grid-cols-1 gap-3">
          <textarea
            className="w-full min-h-[320px] resize-y rounded-lg border border-slate-200 bg-orange-50/30 p-4 font-mono text-xs leading-5 text-slate-900"
            readOnly
            value={agg.briefing.text}
          />
          <p className="text-xs text-gray-500">
            브리핑은 {agg.briefing.base_date_ymd} 기준입니다.
          </p>
        </div>
      </SectionCard>
    </div>
  );
}
