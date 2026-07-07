import type { Metadata } from 'next';
import Link from 'next/link';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import {
  SUMMER_FESTIVAL_END_YMD,
  SUMMER_FESTIVAL_NAME,
  SUMMER_FESTIVAL_START_YMD,
  buildSummerFestivalContractAuditRow,
  summerFestivalStatus,
  type SummerFestivalContractAuditRow,
} from '@/lib/promotion/summer-festival';
import { extractMemberName } from '@/lib/utils/normalize-member-name';

export const metadata: Metadata = { title: '프로모션 · 썸머 페스티벌' };
export const dynamic = 'force-dynamic';

type ViewTab = 'confirmed' | 'near' | 'all' | 'audit';

interface PageProps {
  searchParams: Promise<{
    view?: ViewTab;
    member_id?: string;
  }>;
}

function fmtUnits(n: number): string {
  // 0.5 단위 표시를 위해 소수 1자리 고정(정수는 .0 제거)
  const s = n.toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

export default async function SummerFestivalPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const view: ViewTab = (params.view ?? 'confirmed') as ViewTab;
  const memberId = (params.member_id ?? '').trim() || null;

  const db = createAdminSupabaseClient();

  const [{ data: members }, { data: contractsInWindow }, { data: contractsForAudit }] =
    await Promise.all([
      db
        .from('organization_members')
        .select('id,name')
        .eq('is_active', true)
        .order('name'),
      db
        .from('contracts')
        .select(
          'id,contract_code,sales_member_id,customer_id,unit_count,status,is_cancelled,sales_link_status,happy_call_at,happycall_result,invoice_no,product_type,item_name,source_snapshot_json,customers(name)',
        )
        .gte('happy_call_at', '2026-06-26T00:00:00+09:00')
        .lte('happy_call_at', '2026-08-25T23:59:59+09:00')
        .order('happy_call_at', { ascending: false })
        .limit(20000),
      memberId
        ? db
            .from('contracts')
            .select(
              'id,contract_code,sales_member_id,customer_id,unit_count,status,is_cancelled,sales_link_status,happy_call_at,happycall_result,invoice_no,product_type,item_name,source_snapshot_json,customers(name)',
            )
            .eq('sales_member_id', memberId)
            .order('happy_call_at', { ascending: false })
            .limit(5000)
        : Promise.resolve({ data: [] as any[] }),
    ]);

  const memberNameById = new Map<string, string>();
  for (const m of (members ?? []) as any[]) {
    memberNameById.set(String(m.id), extractMemberName(String(m.name ?? '')).replace(/^\[고객\]\s*/, ''));
  }

  const windowRows: SummerFestivalContractAuditRow[] = ((contractsInWindow ?? []) as any[]).map((c) =>
    buildSummerFestivalContractAuditRow({
      id: String(c.id),
      contract_code: (c.contract_code ?? null) as string | null,
      sales_member_id: (c.sales_member_id ?? null) as string | null,
      sales_member_name: c.sales_member_id ? memberNameById.get(String(c.sales_member_id)) ?? null : null,
      customer_id: (c.customer_id ?? null) as string | null,
      customer_name: ((c.customers as any)?.name ?? null) as string | null,
      unit_count: Number(c.unit_count ?? 0),
      status: String(c.status ?? ''),
      is_cancelled: Boolean(c.is_cancelled ?? false),
      sales_link_status: (c.sales_link_status ?? null) as string | null,
      happy_call_at: c.happy_call_at ?? null,
      happycall_result: (c.happycall_result ?? null) as string | null,
      invoice_no: (c.invoice_no ?? null) as string | null,
      product_type: (c.product_type ?? null) as string | null,
      item_name: (c.item_name ?? null) as string | null,
      source_snapshot_json: (c.source_snapshot_json ?? null) as Record<string, string | null> | null,
    }),
  );

  type Agg = {
    member_id: string;
    member_name: string;
    actual_units: number;
    summer_units: number;
    appliance_units: number;
    care_units: number;
    double_window_contract_count: number;
  };

  const aggByMemberId = new Map<string, Agg>();
  for (const r of windowRows) {
    if (!r.sales_member_id) continue;
    const a = aggByMemberId.get(r.sales_member_id) ?? {
      member_id: r.sales_member_id,
      member_name: r.sales_member_name ?? memberNameById.get(r.sales_member_id) ?? r.sales_member_id,
      actual_units: 0,
      summer_units: 0,
      appliance_units: 0,
      care_units: 0,
      double_window_contract_count: 0,
    };
    if (r.eligible) {
      a.actual_units += r.actual_unit_count;
      a.summer_units += r.summer_units;
      if (r.product_kind === 'general_appliance') a.appliance_units += r.summer_units;
      else a.care_units += r.summer_units;
      if (r.period_multiplier === 2) a.double_window_contract_count += 1;
    }
    aggByMemberId.set(r.sales_member_id, a);
  }

  const allAgg = [...aggByMemberId.values()]
    .map((a) => ({
      ...a,
      status: summerFestivalStatus(a.summer_units),
      remaining: Math.max(0, 20 - a.summer_units),
    }))
    .sort((a, b) => b.summer_units - a.summer_units || b.actual_units - a.actual_units);

  const filteredAgg =
    view === 'confirmed'
      ? allAgg.filter((r) => r.status === '참가 확정')
      : view === 'near'
        ? allAgg.filter((r) => r.status === '근접 대상')
        : allAgg;

  const auditRows: SummerFestivalContractAuditRow[] = memberId
    ? ((contractsForAudit ?? []) as any[]).map((c) =>
        buildSummerFestivalContractAuditRow({
          id: String(c.id),
          contract_code: (c.contract_code ?? null) as string | null,
          sales_member_id: (c.sales_member_id ?? null) as string | null,
          sales_member_name: c.sales_member_id ? memberNameById.get(String(c.sales_member_id)) ?? null : null,
          customer_id: (c.customer_id ?? null) as string | null,
          customer_name: ((c.customers as any)?.name ?? null) as string | null,
          unit_count: Number(c.unit_count ?? 0),
          status: String(c.status ?? ''),
          is_cancelled: Boolean(c.is_cancelled ?? false),
          sales_link_status: (c.sales_link_status ?? null) as string | null,
          happy_call_at: c.happy_call_at ?? null,
          happycall_result: (c.happycall_result ?? null) as string | null,
          invoice_no: (c.invoice_no ?? null) as string | null,
          product_type: (c.product_type ?? null) as string | null,
          item_name: (c.item_name ?? null) as string | null,
          source_snapshot_json: (c.source_snapshot_json ?? null) as Record<string, string | null> | null,
        }),
      )
    : [];

  const tabs: Array<{ key: ViewTab; label: string; count?: number }> = [
    { key: 'confirmed', label: '참가 확정자', count: allAgg.filter((r) => r.status === '참가 확정').length },
    { key: 'near', label: '근접 대상자', count: allAgg.filter((r) => r.status === '근접 대상').length },
    { key: 'all', label: '전체 현황', count: allAgg.length },
    { key: 'audit', label: '계약별 산출 감사', count: memberId ? auditRows.length : 0 },
  ];

  const tabHref = (k: ViewTab) => {
    const sp = new URLSearchParams();
    sp.set('view', k);
    if (memberId) sp.set('member_id', memberId);
    return `/admin/promotion/summer-festival?${sp.toString()}`;
  };

  const currentMemberName = memberId ? memberNameById.get(memberId) ?? memberId : null;

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4">
        <div className="text-xs text-gray-500">관리자 · 프로모션 관리</div>
        <h2 className="text-xl sm:text-2xl font-bold text-gray-800 mt-2 break-keep">
          {SUMMER_FESTIVAL_NAME} 자격 현황
        </h2>
        <p className="text-xs sm:text-sm text-gray-600 mt-2 leading-relaxed">
          해피콜 완료일 기준 {SUMMER_FESTIVAL_START_YMD}~{SUMMER_FESTIVAL_END_YMD} 기간 내{' '}
          <span className="font-semibold">직접판매(담당 영업자 기준)</span>만 집계합니다.
          <br />
          산하 계약/오버라이드/승급용 더블업 인정구좌는 포함되지 않으며,{' '}
          <span className="font-semibold">계약 1구좌당 썸머 인정은 최대 1.0</span>을 넘지 않습니다.
        </p>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {tabs.map((t) => {
          const active = t.key === view;
          return (
            <Link
              key={t.key}
              href={tabHref(t.key)}
              className={[
                'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold',
                active
                  ? 'border-orange-300 bg-orange-50 text-orange-800'
                  : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
              ].join(' ')}
            >
              {t.label}
              {t.count != null ? (
                <span className="rounded-full bg-white/70 px-2 py-0.5 tabular-nums text-[11px] text-gray-600">
                  {t.count.toLocaleString()}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>

      {view !== 'audit' ? (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs sm:text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {[
                    '순위',
                    '영업자',
                    '실제 직접판매 구좌',
                    '썸머 인정구좌',
                    '참가 상태',
                    '잔여 필요 구좌',
                    '일반가전 인정',
                    '케어·라이트 인정',
                    '더블업 기간 계약 수',
                  ].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-600 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredAgg.map((r, idx) => {
                  const sp = new URLSearchParams();
                  sp.set('view', 'audit');
                  sp.set('member_id', r.member_id);
                  return (
                    <tr key={r.member_id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 tabular-nums text-gray-500">{idx + 1}</td>
                      <td className="px-3 py-2">
                        <Link className="text-blue-600 hover:underline" href={`/admin/promotion/summer-festival?${sp.toString()}`}>
                          {r.member_name}
                        </Link>
                      </td>
                      <td className="px-3 py-2 tabular-nums text-right">{r.actual_units.toLocaleString()}</td>
                      <td className="px-3 py-2 tabular-nums text-right font-semibold text-orange-800">{fmtUnits(r.summer_units)}</td>
                      <td className="px-3 py-2 text-xs">
                        <span
                          className={[
                            'inline-flex rounded-full px-2 py-0.5 font-semibold',
                            r.status === '참가 확정'
                              ? 'bg-emerald-50 text-emerald-700'
                              : r.status === '근접 대상'
                                ? 'bg-amber-50 text-amber-700'
                                : r.status === '진행 중'
                                  ? 'bg-slate-50 text-slate-700'
                                  : 'bg-gray-50 text-gray-500',
                          ].join(' ')}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 tabular-nums text-right">{fmtUnits(r.remaining)}</td>
                      <td className="px-3 py-2 tabular-nums text-right text-gray-700">{fmtUnits(r.appliance_units)}</td>
                      <td className="px-3 py-2 tabular-nums text-right text-gray-700">{fmtUnits(r.care_units)}</td>
                      <td className="px-3 py-2 tabular-nums text-right">{r.double_window_contract_count.toLocaleString()}</td>
                    </tr>
                  );
                })}
                {filteredAgg.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-10 text-center text-sm text-gray-500">
                      표시할 대상자가 없습니다.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
            <div className="text-xs text-gray-700 font-semibold">계약별 산출 감사</div>
            <div className="text-[11px] text-gray-500 mt-1">
              대상 영업자: <span className="font-semibold text-gray-700">{currentMemberName ?? '(member_id 필요)'}</span>
              <span className="ml-2 text-gray-400">
                (직접판매 귀속 기준: 계약 담당 영업자 = contracts.sales_member_id)
              </span>
            </div>
          </div>
          {!memberId ? (
            <div className="px-4 py-8 text-center text-sm text-gray-500">
              감사 탭은 <code className="font-mono">member_id</code>가 필요합니다. 위 목록에서 영업자 이름을 클릭하세요.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    {[
                      '해피콜 완료일',
                      '해피콜 결과',
                      '계약 상태',
                      '계약코드',
                      '실적 귀속 영업자',
                      '가입 고객',
                      '상품 원본명',
                      '표준 카테고리',
                      '실제 구좌',
                      '기본 가중치',
                      '기간 배수',
                      '1구좌당 인정',
                      '최종 썸머 인정',
                      '직접판매 인정',
                      '제외 사유',
                    ].map((h) => (
                      <th key={h} className="px-3 py-2 text-left font-semibold text-gray-600 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {auditRows.map((r) => {
                    return (
                      <tr key={r.contract_id} className={r.eligible ? 'hover:bg-gray-50' : 'bg-gray-50/40 hover:bg-gray-50'}>
                        <td className="px-3 py-2 whitespace-nowrap">{r.happycall_ymd ?? '-'}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{r.happycall_result ?? '-'}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{r.contract_status ?? '-'}</td>
                        <td className="px-3 py-2 font-mono whitespace-nowrap">{r.contract_code ?? r.contract_id}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {r.sales_member_name ?? r.sales_member_id ?? '-'}
                          {r.attribution_sales_label ? (
                            <span className="ml-2 text-[11px] text-gray-400">{r.attribution_sales_label}</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{r.customer_name ?? r.customer_id ?? '-'}</td>
                        <td className="px-3 py-2 whitespace-nowrap max-w-[240px] truncate" title={r.product_raw_name ?? ''}>
                          {r.product_raw_name ?? '-'}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{r.product_standard_category}</td>
                        <td className="px-3 py-2 tabular-nums text-right">{r.actual_unit_count.toLocaleString()}</td>
                        <td className="px-3 py-2 tabular-nums text-right">{r.base_weight.toFixed(1)}</td>
                        <td className="px-3 py-2 tabular-nums text-right">×{r.period_multiplier}</td>
                        <td className="px-3 py-2 tabular-nums text-right">{r.per_unit_value.toFixed(1)}</td>
                        <td className="px-3 py-2 tabular-nums text-right font-semibold text-orange-800">
                          {fmtUnits(r.summer_units)}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{r.eligible ? '인정' : '미인정'}</td>
                        <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{r.exclusion_reason ?? '-'}</td>
                      </tr>
                    );
                  })}
                  {auditRows.length === 0 ? (
                    <tr>
                      <td colSpan={15} className="px-3 py-10 text-center text-sm text-gray-500">
                        표시할 계약이 없습니다.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

