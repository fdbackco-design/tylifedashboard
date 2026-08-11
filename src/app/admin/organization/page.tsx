import type { Metadata } from 'next';
import Link from 'next/link';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { sumHqRevenueForContracts } from '@/lib/settlement/hq-revenue';
import {
  coalesceYearMonthSearchParam,
  contractJoinYmdInInclusiveWindow,
  getSettlementWindowForYearMonth,
  getSettlementWindowSeoul,
  getSettlementWindowDisplayForYearMonth,
  normalizeYearMonthLabel,
} from '@/lib/settlement/settlement-window';
import { getContractDisplayStatus } from '@/lib/utils/contract-display-status';
import {
  buildAdminOrgDisplayContext,
  type AdminOrgRawContractRow,
} from '@/lib/organization/admin-org-display-context';
import { isParentOverrideActiveForYearMonth } from '@/lib/settlement/pre-issued-code-special';
import YearMonthSelector from '@/components/YearMonthSelector';
import {
  flattenOrgTreeNodes,
  stripOrgTreeNodesForDisplay,
} from '@/lib/organization/org-tree-display';
import { ORG_CUSTOMER_NODE_SPLIT_BY_SALES_PARENT_IDS } from '@/lib/organization/org-customer-node-split';
import { PROMOTION_WALK_MEMBER_NAME_BY_CONTRACT_CODE } from '@/lib/settlement/promotion-walk-attribution-overrides';
import { getContractDisplayProductName } from '@/lib/utils/contract-display-product';
import type { ContractItem } from '@/components/org-tree/OrgTreeNode';
import type { OrganizationMember } from '@/lib/types';
import SyncButton from './SyncButton';
import SettlementSalesMemberOverridePanel from './SettlementSalesMemberOverridePanel';
import AdminOrgTreeWithMetrics from './AdminOrgTreeWithMetrics';

export const metadata: Metadata = { title: '조직도' };
export const dynamic = 'force-dynamic';

function formatWon(value: number): string {
  return `${Math.round(value).toLocaleString('ko-KR')}원`;
}

/** 모바일 등에서 금액을 짧게 표시 (원 단위는 title 등으로 병기) */
function formatWonShort(value: number): string {
  const v = Math.round(Number(value) || 0);
  if (!Number.isFinite(v) || v === 0) return '0원';
  const eok = Math.floor(v / 100_000_000);
  const man = Math.round((v % 100_000_000) / 10_000);
  if (eok > 0 && man > 0) return `${eok.toLocaleString('ko-KR')}억 ${man.toLocaleString('ko-KR')}만원`;
  if (eok > 0) return `${eok.toLocaleString('ko-KR')}억원`;
  if (man >= 1) return `${man.toLocaleString('ko-KR')}만원`;
  return `${v.toLocaleString('ko-KR')}원`;
}

function formatSyncBarTime(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const pick = (t: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === t)?.value?.padStart(2, '0') ?? '';
  return `${pick('month')}.${pick('day')} ${pick('hour')}:${pick('minute')}`;
}

