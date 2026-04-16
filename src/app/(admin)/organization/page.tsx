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
      .limit(20000),
    db.rpc('get_organization_kpis', { p_start_date: start_date, p_end_date: end_date }),
    db.from('settlement_rules').select('*'),
  ]);

  // 안성준은 TY Life 시스템상 영업사원이지만 실제로는 본사(최상위)로 취급
  const membersRaw = ((membersRes.data ?? []) as OrganizationMember[]).map((m) =>
    m.name === '안성준' ? { ...m, rank: '본사' as const } : m,
  );
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

  // ── 고객 노드(customer:*)와 실제 영업사원 노드 병합(표시/집계용) ──
  // 같은 사람(이름+전화)이 customer 노드와 직원 노드로 동시에 존재하면,
  // 조직도에서는 하나의 노드로 합쳐 보여주기 위해 customer 노드를 직원 노드로 병합한다.
  const toPhoneDigits = (v: string | null | undefined): string => (v ?? '').replace(/\D/g, '');
  const normName = (v: string | null | undefined): string => (v ?? '').replace(/^\[고객\]\s*/, '').trim();

  const employeesByKey = new Map<string, string>(); // name|phone -> memberId (non-customer)
  const employeesByName = new Map<string, { id: string; count: number; hasPhone: boolean }>(); // normalized name -> {id, count, hasPhone}
  const customerMergeTo = new Map<string, string>(); // customerMemberId -> employeeMemberId
  const customerIdToEffectiveMemberId = new Map<string, string>(); // customer:{customer_id} -> (customerMemberId or merged employeeMemberId)
  const hqIdsRaw = new Set(
    (membersRaw as any[])
      .filter((m) => (m as any).name === '안성준' || (m as any).rank === '본사')
      .map((m) => (m as any).id as string),
  );

  // debug(서버): 병합/트리 단계별 카운트
  let dbg_customerNodes_raw = 0;
  let dbg_customerNodes_afterMerge = 0;
  let dbg_customerNodes_childOfHq = 0;
  let dbg_customerNodes_inTree = 0;

  for (const m of membersRaw as any[]) {
    const ext = (m as { external_id?: string | null }).external_id ?? null;
    if (ext?.startsWith('customer:')) dbg_customerNodes_raw += 1;
    const nName = normName((m as any).name);
    const digits = toPhoneDigits((m as any).phone);
    const key = `${nName}|${digits}`;
    const isCustomerNode = ext?.startsWith('customer:') ?? false;
    if (!isCustomerNode && toPhoneDigits((m as any).phone)) {
      // 직원 노드 우선 등록
      if (!employeesByKey.has(key)) employeesByKey.set(key, (m as { id: string }).id);
    }
    if (!isCustomerNode) {
      const cur = employeesByName.get(nName);
      const hasPhone = digits !== '';
      if (!cur) employeesByName.set(nName, { id: (m as { id: string }).id, count: 1, hasPhone });
      else employeesByName.set(nName, { id: cur.id, count: cur.count + 1, hasPhone: cur.hasPhone || hasPhone });
    }
  }

  for (const m of membersRaw as any[]) {
    const ext = (m as { external_id?: string | null }).external_id ?? null;
    const isCustomerNode = ext?.startsWith('customer:') ?? false;
    if (!isCustomerNode) continue;
    const digits = toPhoneDigits((m as any).phone);
    const nName = normName((m as any).name);
    if (digits) {
      const key = `${nName}|${digits}`;
      const employeeId = employeesByKey.get(key);
      if (employeeId) {
        customerMergeTo.set((m as { id: string }).id, employeeId);
        continue;
      }
    }
    // 병합 폴백(요청 반영):
    // - 직원 phone이 null이라도, "같은 이름 직원 노드가 정확히 1개"이고
    // - customer 노드에는 phone이 있고(=식별 근거 존재)
    // 일 때만 customer 노드를 그 직원 노드로 병합한다.
    const byName = employeesByName.get(nName);
    if (byName && byName.count === 1 && !byName.hasPhone && digits) {
      customerMergeTo.set((m as { id: string }).id, byName.id);
    }
  }

  const remapMemberId = (id: string): string => customerMergeTo.get(id) ?? id;

  // customer:{customer_id} 외부키 기반 매핑은 "병합 결과"까지 반영해야 한다.
  // (customer 노드가 직원 노드로 병합되어 members에서 제외돼도, 계약 origin 치환이 가능해야 함)
  for (const m of membersRaw as any[]) {
    const ext = (m as { external_id?: string | null }).external_id ?? null;
    if (!ext || !ext.startsWith('customer:')) continue;
    const customerId = ext.slice('customer:'.length);
    customerIdToEffectiveMemberId.set(customerId, remapMemberId((m as { id: string }).id));
  }

  const members = membersRaw.filter((m: any) => !customerMergeTo.has((m as { id: string }).id));
  dbg_customerNodes_afterMerge = (members as any[]).filter((m) => ((m as any).external_id ?? '').startsWith('customer:')).length;
  const memberIdSet = new Set((members as any[]).map((m) => (m as { id: string }).id));
  const edges = (edgesRaw as any[]).map((e) => ({
    parent_id: (e as any).parent_id ? remapMemberId((e as any).parent_id) : null,
    child_id: remapMemberId((e as any).child_id),
  }));

  // child_id UNIQUE 성격 유지: remap으로 중복된 child가 생기면 "더 적절한 parent"를 선택
  // - 본사(hq) 아래로 붙는 edge가 있으면 그걸 우선
  // - 그 외에는 parent_id가 null이 아닌 것을 우선
  const bestByChild = new Map<string, { parent_id: string | null; child_id: string }>();
  const isBetter = (
    next: { parent_id: string | null; child_id: string },
    prev: { parent_id: string | null; child_id: string },
  ): boolean => {
    const nextIsHq = next.parent_id != null && hqIdsRaw.has(next.parent_id);
    const prevIsHq = prev.parent_id != null && hqIdsRaw.has(prev.parent_id);
    if (nextIsHq !== prevIsHq) return nextIsHq;
    if ((next.parent_id != null) !== (prev.parent_id != null)) return next.parent_id != null;
    return false;
  };

  for (const e of edges as any[]) {
    // remap 이후 parent가 존재하지 않으면(병합/삭제로 유실) 루트로 승격
    const parent_id = e.parent_id && memberIdSet.has(e.parent_id) ? e.parent_id : null;
    const child_id = e.child_id as string;
    if (!memberIdSet.has(child_id)) continue;

    const next = { parent_id, child_id };
    const prev = bestByChild.get(child_id);
    if (!prev || isBetter(next, prev)) bestByChild.set(child_id, next);
  }

  const dedupedEdges = [...bestByChild.values()];

  // 본사(hq) 직속 customer 노드 수(트리 구성 전)
  dbg_customerNodes_childOfHq = dedupedEdges.filter(
    (e) =>
      e.parent_id != null &&
      hqIdsRaw.has(e.parent_id) &&
      ((membersRaw.find((m: any) => (m as any).id === e.child_id)?.external_id ?? '') as string).startsWith('customer:'),
  ).length;

  const edgeMap = new Map<string, string | null>();
  for (const e of dedupedEdges) {
    edgeMap.set(
      (e as { child_id: string }).child_id,
      (e as { parent_id: string | null }).parent_id,
    );
  }

  const treeRows: OrgTreeRow[] = members.map((m: any) => ({
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
  // customer:{customer_id} 노드가 생성/연결되므로, 여기서는 그 노드로 origin을 치환한다.
  const hqIds = new Set(
    (members as any[])
      .filter((m) => m.name === '안성준' || m.rank === '본사')
      .map((m) => m.id),
  );
  const hqId = members.find((m) => m.name === '안성준')?.id ?? (hqIds.values().next().value ?? null);
  let dbg_hqEligibleTotal = 0;
  let dbg_hqEligibleMapped = 0;
  let dbg_hqEligibleMissing = 0;
  const dbg_sampleMissing: Array<{ contract_code: string; customer_id: string; customer_name: string; customer_phone: string | null }> = [];
  const customerNodeByCustomerId = new Map<string, string>(); // external_id = customer:{customer_id}
  const nodeIdByPhoneDigits = new Map<string, string>(); // phone digits -> member id

  for (const m of members as any[]) {
    const ext = (m as { external_id?: string | null }).external_id ?? null;
    if (ext && ext.startsWith('customer:')) {
      const customerId = ext.slice('customer:'.length);
      customerNodeByCustomerId.set(customerId, (m as { id: string }).id);
    }
    const digits = toPhoneDigits((m as { phone?: string | null }).phone ?? null);
    if (digits) nodeIdByPhoneDigits.set(digits, (m as { id: string }).id);
  }

  const findCustomerNodeId = (c: { customer_id: string; customer_phone: string | null }): string | null => {
    // (1) external_id == customer:{customer_id} (SSOT) — 병합 결과(직원 노드)까지 포함
    const byExt = customerIdToEffectiveMemberId.get(c.customer_id) ?? customerNodeByCustomerId.get(c.customer_id);
    if (byExt) return byExt;
    // (2) fallback: phone match (과거 데이터/임시 노드 보정용)
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
    const key = remapMemberId(mapSalesMemberForOrg({
      sales_member_id: c.sales_member_id,
      customer_id: c.customer_id,
      status: c.status,
      rental_request_no: c.rental_request_no ?? null,
      invoice_no: c.invoice_no ?? null,
      memo: c.memo ?? null,
      customer_phone: c.customers?.phone ?? null,
      contract_code: c.contract_code,
      customer_name: c.customers?.name ?? '',
    }));
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
  // buildOrgTree 결과에 customer 노드가 실제로 남아있는지
  const flatten = (nodes: any[]): any[] => nodes.flatMap((n) => [n, ...(n.children ? flatten(n.children) : [])]);
  dbg_customerNodes_inTree = flatten(tree).filter((n) => ((membersRaw.find((m: any) => (m as any).id === n.id)?.external_id ?? '') as string).startsWith('customer:')).length;

  /** 조직 노드 구좌·수당: get_organization_kpis 와 동일한 가입 인정 기준 */
  const kpiEligibleForMetrics = rawContractRows
    .filter(isSettlementEligibleContract)
    .map((c) => ({
      contract_id: c.id,
      join_date: c.join_date ?? '',
      unit_count: c.unit_count ?? 0,
      status: c.status,
      sales_member_id: remapMemberId(mapSalesMemberForOrg({
        sales_member_id: c.sales_member_id,
        customer_id: c.customer_id,
        status: c.status,
        rental_request_no: c.rental_request_no ?? null,
        invoice_no: c.invoice_no ?? null,
        memo: c.memo ?? null,
        customer_phone: c.customers?.phone ?? null,
        contract_code: c.contract_code,
        customer_name: c.customers?.name ?? '',
      })),
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
                  customerNodesRaw: dbg_customerNodes_raw,
                  customerNodesAfterMerge: dbg_customerNodes_afterMerge,
                  customerNodesChildOfHq: dbg_customerNodes_childOfHq,
                  customerNodesInTree: dbg_customerNodes_inTree,
                }
              : { enabled: false, hqId, hqEligibleTotal: 0, hqEligibleMappedToCustomerNode: 0, hqEligibleMissingCustomerNode: 0 }
          }
        />
      </div>
    </div>
  );
}
