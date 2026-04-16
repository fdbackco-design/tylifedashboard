import type { Metadata } from 'next';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { buildOrgTree } from '@/lib/settlement/calculator';
import { BASE_AMOUNT_PER_UNIT } from '@/lib/settlement/constants';
import { getSettlementWindowSeoul } from '@/lib/settlement/settlement-window';
import { calculateOrgNodeMetrics } from '@/lib/settlement/org-node-metrics';
import { isSettlementEligibleContract } from '@/lib/settlement/settlement-eligibility';
import { isContractJoinCompleted } from '@/lib/utils/contract-display-status';
import OrgTree from '@/components/org-tree/OrgTree';
import type { ContractItem } from '@/components/org-tree/OrgTreeNode';
import type { OrgTreeRow, OrganizationMember } from '@/lib/types';
import SyncButton from './SyncButton';

export const metadata: Metadata = { title: '조직도' };
export const dynamic = 'force-dynamic';

function formatDuration(startedAt: string, finishedAt: string | null): string {
  if (!finishedAt) return '진행 중';
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}초` : `${ms}ms`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatWon(value: number): string {
  return `${Math.round(value).toLocaleString('ko-KR')}원`;
}

export default async function OrganizationPage({
  searchParams,
}: {
  searchParams?: Promise<{ debug?: string }>;
}) {
  try {
    const sp = (await searchParams) ?? {};
    const debugEnabled = sp.debug === '1';
    const db = createAdminSupabaseClient();

    const { start_date, end_date, label_year_month } = getSettlementWindowSeoul();

  const [membersRes, edgesRes, contractCountRes, lastSyncRes, contractsRes, kpiRes, rulesRes] =
    await Promise.all([
    db
      .from('organization_members')
      .select('id, name, rank, external_id, phone')
      .eq('is_active', true)
      .order('name'),
    db.from('organization_edges').select('parent_id, child_id'),
    // exact는 커질수록 매우 느릴 수 있어 estimated로 전환
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
        'id, contract_code, join_date, product_type, item_name, rental_request_no, invoice_no, memo, status, unit_count, customer_id, sales_member_id, is_cancelled, sales_link_status, customers(name, phone)',
      )
      .not('sales_member_id', 'is', null)
      .order('join_date', { ascending: false })
      // 서버 렌더 타임아웃 방지: 최근 계약만 로드 (필요시 노드 클릭 시 추가 로딩으로 확장)
      .limit(20000),
    db.rpc('get_organization_kpis', { p_start_date: start_date, p_end_date: end_date }),
    db.from('settlement_rules').select('*'),
  ]);

  // 안성준은 TY Life 시스템상 영업사원이지만 실제로는 본사(최상위)로 취급
  const members = ((membersRes.data ?? []) as OrganizationMember[]).map((m) =>
    m.name === '안성준' ? { ...m, rank: '본사' as const } : m,
  );
  const edges = edgesRes.data ?? [];
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

  const edgeMap = new Map<string, string | null>();
  for (const e of edges) {
    edgeMap.set(
      (e as { child_id: string }).child_id,
      (e as { parent_id: string | null }).parent_id,
    );
  }

  const treeRows: OrgTreeRow[] = members.map((m) => ({
    id: m.id,
    name: m.name,
    rank: m.rank,
    parent_id: edgeMap.get(m.id) ?? null,
    depth: 0,
  }));

  // 계약 데이터 → 멤버별 맵 (표시용: 담당자 있는 전체 계약)
  const contractsByMember: Record<string, ContractItem[]> = {};
  const rawContractRows = (contractsRes.data ?? []) as unknown as Array<{
    id: string;
    contract_code: string;
    join_date: string | null;
    product_type: string | null;
    item_name?: string | null;
    rental_request_no?: string | null;
    invoice_no?: string | null;
    memo?: string | null;
    status: string;
    unit_count: number | null;
    customer_id: string;
    sales_member_id: string;
    is_cancelled?: boolean | null;
    sales_link_status?: string | null;
    customers: { name: string; phone: string | null } | null;
  }>;

  // 예외 규칙(최종):
  // "안성준(본사) 담당 + 가입 인정 기준" 계약은 동기화 단계에서
  // 고객을 영업사원 노드로 편입(동명이인 불허)하고 본사 아래로 연결하므로,
  // 여기서는 가능한 경우 고객 노드로 origin을 치환한다.
  const hqIds = new Set(
    members
      .filter((m) => m.name === '안성준' || m.rank === '본사')
      .map((m) => m.id),
  );
  const hqId = members.find((m) => m.name === '안성준')?.id ?? (hqIds.values().next().value ?? null);
  let dbg_hqEligibleTotal = 0;
  let dbg_hqEligibleMapped = 0;
  let dbg_hqEligibleMissing = 0;
  const dbg_sampleMissing: Array<{ contract_code: string; customer_id: string; customer_name: string; customer_phone: string | null }> = [];
  const nodeIdByPhoneDigits = new Map<string, string>(); // phone digits -> member id

  const toPhoneDigits = (v: string | null | undefined): string => (v ?? '').replace(/\D/g, '');

  for (const m of members as any[]) {
    const digits = toPhoneDigits((m as { phone?: string | null }).phone ?? null);
    if (digits) nodeIdByPhoneDigits.set(digits, (m as { id: string }).id);
  }

  const findCustomerNodeId = (c: { customer_id: string; customer_phone: string | null }): string | null => {
    // phone match (현 시점 최선의 보조식별)
    const digits = toPhoneDigits(c.customer_phone);
    if (digits) {
      const byPhone = nodeIdByPhoneDigits.get(digits);
      if (byPhone) return byPhone;
    }
    return null;
  };

  const mapSalesMemberForOrg = (c: {
    sales_member_id: string;
    customer_id: string;
    status: string;
    rental_request_no?: string | null;
    invoice_no?: string | null;
    memo?: string | null;
    customer_phone: string | null;
    contract_code?: string | null;
    customer_name?: string | null;
  }): string => {
    // 동기화 타이밍/원본 상태 문자열 때문에 status가 '가입'으로 안 찍히는 경우가 있어도,
    // “가입 인정 기준(해약 아님 + 송장/렌탈 존재)”이면 가입으로 간주해서 예외를 항상 적용한다.
    const joinEligible = isContractJoinCompleted({
      status: c.status,
      rental_request_no: c.rental_request_no ?? null,
      invoice_no: c.invoice_no ?? null,
      memo: c.memo ?? null,
    });

    if (hqIds.size > 0 && hqIds.has(c.sales_member_id) && joinEligible) {
      dbg_hqEligibleTotal += 1;
      const customerNodeId = findCustomerNodeId({ customer_id: c.customer_id, customer_phone: c.customer_phone });
      if (customerNodeId) {
        dbg_hqEligibleMapped += 1;
        return customerNodeId;
      }
      dbg_hqEligibleMissing += 1;
      if (dbg_sampleMissing.length < 5) {
        dbg_sampleMissing.push({
          contract_code: c.contract_code ?? '(unknown)',
          customer_id: c.customer_id,
          customer_name: c.customer_name ?? '',
          customer_phone: c.customer_phone,
        });
      }
    }
    return c.sales_member_id;
  };

  for (const c of rawContractRows) {
    const key = mapSalesMemberForOrg({
      sales_member_id: c.sales_member_id,
      customer_id: c.customer_id,
      status: c.status,
      rental_request_no: c.rental_request_no ?? null,
      invoice_no: c.invoice_no ?? null,
      memo: c.memo ?? null,
      customer_phone: c.customers?.phone ?? null,
      contract_code: c.contract_code,
      customer_name: c.customers?.name ?? '',
    });
    if (!contractsByMember[key]) contractsByMember[key] = [];
    contractsByMember[key].push({
      id: c.id,
      contract_code: c.contract_code,
      join_date: c.join_date,
      product_type: c.product_type,
      item_name: c.item_name ?? null,
      rental_request_no: c.rental_request_no ?? null,
      invoice_no: c.invoice_no ?? null,
      memo: c.memo ?? null,
      status: c.status,
      unit_count: c.unit_count,
      customer_name: c.customers?.name ?? '',
    });
  }

  const tree = buildOrgTree(treeRows);

  /** 조직 노드 구좌·수당: get_organization_kpis 와 동일한 가입 인정 기준 */
  const kpiEligibleForMetrics = rawContractRows
    .filter(isSettlementEligibleContract)
    .map((c) => ({
      contract_id: c.id,
      join_date: c.join_date ?? '',
      unit_count: c.unit_count ?? 0,
      status: c.status,
      sales_member_id: mapSalesMemberForOrg({
        sales_member_id: c.sales_member_id,
        customer_id: c.customer_id,
        status: c.status,
        rental_request_no: c.rental_request_no ?? null,
        invoice_no: c.invoice_no ?? null,
        memo: c.memo ?? null,
        customer_phone: c.customers?.phone ?? null,
        contract_code: c.contract_code,
        customer_name: c.customers?.name ?? '',
      }),
    }));

  const orgMetricsById = calculateOrgNodeMetrics({
    roots: tree,
    members,
    edges: (edgesRes.data ?? []) as { parent_id: string | null; child_id: string }[],
    contracts: kpiEligibleForMetrics,
    rules: (rulesRes.data ?? []) as any[],
    settlementWindow: { start_date, end_date, label_year_month },
  });

  const kpiRow = ((kpiRes.data ?? [])[0] ?? null) as
    | { total_join_units: number; period_join_units: number }
    | null;
  const totalJoinUnits = kpiRow?.total_join_units ?? 0;
  const periodJoinUnits = kpiRow?.period_join_units ?? 0;
  const totalSales = totalJoinUnits * BASE_AMOUNT_PER_UNIT;
  const periodSales = periodJoinUnits * BASE_AMOUNT_PER_UNIT;

  // 직급별 카운트
  const rankCounts = members.reduce<Record<string, number>>((acc, m) => {
    acc[m.rank] = (acc[m.rank] ?? 0) + 1;
    return acc;
  }, {});
  // UI 규칙: 본사는 최상단 1개로만 표시
  if ((rankCounts['본사'] ?? 0) > 0) rankCounts['본사'] = 1;

  const statusColor: Record<string, string> = {
    completed: 'text-green-600',
    failed: 'text-red-500',
    running: 'text-yellow-600',
  };

  const statusLabel: Record<string, string> = {
    completed: '완료',
    failed: '실패',
    running: '진행 중',
  };

    return (
      <div className="p-6">
      {/* 헤더 + 동기화 버튼 */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">조직도</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            총 {members.length}명 · 계약 {contractCount.toLocaleString()}건 저장됨
          </p>
        </div>
        <SyncButton />
      </div>

      {/* 마지막 동기화 상태 */}
      {lastSync ? (
        <div className="mb-5 flex items-center gap-3 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5">
          <span className="font-medium text-gray-700">마지막 동기화</span>
          <span>{formatDateTime(lastSync.started_at)}</span>
          <span
            className={`font-semibold ${statusColor[lastSync.status] ?? 'text-gray-600'}`}
          >
            {statusLabel[lastSync.status] ?? lastSync.status}
          </span>
          {lastSync.finished_at && (
            <span>{formatDuration(lastSync.started_at, lastSync.finished_at)}</span>
          )}
          {lastSync.total_fetched != null && (
            <span>
              조회 {lastSync.total_fetched}건 · 신규 {lastSync.total_created ?? 0} · 갱신{' '}
              {lastSync.total_updated ?? 0}
              {(lastSync.total_errors ?? 0) > 0 && (
                <span className="text-red-500"> · 오류 {lastSync.total_errors}</span>
              )}
            </span>
          )}
        </div>
      ) : (
        <div className="mb-5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5">
          동기화 기록이 없습니다. 오른쪽 상단 버튼으로 TY Life 데이터를 가져오세요.
        </div>
      )}

      {/* 직급별 현황 */}
      <div className="mb-6 flex flex-col lg:flex-row lg:items-stretch gap-3">
        <div className="flex gap-3 flex-wrap">
          {Object.entries(rankCounts).map(([rank, count]) => (
            <div
              key={rank}
              className="bg-white border border-gray-200 rounded-lg px-4 py-2 text-sm shadow-sm"
            >
              <span className="text-gray-500">{rank}</span>
              <span className="ml-2 font-bold text-gray-800">{count}명</span>
            </div>
          ))}
        </div>

        {/* KPI (오른쪽) */}
        <div className="grid grid-cols-2 gap-3 w-full lg:w-auto lg:ml-auto">
          <div className="bg-white border border-gray-200 rounded-lg px-4 py-2 text-sm shadow-sm">
            <span className="text-gray-500">누적 가입 구좌 수</span>
            <span className="ml-2 font-bold text-gray-800">
              {totalJoinUnits.toLocaleString('ko-KR')}구좌
            </span>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg px-4 py-2 text-sm shadow-sm">
            <span className="text-gray-500">총 매출</span>
            <span className="ml-2 font-bold text-gray-800">{formatWon(totalSales)}</span>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg px-4 py-2 text-sm shadow-sm">
            <span className="text-gray-500">이번달 가입 구좌 수</span>
            <span className="ml-2 font-bold text-gray-800">
              {periodJoinUnits.toLocaleString('ko-KR')}구좌
            </span>
            <div className="text-[11px] text-gray-400 mt-0.5">
              기준 {label_year_month} · {start_date}~{end_date}
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg px-4 py-2 text-sm shadow-sm">
            <span className="text-gray-500">이번달 매출</span>
            <span className="ml-2 font-bold text-gray-800">{formatWon(periodSales)}</span>
            <div className="text-[11px] text-gray-400 mt-0.5">
              기준 {label_year_month}
            </div>
          </div>
        </div>
      </div>

      {/* 조직 트리 */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        {members.length > 0 && tree.length === 0 && (
          <p className="text-xs text-amber-600 mb-4 text-center">
            {members.length}명이 있지만 조직 계층 연결(edges)이 없습니다. 상하위 관계를 등록하면 트리로 표시됩니다.
          </p>
        )}
        <OrgTree
          roots={tree}
          contractsByMember={contractsByMember}
          metricsById={orgMetricsById}
          debug={
            debugEnabled
              ? {
                  enabled: true,
                  hqId,
                  hqEligibleTotal: dbg_hqEligibleTotal,
                  hqEligibleMappedToCustomerNode: dbg_hqEligibleMapped,
                  hqEligibleMissingCustomerNode: dbg_hqEligibleMissing,
                  sampleMissing: dbg_sampleMissing,
                }
              : { enabled: false, hqId, hqEligibleTotal: 0, hqEligibleMappedToCustomerNode: 0, hqEligibleMissingCustomerNode: 0 }
          }
        />
      </div>
      </div>
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[organization] render failed:', message);
    return (
      <div className="p-6">
        <h2 className="text-2xl font-bold text-gray-800">조직도</h2>
        <p className="mt-2 text-sm text-red-600">페이지 로드 실패: {message}</p>
        <p className="mt-1 text-xs text-gray-500">
          최근 변경으로 서버에서 예외가 발생했습니다. 위 메시지를 공유해주시면 바로 고치겠습니다.
        </p>
      </div>
    );
  }
}