export default async function OrganizationPage({
  searchParams,
}: {
  searchParams?: Promise<{ year_month?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const db = createAdminSupabaseClient();

  const defaultYearMonth = getSettlementWindowSeoul().label_year_month;
  const requestedYearMonthRaw =
    coalesceYearMonthSearchParam(sp.year_month as string | string[] | undefined) ?? defaultYearMonth;
  const yearMonth = normalizeYearMonthLabel(requestedYearMonthRaw) ?? defaultYearMonth;
  const { start_date, end_date, label_year_month } = getSettlementWindowForYearMonth(yearMonth);
  // 표시 전용: 공휴일/주말 보정된 정산 구간 (데이터 필터/계산에는 영향 없음).
  const displayWindow = getSettlementWindowDisplayForYearMonth(yearMonth);

  const yearsForPicker = (() => {
    const base = parseInt(label_year_month.slice(0, 4), 10);
    const out: number[] = [];
    for (let y = base; y >= base - 4; y--) out.push(y);
    return out;
  })();

  const [membersRes, edgesRes, contractCountRes, lastSyncRes, contractsRes, kpiRes] = await Promise.all([
    db
      .from('organization_members')
      .select('id, name, rank, external_id, phone, source_customer_id, leader_rank_effective_at, monthly_target_units, lock_center_chief_promotion')
      .eq('is_active', true)
      .order('name'),
    db.from('organization_edges').select('parent_id, child_id'),
    db.from('contracts').select('id', { count: 'estimated', head: true }),
    db
      .from('sync_runs')
      .select('id, status, triggered_by, started_at, finished_at, total_fetched, total_created, total_updated, total_errors')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from('contracts')
      .select(
        'id, contract_code, join_date, product_type, item_name, rental_request_no, invoice_no, memo, status, unit_count, customer_id, sales_member_id, is_cancelled, sales_link_status, happy_call_at, happycall_result, source_snapshot_json, created_at, invoice_registered_at, customers(name, phone, birth_date)',
      )
      .not('sales_member_id', 'is', null)
      .order('join_date', { ascending: false })
      .limit(20000),
    db.rpc('get_organization_kpis', { p_start_date: start_date, p_end_date: end_date }),
  ]);

  // 코드 선발급자: 월말 기준 활성 설정은 해당 월 조직도에도 동일하게 반영한다.
  const preIssuedRes = await db
    .from('pre_issued_code_member_settings')
    .select('member_id,parent_leader_member_id,effective_from,effective_to,status')
    .limit(5000);
  const parentOverrideByChildId = new Map<string, string | null>();
  if (!preIssuedRes.error) {
    for (const s of (preIssuedRes.data ?? []) as any[]) {
      const st = String(s.status ?? 'active');
      const setting = {
        id: 'n/a',
        member_id: String(s.member_id ?? ''),
        parent_leader_member_id: String(s.parent_leader_member_id ?? ''),
        reason: '',
        special_unit_price: 0,
        special_unit_limit: 0,
        effective_from: String(s.effective_from ?? '').slice(0, 10),
        effective_to: s.effective_to ? String(s.effective_to).slice(0, 10) : null,
        status: st as any,
        note: null,
      };
      if (!setting.member_id || !setting.parent_leader_member_id) continue;
      if (!isParentOverrideActiveForYearMonth(setting as any, label_year_month)) continue;
      parentOverrideByChildId.set(setting.member_id, setting.parent_leader_member_id);
    }
  }

  // 안성준은 TY Life 시스템상 영업사원이지만 실제로는 본사(최상위)로 취급
  const membersRaw = ((membersRes.data ?? []) as unknown as OrganizationMember[]).map((m) =>
    m.name === '안성준' ? { ...m, rank: '본사' as const } : m,
  );
  const sourceCustomerIds = [
    ...new Set(
      ((membersRes.data ?? []) as Array<{ source_customer_id?: string | null }>)
        .map((m) => m.source_customer_id ?? null)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const customerBirthDateById = new Map<string, string | null>();
  if (sourceCustomerIds.length > 0) {
    const { data: sourceCustomers } = await db
      .from('customers')
      .select('id, birth_date')
      .in('id', sourceCustomerIds);
    for (const customer of (sourceCustomers ?? []) as Array<{ id: string; birth_date: string | null }>) {
      customerBirthDateById.set(customer.id, customer.birth_date);
    }
  }
  const edgesRaw = edgesRes.data ?? [];
  const contractCount = contractCountRes.count ?? 0;
  const lastSync = lastSyncRes.data as {
    id: string;
    status: string;
    triggered_by: string;
    started_at: string;
    finished_at: string | null;
    total_fetched: number | null;
    total_created: number | null;
    total_updated: number | null;
    total_errors: number | null;
  } | null;

  const rawContractRows = (contractsRes.data ?? []) as unknown as AdminOrgRawContractRow[];

  const {
    members,
    tree,
    remapMemberId,
    resolveSettlementWalkSalesMemberId,
    remapCustomerMemberId,
    salesMemberDisplayName,
  } = buildAdminOrgDisplayContext({
    membersRaw,
    edgesRaw,
    rawContractRows,
    parentOverrideByChildId,
    customerBirthDateById,
  });

  const parentByChildId = new Map<string, string | null>();
  for (const e of edgesRaw as Array<{ parent_id: string | null; child_id: string }>) {
    parentByChildId.set(remapMemberId(e.child_id), e.parent_id ? remapMemberId(e.parent_id) : null);
  }
  for (const [childId, parentId] of parentOverrideByChildId) {
    parentByChildId.set(remapMemberId(childId), parentId ? remapMemberId(parentId) : null);
  }

  const contractsByMember: Record<string, ContractItem[]> = {};
  for (const c of rawContractRows) {
    const splitBySalesParent = ORG_CUSTOMER_NODE_SPLIT_BY_SALES_PARENT_IDS.has(c.customer_id);
    const walkKey = resolveSettlementWalkSalesMemberId({
      sales_member_id: c.sales_member_id,
      customer_id: c.customer_id,
      status: c.status,
      rental_request_no: c.rental_request_no ?? null,
      invoice_no: c.invoice_no ?? null,
      memo: c.memo ?? null,
      customer_phone: c.customers?.phone ?? null,
      contract_code: c.contract_code,
      customer_name: c.customers?.name ?? '',
      customer_birth_date: c.customers?.birth_date ?? null,
    });
    // 정성훈: 자기구매(고객노드) 귀속을 쓰지 않고 실제 담당자로 표시해 담당자별 분리
    // 그 외(누적 walk override 포함): 승급/누적과 동일한 walk 귀속
    const key = splitBySalesParent ? remapMemberId(c.sales_member_id) : walkKey;
    if (!contractsByMember[key]) contractsByMember[key] = [];
    const contractItem: ContractItem = {
      id: c.id,
      contract_code: c.contract_code,
      join_date: c.join_date,
      happy_call_at: c.happy_call_at ?? null,
      product_type: getContractDisplayProductName({
        product_type: c.product_type,
        item_name: c.item_name,
        source_snapshot_json: c.source_snapshot_json ?? null,
      }),
      item_name: c.item_name ?? null,
      rental_request_no: c.rental_request_no ?? null,
      invoice_no: c.invoice_no ?? null,
      memo: c.memo ?? null,
      status: c.status,
      unit_count: c.unit_count,
      customer_name: c.customers?.name ?? '',
      sales_member_name: salesMemberDisplayName(c.sales_member_id),
    };
    contractsByMember[key].push(contractItem);

    const hasWalkOverride = Boolean(
      PROMOTION_WALK_MEMBER_NAME_BY_CONTRACT_CODE[String(c.contract_code ?? '').trim()],
    );
    // walk override로 다른 멤버(임혜진 등)에 누적된 계약은 고객 노드(김중권)에 중복 표시하지 않는다.
    if (hasWalkOverride) continue;

    const customerKey = remapCustomerMemberId(
      c.customer_id,
      c.customers?.name ?? '',
      c.customers?.phone ?? null,
      c.customers?.birth_date ?? null,
    );
    if (customerKey && customerKey !== key) {
      // 정성훈 등: 고객 노드에는 현재 parent와 동일 담당자 계약만 표시
      if (splitBySalesParent) {
        const customerParentId = parentByChildId.get(customerKey) ?? null;
        if (customerParentId !== remapMemberId(c.sales_member_id)) continue;
      }
      if (!contractsByMember[customerKey]) contractsByMember[customerKey] = [];
      contractsByMember[customerKey].push(contractItem);
    }
  }

  // 조직도(OrgTree)와 동일한 숨김·승격 후 평탄 노드 — 직급 배지·헤더 인원수 집계에 사용
  const orgTreeVisibleNodes = flattenOrgTreeNodes(stripOrgTreeNodesForDisplay(tree));
  const orgTreeVisibleCountExcludingHqRank = orgTreeVisibleNodes.filter((n) => n.rank !== '본사').length;

  const kpiRow = ((kpiRes.data ?? [])[0] ?? null) as
    | { total_join_units: number; period_join_units: number }
    | null;
  const totalJoinUnits = kpiRow?.total_join_units ?? 0;
  const periodJoinUnits = kpiRow?.period_join_units ?? 0;

  // 이번달(정산 윈도우) 준비+대기 구좌 수 — join_date는 문자열/ISO/Date 혼재에 대비해 서울 YYYY-MM-DD로 맞춘 뒤 비교
  const periodPendingUnits = rawContractRows
    .filter((c) => contractJoinYmdInInclusiveWindow(c.join_date, start_date, end_date))
    .filter((c) => !c.is_cancelled)
    .filter((c) => String(c.status ?? '').trim() !== '해약')
    .filter((c) => {
      // 조직도 계약 리스트와 동일하게 "렌탈 미충족" 표시 상태는 제외
      const displayStatus = getContractDisplayStatus({
        status: c.status,
        rental_request_no: c.rental_request_no ?? null,
        invoice_no: c.invoice_no ?? null,
        memo: c.memo ?? null,
      });
      if (displayStatus === '렌탈 미충족') return false;
      const st = String(c.status ?? '').trim();
      return st === '준비' || st === '대기';
    })
    .reduce((sum, c) => sum + (c.unit_count ?? 0), 0);

  const { totalHqRevenue: totalSales, periodHqRevenue: periodSales } = sumHqRevenueForContracts(
    rawContractRows.map((c) => ({
      status: c.status,
      is_cancelled: c.is_cancelled,
      sales_member_id: c.sales_member_id,
      sales_link_status: c.sales_link_status,
      rental_request_no: c.rental_request_no,
      invoice_no: c.invoice_no,
      join_date: c.join_date,
      happy_call_at: c.happy_call_at ?? null,
      happycall_result: c.happycall_result ?? null,
      unit_count: c.unit_count,
      product_type: c.product_type ?? null,
      item_name: c.item_name ?? null,
      source_snapshot_json: (c.source_snapshot_json ?? null) as Record<string, string | null> | null,
    })),
    {
      periodStart: start_date,
      periodEnd: end_date,
      eligibility: 'kpi',
      periodDateField: 'happy_call_at',
      unitPriceDateField: 'happy_call_at',
    },
  );

  // 직급별 카운트: DB 전체가 아니라 조직도에 실제로 그려지는 노드(가상 본사 루트 제외, strip 반영)
  const rankCounts = orgTreeVisibleNodes.reduce<Record<string, number>>((acc, m) => {
    acc[m.rank] = (acc[m.rank] ?? 0) + 1;
    return acc;
  }, {});
  // UI 규칙: 본사는 최상단 1개로만 표시(클라이언트의 __hq_root__ 본사 1칸에 대응)
  if ((rankCounts['본사'] ?? 0) > 0) rankCounts['본사'] = 1;
  else if (tree.length > 0) rankCounts['본사'] = 1;

  const statusLabel: Record<string, string> = {
    completed: '완료',
    failed: '실패',
    running: '진행 중',
  };

  const [basisYear, basisMonth] = label_year_month.split('-');
  const rankDisplayOrder = ['본사', '사업본부장', '센터장', '리더', '영업사원'];
  const rankSummaryParts = [...rankDisplayOrder, ...Object.keys(rankCounts).filter((r) => !rankDisplayOrder.includes(r))]
    .filter((r) => (rankCounts[r] ?? 0) > 0)
    .map((r) => `${r} ${rankCounts[r]}`);

  return (
    <div className="p-3 sm:p-6">
      {/* Hero: 제목·기준 기간·핵심 수치 */}
      <section className="mb-3 overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm ring-1 ring-slate-900/[0.035] sm:mb-4">
        <div className="border-b border-orange-100/80 bg-gradient-to-r from-orange-50/90 via-white to-slate-50/90 px-3 py-3 sm:px-4 sm:py-3.5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-orange-700/85">관리자</p>
              <h1 className="text-lg font-bold tracking-tight text-slate-900 sm:text-xl">조직도</h1>
              <p className="mt-1 text-[11px] leading-snug text-slate-600 sm:text-xs">
                <span className="font-medium text-orange-900/90">{basisYear}년</span>{' '}
                <span className="font-medium text-orange-900/90">{basisMonth}월</span>
                <span className="text-slate-400"> · </span>
                <span className="tabular-nums text-slate-500">
                  {displayWindow.start_date} ~ {displayWindow.end_date}
                </span>
              </p>
            </div>
            <div className="flex shrink-0 gap-4 sm:gap-6">
              <div className="text-right">
                <p className="text-2xl font-bold tabular-nums leading-none text-slate-900 sm:text-3xl">
                  {orgTreeVisibleCountExcludingHqRank.toLocaleString('ko-KR')}
                </p>
                <p className="mt-0.5 text-[10px] font-medium text-slate-500 sm:text-[11px]">전체 인원</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold tabular-nums leading-none text-orange-600 sm:text-3xl">
                  {contractCount.toLocaleString('ko-KR')}
                </p>
                <p className="mt-0.5 text-[10px] font-medium text-slate-500 sm:text-[11px]">계약 수</p>
              </div>
            </div>
          </div>
        </div>

        {/* 동기화: 보조 버튼 + 한 줄 상태 */}
        <div className="flex flex-col gap-2 border-b border-slate-100/90 bg-slate-50/50 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-4">
          <SyncButton />
          {lastSync ? (
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-600 sm:justify-end">
              <span className="truncate text-slate-700">
                최근 동기화
                <span className="text-slate-400"> · </span>
                {formatSyncBarTime(lastSync.finished_at ?? lastSync.started_at)}
                {lastSync.status !== 'completed' && (
                  <>
                    <span className="text-slate-400"> · </span>
                    <span className="font-medium text-amber-800">
                      {statusLabel[lastSync.status] ?? lastSync.status}
                    </span>
                  </>
                )}
                {lastSync.total_updated != null && (
                  <>
                    <span className="text-slate-400"> · </span>
                    <span className="tabular-nums">{lastSync.total_updated.toLocaleString('ko-KR')}건 갱신</span>
                  </>
                )}
                {lastSync.total_fetched != null && (
                  <>
                    <span className="text-slate-400"> · </span>
                    <span className="tabular-nums">조회 {lastSync.total_fetched.toLocaleString('ko-KR')}</span>
                  </>
                )}
                {(lastSync.total_errors ?? 0) > 0 && (
                  <>
                    <span className="text-slate-400"> · </span>
                    <span className="font-medium text-red-600">오류 {lastSync.total_errors}</span>
                  </>
                )}
              </span>
              {lastSync.status === 'completed' && (
                <span className="inline-flex shrink-0 items-center rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800 ring-1 ring-emerald-200/80">
                  완료
                </span>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-amber-800 sm:text-right">동기화 기록이 없습니다. TY Life 동기화를 실행해 주세요.</p>
          )}
        </div>
      </section>

      {/* 기준월 선택: /organization 과 유사한 카드 + 컴팩트 툴바 */}
      <section className="mb-3 overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-3 shadow-sm ring-1 ring-slate-900/[0.035] sm:mb-4 sm:p-4">
        <div className="mb-2.5 flex flex-col gap-0.5 border-b border-slate-100 pb-2.5 sm:flex-row sm:items-baseline sm:justify-between">
          <p className="text-[13px] font-semibold tabular-nums text-slate-800 sm:text-sm">
            <span className="text-orange-800">{basisYear}년</span> <span className="text-orange-800">{basisMonth}월</span>{' '}
            기준
          </p>
          <p className="text-[10px] text-slate-500 sm:text-xs">월별 정산 구간에 맞춰 지표를 불러옵니다.</p>
        </div>
        <YearMonthSelector
          layout="compact-toolbar"
          className="min-w-0"
          value={label_year_month}
          todayValue={defaultYearMonth}
          years={yearsForPicker}
          todayLabel="오늘 기준월"
        />
      </section>

      {/* 직급 구성 + 실적: 한 카드 안에서 모바일 압축 */}
      <section className="mb-3 overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-3 shadow-sm ring-1 ring-slate-900/[0.035] sm:mb-4 sm:p-4">
        <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-orange-100/90 bg-orange-50/40 px-2.5 py-2 text-[11px] text-slate-800 sm:text-xs">
          <span className="font-semibold text-orange-900/90">구성</span>
          <span className="text-slate-400">|</span>
          <span className="tabular-nums text-slate-700">
            {rankSummaryParts.length > 0 ? rankSummaryParts.join(' · ') : '—'}
          </span>
        </div>

        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-orange-800/90">실적</p>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 sm:gap-2">
          <div
            className="flex min-h-0 flex-col rounded-xl border border-slate-200/85 bg-gradient-to-b from-white to-slate-50/80 px-2 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.06)] sm:px-2.5 sm:py-2.5"
            title={`기준 ${label_year_month} (${displayWindow.start_date}~${displayWindow.end_date})`}
          >
            <p className="text-[10px] font-medium leading-tight text-slate-500 sm:text-[11px]">이번달 준비</p>
            <p className="mt-1 text-lg font-semibold tabular-nums tracking-tight text-slate-900 sm:text-xl">
              {periodPendingUnits.toLocaleString('ko-KR')}
              <span className="ml-0.5 text-[11px] font-semibold text-slate-500 sm:text-xs">구좌</span>
            </p>
          </div>
          <div
            className="flex min-h-0 flex-col rounded-xl border border-slate-200/85 bg-gradient-to-b from-white to-slate-50/80 px-2 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.06)] sm:px-2.5 sm:py-2.5"
            title={`기준 ${label_year_month} (${displayWindow.start_date}~${displayWindow.end_date})`}
          >
            <p className="text-[10px] font-medium leading-tight text-slate-500 sm:text-[11px]">이번달 가입</p>
            <p className="mt-1 text-lg font-semibold tabular-nums tracking-tight text-slate-900 sm:text-xl">
              {periodJoinUnits.toLocaleString('ko-KR')}
              <span className="ml-0.5 text-[11px] font-semibold text-slate-500 sm:text-xs">구좌</span>
            </p>
          </div>
          <div className="flex min-h-0 flex-col rounded-xl border border-slate-200/85 bg-gradient-to-b from-white to-slate-50/80 px-2 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.06)] sm:px-2.5 sm:py-2.5">
            <p className="text-[10px] font-medium leading-tight text-slate-500 sm:text-[11px]">누적 가입</p>
            <p className="mt-1 text-lg font-semibold tabular-nums tracking-tight text-slate-900 sm:text-xl">
              {totalJoinUnits.toLocaleString('ko-KR')}
              <span className="ml-0.5 text-[11px] font-semibold text-slate-500 sm:text-xs">구좌</span>
            </p>
          </div>
          <div
            className="flex min-h-0 flex-col rounded-xl border border-slate-200/85 bg-gradient-to-b from-white to-orange-50/30 px-2 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.06)] ring-1 ring-orange-100/60 sm:px-2.5 sm:py-2.5"
            title={formatWon(totalSales)}
          >
            <p className="text-[10px] font-medium leading-tight text-orange-900/80 sm:text-[11px]">총 매출</p>
            <p className="mt-1 text-lg font-semibold tabular-nums tracking-tight text-orange-950 sm:hidden">
              {formatWonShort(totalSales)}
            </p>
            <p className="mt-1 hidden text-lg font-semibold tabular-nums tracking-tight text-orange-950 sm:block sm:text-xl">
              {formatWon(totalSales)}
            </p>
          </div>
          <div
            className="col-span-2 flex min-h-0 flex-col rounded-xl border border-slate-200/85 bg-gradient-to-b from-white to-orange-50/25 px-2 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.06)] ring-1 ring-orange-100/50 sm:col-span-1 sm:px-2.5 sm:py-2.5"
            title={`${formatWon(periodSales)} · ${label_year_month}`}
          >
            <p className="text-[10px] font-medium leading-tight text-orange-900/80 sm:text-[11px]">이번달 매출</p>
            <p className="mt-1 text-lg font-semibold tabular-nums tracking-tight text-orange-950 sm:hidden">
              {formatWonShort(periodSales)}
            </p>
            <p className="mt-1 hidden text-lg font-semibold tabular-nums tracking-tight text-orange-950 sm:block sm:text-xl">
              {formatWon(periodSales)}
            </p>
          </div>
        </div>
      </section>

      {/* 조직 트리 */}
      <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-3 shadow-sm ring-1 ring-slate-900/[0.035] sm:p-4">
        {members.length > 0 && tree.length === 0 && (
          <p className="text-xs text-amber-600 mb-4 text-center">
            {members.length}명이 있지만 조직 계층 연결(edges)이 없습니다. 상하위 관계를 등록하면 트리로 표시됩니다.
          </p>
        )}
        <AdminOrgTreeWithMetrics
          yearMonth={label_year_month}
          roots={tree}
          contractsByMember={contractsByMember}
          goalUnitsByMemberId={(() => {
            const out: Record<string, number> = {};
            for (const m of members as Array<{ id: string; monthly_target_units?: number | null }>) {
              const v = (m as any).monthly_target_units;
              if (typeof v === 'number' && Number.isInteger(v) && v > 0) out[m.id] = v;
            }
            return out;
          })()}
          showGoalUnitsLine={true}
          showGoalProgressBar={true}
          showCommissionMetrics={false}
        />
      </div>

      <SettlementSalesMemberOverridePanel />
    </div>
  );
}
