import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { buildDashboardAggregations } from '@/lib/dashboard/aggregations';
import { buildSettlementTreeRows } from '@/lib/settlement/settlement-org-tree';
import type { RankType } from '@/lib/types';

export const metadata: Metadata = { title: '대시보드' };

export const dynamic = 'force-dynamic';

function SectionCard(props: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-6 py-4 border-b border-gray-100">
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="text-sm font-semibold text-gray-800">{props.title}</h3>
          {props.subtitle ? <p className="text-xs text-gray-500">{props.subtitle}</p> : null}
        </div>
      </div>
      <div className="p-6">{props.children}</div>
    </section>
  );
}

function DataTable(props: { rows: Array<{ parent_name: string; member_name: string; unit_sum: number }> }) {
  const maxUnits = props.rows.reduce((m, r) => Math.max(m, r.unit_sum), 0);
  const badgeForRank = (idx: number) => {
    if (idx === 0) return '🥇';
    if (idx === 1) return '🥈';
    if (idx === 2) return '🥉';
    return null;
  };

  return (
    <div className="overflow-auto rounded-lg border border-gray-200">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 sticky top-0 z-10">
          <tr className="text-xs text-gray-500 uppercase tracking-wide">
            <th className="text-left font-medium px-4 py-3 whitespace-nowrap">상위 조직</th>
            <th className="text-left font-medium px-4 py-3 whitespace-nowrap">담당자</th>
            <th className="text-right font-medium px-4 py-3 whitespace-nowrap">구좌 수</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.length ? (
            props.rows.map((r, idx) => (
              <tr key={`${r.member_name}-${idx}`} className="border-t border-gray-100">
                <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{r.parent_name}</td>
                <td className="px-4 py-3 text-gray-900 whitespace-nowrap font-medium">
                  <span className="inline-flex items-center gap-2">
                    {badgeForRank(idx) ? (
                      <span className="text-base" aria-label={`rank-${idx + 1}`}>
                        {badgeForRank(idx)}
                      </span>
                    ) : (
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-[11px] text-gray-600 tabular-nums">
                        {idx + 1}
                      </span>
                    )}
                    <span className="font-medium">{r.member_name}</span>
                  </span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-900">
                  <div className="flex items-center justify-end gap-3">
                    <span className="min-w-[64px] text-right font-medium">{r.unit_sum.toLocaleString()}구좌</span>
                    <div className="w-28">
                      <div className="h-2 rounded-full bg-gray-100">
                        <div
                          className="h-2 rounded-full bg-blue-600"
                          style={{
                            width: `${maxUnits > 0 ? Math.round((r.unit_sum / maxUnits) * 100) : 0}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td className="px-4 py-10 text-center text-gray-400" colSpan={3}>
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
    <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
      <p className="text-xs text-gray-500">{props.label}</p>
      <p className="text-4xl font-semibold text-blue-600 mt-2 tracking-tight">{props.value}</p>
      {props.hint ? <p className="text-xs text-gray-500 mt-2">{props.hint}</p> : null}
    </div>
  );
}

export default async function DashboardPage(props: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const db = createAdminSupabaseClient();
  const sp = (await props.searchParams) ?? {};

  // 요청 스펙: "4월(2026-03-26 ~ 2026-04-25)"를 반드시 지원
  // 기본값은 2026-04로 두되, 필요 시 year_month=YYYY-MM 쿼리로 바꿀 수 있게 한다.
  const yearMonthRaw = sp.year_month;
  const year_month = typeof yearMonthRaw === 'string' ? yearMonthRaw : '2026-04';
  const debugEnabled = sp.debug === '1';

  const agg = await buildDashboardAggregations({ db, year_month });

  // debug=1: organization_edges 누락/이상 케이스를 바로 출력
  let debugEdgeReport: string | null = null;
  if (debugEnabled) {
    const [membersRes, edgesRes] = await Promise.all([
      db
        .from('organization_members')
        .select('id, name, rank, external_id, source_customer_id')
        .eq('is_active', true),
      db.from('organization_edges').select('parent_id, child_id'),
    ]);

    const membersRaw = (membersRes.data ?? []) as Array<{
      id: string;
      name: string;
      rank: RankType;
      external_id?: string | null;
      source_customer_id?: string | null;
    }>;
    const edgesRaw = (edgesRes.data ?? []) as Array<{ parent_id: string | null; child_id: string }>;

    const memberIdSet = new Set(membersRaw.map((m) => m.id));
    const hqIdsRaw = new Set(
      membersRaw.filter((m) => m.name === '안성준' || m.rank === '본사').map((m) => m.id),
    );
    const hqIdForTree =
      membersRaw.find((m) => m.name === '안성준')?.id ?? (hqIdsRaw.values().next().value ?? null);

    const treeRows = buildSettlementTreeRows(
      membersRaw.map((m) => ({
        id: m.id,
        name: m.name,
        rank: m.name === '안성준' ? ('본사' as const) : m.rank,
        source_customer_id: m.source_customer_id ?? null,
      })),
      edgesRaw,
    );

    const edgeByChild = new Map<string, string | null>();
    for (const e of edgesRaw) edgeByChild.set(e.child_id, e.parent_id ?? null);

    const parentIdByMemberId = new Map<string, string | null>();
    for (const r of treeRows) parentIdByMemberId.set(r.id, r.parent_id ?? null);

    const roots = membersRaw
      .filter((m) => !hqIdsRaw.has(m.id))
      .filter((m) => (parentIdByMemberId.get(m.id) ?? null) === null);

    const missingEdge: Array<{ id: string; name: string; reason: string }> = [];
    for (const m of roots) {
      const hasEdgeRow = edgeByChild.has(m.id);
      const rawParent = edgeByChild.get(m.id) ?? null;
      const hasSourceCustomerId = (m.source_customer_id ?? null) != null;

      if (hasSourceCustomerId && !hqIdForTree) {
        missingEdge.push({ id: m.id, name: m.name, reason: '본사(HQ) 멤버를 찾지 못해 customer 직속 규칙 적용 불가' });
        continue;
      }

      if (!hasEdgeRow) {
        missingEdge.push({ id: m.id, name: m.name, reason: 'organization_edges에 child_id 행이 없음(부모 엣지 누락)' });
        continue;
      }

      if (rawParent === null) {
        missingEdge.push({ id: m.id, name: m.name, reason: 'organization_edges.parent_id가 null(루트로 저장됨)' });
        continue;
      }

      if (!memberIdSet.has(rawParent)) {
        missingEdge.push({ id: m.id, name: m.name, reason: `부모 parent_id(${rawParent})가 active organization_members에 없음(비활성/누락)` });
        continue;
      }

      // treeRows로 parent가 null이 된 케이스는 보통 위 케이스로 커버되지만, 예외가 있으면 잡는다.
      missingEdge.push({ id: m.id, name: m.name, reason: '원인 미상: parent가 null로 계산됨(추가 조사 필요)' });
    }

    debugEdgeReport = [
      `debug=1 edge report`,
      `- active members: ${membersRaw.length}`,
      `- edges rows: ${edgesRaw.length}`,
      `- HQ id: ${hqIdForTree ?? '(없음)'}`,
      `- root-like members(parent_id=null, excluding HQ): ${roots.length}`,
      ``,
      ...missingEdge.map((r) => `- ${r.name} (${r.id}): ${r.reason}`),
    ].join('\n');
  }

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
      label: '총 누적 가입완료 구좌 수',
      value: `${agg.allTimeJoinedSlots.total_units.toLocaleString()}구좌`,
      hint: '',
    },
  ];

  return (
    <div className="p-8 space-y-8">
      <header className="flex items-end justify-between gap-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">대시보드</h2>
          
        </div>
        <div className="text-xs text-gray-500 text-right">
          <div>브리핑 생성일: {agg.briefing.run_date_ymd}</div>
          <div>브리핑 기준일(전날): {agg.briefing.base_date_ymd}</div>
        </div>
      </header>

      {/* 1) 상단: 핵심 요약 카드 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {summaryCards.map((c) => (
          <SummaryCard key={c.label} label={c.label} value={c.value} hint={c.hint} />
        ))}
      </div>

      {/* 2) 중단: 상세 데이터 테이블 */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
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

        <SectionCard title="전체 누적 가입완료 구좌 수" subtitle="전체 기간 (가입기준 충족)">
          <DataTable rows={agg.allTimeJoinedSlots.rows} />
        </SectionCard>

        <SectionCard title="담당자별 전날 영업 실적" subtitle={`기준일: ${agg.briefing.base_date_ymd}`}>
          <DataTable rows={agg.dailyPerformanceByMember.rows} />
        </SectionCard>
      </div>

      {/* 3) 하단: 텍스트 브리핑 박스 */}
      <SectionCard title="아침 브리핑 (복붙용)" subtitle="그대로 복사해서 공유">
        <div className="grid grid-cols-1 gap-3">
          <textarea
            className="w-full min-h-[320px] resize-y rounded-lg border border-gray-200 bg-gray-50 p-4 font-mono text-xs leading-5 text-gray-900"
            readOnly
            value={agg.briefing.text}
          />
          <p className="text-xs text-gray-500">
            브리핑은 {agg.briefing.base_date_ymd} 기준입니다.
          </p>
        </div>
      </SectionCard>

      {debugEnabled ? (
        <SectionCard title="디버그: organization_edges 누락/이상" subtitle="debug=1로만 표시">
          <textarea
            className="w-full min-h-[240px] resize-y rounded-lg border border-gray-200 bg-gray-50 p-4 font-mono text-xs leading-5 text-gray-900"
            readOnly
            value={debugEdgeReport ?? '(debug report 생성 실패)'}
          />
          <p className="mt-2 text-xs text-gray-500">
            여기서 <span className="font-mono">parent_id=null</span>로 분류된 멤버는, 대시보드 트리 기준으로 상위가 없는 상태입니다.
          </p>
        </SectionCard>
      ) : null}
    </div>
  );
}
