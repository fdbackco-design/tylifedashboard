import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { unstable_cache } from 'next/cache';
import OrgTree from '@/components/org-tree/OrgTree';
import YearMonthSelector from '@/components/YearMonthSelector';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';
import { buildOrgTree } from '@/lib/settlement/calculator';
import { collectSubtreeMemberIdsDownstream } from '@/lib/settlement/settlement-org-tree';
import {
  coalesceYearMonthSearchParam,
  contractJoinYmdInInclusiveWindow,
  getSettlementWindowForYearMonth,
  getSettlementWindowSeoul,
  normalizeYearMonthLabel,
} from '@/lib/settlement/settlement-window';
import { calculateOrgNodeMetrics } from '@/lib/settlement/org-node-metrics';
import { isSettlementEligibleContract } from '@/lib/settlement/settlement-eligibility';
import { getContractDisplayStatus } from '@/lib/utils/contract-display-status';
import type { OrgTreeRow } from '@/lib/types';
import type { SettlementRule } from '@/lib/types/settlement';
import {
  type ContractItem,
  collectSubtreeIds,
  countByStatus,
} from '@/lib/organization/org-tree-contract-counts';
import { buildChildrenByParentFromRows } from '@/lib/settlement/settlement-org-tree';
import AccountActionsClient from './AccountActionsClient';
import { stripOrgTreeNodesForDisplay } from '@/lib/organization/org-tree-display';
import { buildOrgContractSalesRemap } from '@/lib/organization/org-contract-sales-remap';

export const metadata: Metadata = { title: '내 조직도' };
export const dynamic = 'force-dynamic';

type OrgMemberRow = {
  id: string;
  name: string;
  rank: any;
  phone: string | null;
  external_id: string | null;
  source_customer_id: string | null;
  leader_rank_effective_at?: string | null;
};

const getCachedOrgSnapshot = unstable_cache(
  async (): Promise<{
    members: OrgMemberRow[];
    edges: Array<{ parent_id: string | null; child_id: string }>;
    rules: SettlementRule[];
  }> => {
    const db = createAdminSupabaseClient();
    const [membersRes, edgesRes, rulesRes] = await Promise.all([
      db
        .from('organization_members')
        .select('id,name,rank,phone,external_id,source_customer_id,leader_rank_effective_at'),
      db.from('organization_edges').select('parent_id,child_id'),
      db.from('settlement_rules').select('*'),
    ]);

    return {
      members: (membersRes.data ?? []) as OrgMemberRow[],
      edges: (edgesRes.data ?? []) as Array<{ parent_id: string | null; child_id: string }>,
      rules: (rulesRes.data ?? []) as SettlementRule[],
    };
  },
  ['org_snapshot_v1'],
  { revalidate: 60 },
);

export default async function OrganizationMyTreePage({
  searchParams,
}: {
  searchParams?: Promise<{ year_month?: string; debug?: string; debug_customer?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const debugEnabled = sp.debug === '1';
  const debugCustomerNeedle =
    typeof sp.debug_customer === 'string' ? sp.debug_customer.trim() : '';

  const defaultYearMonth = getSettlementWindowSeoul().label_year_month;
  const requestedYearMonthRaw =
    coalesceYearMonthSearchParam(sp.year_month as string | string[] | undefined) ?? defaultYearMonth;
  const yearMonth = normalizeYearMonthLabel(requestedYearMonthRaw) ?? defaultYearMonth;
  const { start_date, end_date, label_year_month } = getSettlementWindowForYearMonth(yearMonth);

  // user session은 anon+RLS 클라이언트로 읽어야 한다.
  const userDb = await createServerSupabaseClient();
  const {
    data: { user },
  } = await userDb.auth.getUser();

  // organization_members/edges 등은 현재 RLS 정책이 없어서 service_role로 읽는다.
  // 대신 subtree 필터링으로 범위를 엄격히 제한한다.
  const adminDb = createAdminSupabaseClient();

  if (!user) {
    redirect(`/login?redirect=${encodeURIComponent(`/organization?year_month=${yearMonth}`)}`);
  }

  const { data: profile, error: profileErr } = await userDb
    .from('user_profiles')
    .select('member_id,is_active')
    .eq('id', user.id)
    .maybeSingle();

  if (profileErr) {
    redirect(`/login?error=profile&redirect=${encodeURIComponent(`/organization?year_month=${yearMonth}`)}`);
  }

  const memberId = profile?.member_id as string | null;
  const debugStats: Record<string, unknown> = {
    debugEnabled,
    user_id: user?.id ?? null,
    profile_member_id: memberId,
    yearMonth,
    settlementWindow: { start_date, end_date, label_year_month },
  };

  if (!memberId) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-600">이 계정은 조직도에 연결된 권한(member_id)이 없습니다.</p>
        <Link className="text-sm text-blue-600 underline mt-2 inline-block" href="/login">
          로그인으로 돌아가기
        </Link>
      </div>
    );
  }

  const yearsForPicker = (() => {
    const base = parseInt(label_year_month.slice(0, 4), 10);
    // UX: 최근 5년 정도면 충분 (필요 시 늘리기)
    const out: number[] = [];
    for (let y = base; y >= base - 4; y--) out.push(y);
    return out;
  })();

  // 공통: 조직 구성(월 무관)은 캐시된 스냅샷 사용 → 월 변경 시 지연 감소
  const snapshot = await getCachedOrgSnapshot();

  const membersRaw = (snapshot.members ?? []).map((m) =>
    m.name === '안성준' ? { ...m, rank: '본사' as const } : m,
  ) as Array<{
    id: string;
    name: string;
    rank: any;
    phone: string | null;
    external_id: string | null;
    source_customer_id: string | null;
    leader_rank_effective_at?: string | null;
  }>;
  const edgesRaw = (snapshot.edges ?? []) as Array<{ parent_id: string | null; child_id: string }>;
  const rules = (snapshot.rules ?? []) as SettlementRule[];

  const {
    remapMemberId,
    remapCustomerMemberId,
    resolveContractOriginForSubtree,
    explainContractOriginForSubtree,
    hqIds: hqIdsForContracts,
    membersFiltered,
  } = buildOrgContractSalesRemap(membersRaw as any);
  const hqSalesMemberIds = [...hqIdsForContracts];

  /** 병합 필터 후에도 스냅샷 행과 동일 객체(leader_rank_effective_at 등 유지) */
  type MemberRow = (typeof membersRaw)[number];
  const membersForTree = membersFiltered as MemberRow[];

  // /admin/organization 과 동일: 병합된 customer 노드 id를 edge에서 직원 id로 치환
  const edgesRemapped = edgesRaw.map((e) => ({
    parent_id: e.parent_id ? remapMemberId(e.parent_id) : null,
    child_id: remapMemberId(e.child_id),
  }));
  const memberIdSetFiltered = new Set(membersFiltered.map((m) => m.id));

  debugStats.members_raw_count = membersRaw.length;
  debugStats.members_filtered_count = membersFiltered.length;
  debugStats.edges_raw_count = edgesRaw.length;

  // treeRows 기준으로 서브트리 계산 (병합 반영 멤버만 사용)
  const treeRowsBase: OrgTreeRow[] = membersForTree.map((m) => ({
    id: m.id,
    name: m.name,
    rank: m.rank,
    parent_id: m.rank === '본사' ? null : null,
    depth: 0,
  }));
  const edgeByChild = new Map<string, string | null>();
  for (const e of edgesRemapped) {
    const child_id = e.child_id;
    if (!memberIdSetFiltered.has(child_id)) continue;
    const parent_id =
      e.parent_id && memberIdSetFiltered.has(e.parent_id) ? e.parent_id : null;
    edgeByChild.set(child_id, parent_id);
  }

  const treeRows = treeRowsBase.map((r) => ({
    ...r,
    parent_id: r.rank === '본사' ? null : edgeByChild.get(r.id) ?? null,
  }));

  const childrenByParent = buildChildrenByParentFromRows(treeRows);
  const subtreeIds = collectSubtreeMemberIdsDownstream(memberId, childrenByParent);

  const subtreeMembers = membersForTree.filter((m) => subtreeIds.has(m.id));
  const subtreeIdSet = new Set(subtreeMembers.map((m) => m.id));
  debugStats.subtree_ids_count = subtreeIds.size;
  debugStats.subtree_members_count = subtreeMembers.length;

  // 계약은 subtree에 속한 sales_member_id만 조회(월 버튼 클릭 시 지연 감소)
  const subtreeMemberIds = [...subtreeIdSet.values()];
  const chunk = <T,>(arr: T[], size: number): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  };

  const { data: promoRows } = await adminDb
    .from('leader_promotion_events')
    .select('member_id, previous_parent_id, threshold_contract_id, threshold_join_date');

  const policyPromotedMemberIdSet = new Set((promoRows ?? []).map((r: { member_id: string }) => String(r.member_id)));
  const previousLeaderByPromotedMemberId = new Map<string, string | null>();
  for (const r of (promoRows ?? []) as { member_id: string; previous_parent_id?: string | null }[]) {
    previousLeaderByPromotedMemberId.set(String(r.member_id), (r.previous_parent_id ?? null) as string | null);
  }

  const thPromoContractIds = [
    ...new Set(
      (promoRows ?? [])
        .filter((r: any) => r?.threshold_contract_id && r?.threshold_join_date)
        .map((r: any) => String(r.threshold_contract_id)),
    ),
  ];
  const leaderPromotionThresholdContractCreatedAtById = new Map<string, string | null>();
  if (thPromoContractIds.length > 0) {
    const { data: thRows } = await adminDb.from('contracts').select('id, created_at').in('id', thPromoContractIds);
    for (const row of (thRows ?? []) as { id: string; created_at?: string | null }[]) {
      if (row?.id) {
        leaderPromotionThresholdContractCreatedAtById.set(String(row.id), (row.created_at ?? null) as string | null);
      }
    }
  }

  const contractSelect =
    'id, contract_code, join_date, product_type, item_name, rental_request_no, invoice_no, memo, status, unit_count, sales_member_id, customer_id, is_cancelled, sales_link_status, customers(name, phone), created_at';

  const contractChunks = chunk(subtreeMemberIds, 500);
  const contractResList = await Promise.all(
    contractChunks.map((ids) =>
      ids.length === 0
        ? Promise.resolve({ data: [] as any[] })
        : adminDb
            .from('contracts')
            .select(contractSelect)
            .in('sales_member_id', ids)
            .gte('join_date', start_date)
            .lte('join_date', end_date)
            .order('join_date', { ascending: false })
            .limit(20000),
    ),
  );

  let contractsRaw = contractResList.flatMap((r) => r.data ?? []);

  const hqWindowRemapInput = (row: any) =>
    ({
      sales_member_id: String(row.sales_member_id ?? ''),
      customer_id: String(row.customer_id ?? ''),
      status: row.status,
      rental_request_no: row.rental_request_no ?? null,
      invoice_no: row.invoice_no ?? null,
      memo: row.memo ?? null,
      customer_phone: row.customers?.phone ?? null,
      contract_code: row.contract_code ?? null,
      customer_name: row.customers?.name ?? null,
    }) as const;

  let hqWindowFetched = 0;
  let hqWindowIncluded = 0;
  let hqWindowDroppedSubtree = 0;
  const hqWindowDroppedSamples: Array<Record<string, unknown>> = [];

  if (hqSalesMemberIds.length > 0) {
    const { data: hqWindowRows } = await adminDb
      .from('contracts')
      .select(contractSelect)
      .in('sales_member_id', hqSalesMemberIds)
      .gte('join_date', start_date)
      .lte('join_date', end_date)
      .order('join_date', { ascending: false })
      .limit(20000);
    hqWindowFetched = (hqWindowRows ?? []).length;
    const seenWin = new Set(contractsRaw.map((c: any) => c.id as string));
    for (const row of (hqWindowRows ?? []) as any[]) {
      if (!row?.id || seenWin.has(row.id)) continue;
      const winInput = hqWindowRemapInput(row);
      const eff = resolveContractOriginForSubtree(winInput, subtreeIdSet);
      if (!subtreeIdSet.has(eff)) {
        hqWindowDroppedSubtree += 1;
        const name = String(row?.customers?.name ?? '');
        const matchNeedle =
          !debugCustomerNeedle ||
          name.includes(debugCustomerNeedle) ||
          String(row.customer_id ?? '').includes(debugCustomerNeedle);
        if (debugEnabled && matchNeedle && hqWindowDroppedSamples.length < 40) {
          hqWindowDroppedSamples.push({
            contract_id: row.id,
            join_date: row.join_date,
            customer_name: row.customers?.name ?? null,
            customer_id: row.customer_id,
            sales_member_id: row.sales_member_id,
            display_status: getContractDisplayStatus({
              status: row.status,
              rental_request_no: row.rental_request_no ?? null,
              invoice_no: row.invoice_no ?? null,
              memo: row.memo ?? null,
            }),
            explain: explainContractOriginForSubtree(winInput, subtreeIdSet),
          });
        }
        continue;
      }
      hqWindowIncluded += 1;
      seenWin.add(row.id);
      contractsRaw.push(row);
    }
  }

  if (debugEnabled) {
    debugStats.hq_sales_member_ids = hqSalesMemberIds;
    debugStats.hq_window_contracts = {
      fetched_row_count: hqWindowFetched,
      merged_into_subtree_count: hqWindowIncluded,
      dropped_subtree_filter_count: hqWindowDroppedSubtree,
      dropped_samples_needle: debugCustomerNeedle || null,
      dropped_samples: hqWindowDroppedSamples,
    };
  }

  // Supabase 필터 누락/비정상 응답이 있어도 카드·조직도 계약 목록은 정산 윈도우 밖을 제외
  contractsRaw = contractsRaw.filter((c: any) =>
    contractJoinYmdInInclusiveWindow(c.join_date, start_date, end_date),
  );

  // subtree parent는 “parent가 subtree 밖이면 root 처리(=parent null)”
  const subtreeTreeRows: OrgTreeRow[] = treeRows
    .filter((r) => subtreeIdSet.has(r.id))
    .map((r) => {
      const pid = r.parent_id ?? null;
      return { ...r, parent_id: pid && subtreeIdSet.has(pid) ? pid : null };
    });
  debugStats.subtree_tree_rows_count = subtreeTreeRows.length;

  const tree = buildOrgTree(subtreeTreeRows);
  // /organization에서는 최상단 본사(person) 노드는 숨기고, 자식들을 루트로 승격해서 보여준다.
  const treeForDisplay = stripOrgTreeNodesForDisplay(tree as any);
  debugStats.tree_roots_count = tree.length;
  debugStats.tree_root_ids = tree.map((r: any) => r.id);

  const contractRemapInput = (c: any) => ({
    sales_member_id: String(c.sales_member_id ?? ''),
    customer_id: String(c.customer_id ?? ''),
    status: c.status as string,
    rental_request_no: (c.rental_request_no ?? null) as string | null,
    invoice_no: (c.invoice_no ?? null) as string | null,
    memo: (c.memo ?? null) as string | null,
    customer_phone: (c.customers?.phone ?? null) as string | null,
    contract_code: (c.contract_code ?? null) as string | null,
    customer_name: (c.customers?.name ?? null) as string | null,
  });

  const originInSubtree = (c: any) => resolveContractOriginForSubtree(contractRemapInput(c), subtreeIdSet);

  const eligibleContractsForMetrics = contractsRaw
    .filter((c) => {
      const joinDate = (c as any).join_date ? String((c as any).join_date).slice(0, 10) : '';
      // join_date window은 이미 쿼리에서 좁혔지만, 혹시 모를 날짜 형태 차이를 방어
      if (!joinDate) return false;
      return true;
    })
    .filter(isSettlementEligibleContract)
    .map((c) => {
      const resolved = originInSubtree(c);
      if (!subtreeIdSet.has(resolved)) return null;
      return {
        contract_id: (c as any).id as string,
        join_date: String((c as any).join_date ?? '').slice(0, 10),
        unit_count: (c as any).unit_count ?? 0,
        status: (c as any).status as string,
        item_name: (c as any).item_name ?? null,
        sales_member_id: resolved,
        created_at: ((c as any).created_at ?? null) as string | null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);
  debugStats.eligible_contracts_for_metrics_count = eligibleContractsForMetrics.length;

  // ── 개인 대시 카드(서브트리 KPI) ─────────────────────────────
  // - 선택달 준비·대기: 표시 트리 루트별로 노드 카드와 동일한 countByStatus(준비+대기 건) 합산
  // - 선택달 가입 구좌: (정산 윈도우) + 가입 완료(표시 상태 기준) + 취소 제외, unit_count 합
  const periodJoinUnits = contractsRaw
    .filter((c: any) => subtreeIdSet.has(originInSubtree(c)))
    .filter((c: any) => !c.is_cancelled)
    .filter((c: any) =>
      getContractDisplayStatus({
        status: c.status,
        rental_request_no: c.rental_request_no ?? null,
        invoice_no: c.invoice_no ?? null,
        memo: c.memo ?? null,
      }) === '가입',
    )
    .reduce((sum: number, c: any) => sum + (c.unit_count ?? 0), 0);

  // 누적 가입 구좌: 월 제한 없이(서브트리 전체) 가입 완료(표시 상태) 합산
  const cumulativeContractsSelect =
    'id, join_date, unit_count, status, rental_request_no, invoice_no, memo, is_cancelled, sales_member_id, customer_id, item_name, created_at, sales_link_status, customers(name, phone)';
  const cumulativeResList = await Promise.all(
    contractChunks.map((ids) =>
      ids.length === 0
        ? Promise.resolve({ data: [] as any[] })
        : adminDb
            .from('contracts')
            .select(cumulativeContractsSelect)
            .in('sales_member_id', ids)
            .not('sales_member_id', 'is', null)
            .limit(50000),
    ),
  );
  let cumulativeContractsRaw = cumulativeResList.flatMap((r) => r.data ?? []);

  if (hqSalesMemberIds.length > 0) {
    const { data: hqCumRows } = await adminDb
      .from('contracts')
      .select(cumulativeContractsSelect)
      .in('sales_member_id', hqSalesMemberIds)
      .not('sales_member_id', 'is', null)
      .limit(50000);
    const seenC = new Set(cumulativeContractsRaw.map((c: any) => c.id as string));
    for (const row of (hqCumRows ?? []) as any[]) {
      if (!row?.id || seenC.has(row.id)) continue;
      const eff = resolveContractOriginForSubtree(
        {
          sales_member_id: String(row.sales_member_id ?? ''),
          customer_id: String(row.customer_id ?? ''),
          status: row.status,
          rental_request_no: row.rental_request_no ?? null,
          invoice_no: row.invoice_no ?? null,
          memo: row.memo ?? null,
          customer_phone: row.customers?.phone ?? null,
          contract_code: row.contract_code ?? null,
          customer_name: null,
        },
        subtreeIdSet,
      );
      if (!subtreeIdSet.has(eff)) continue;
      seenC.add(row.id);
      cumulativeContractsRaw.push(row);
    }
  }
  const totalJoinUnits = cumulativeContractsRaw
    .filter((c: any) => subtreeIdSet.has(originInSubtree(c)))
    .filter((c: any) => !c.is_cancelled)
    .filter((c: any) =>
      getContractDisplayStatus({
        status: c.status,
        rental_request_no: c.rental_request_no ?? null,
        invoice_no: c.invoice_no ?? null,
        memo: c.memo ?? null,
      }) === '가입',
    )
    .reduce((sum: number, c: any) => sum + (c.unit_count ?? 0), 0);

  // 노드별 "누적 구좌"는 선택 달이 아니라 전체 기간(서브트리 전체)의 가입 인정 계약 기준으로 계산해야 한다.
  const eligibleContractsAllTimeForMetrics = cumulativeContractsRaw
    .filter((c: any) => {
      const joinDate = c.join_date ? String(c.join_date).slice(0, 10) : '';
      if (!joinDate) return false;
      return true;
    })
    .filter(isSettlementEligibleContract)
    .map((c: any) => {
      const resolved = originInSubtree(c);
      if (!subtreeIdSet.has(resolved)) return null;
      return {
        contract_id: String(c.id ?? `${c.sales_member_id ?? 'unknown'}:${String(c.join_date ?? '')}`),
        join_date: String(c.join_date ?? '').slice(0, 10),
        unit_count: c.unit_count ?? 0,
        status: c.status as string,
        item_name: c.item_name ?? null,
        sales_member_id: resolved,
        created_at: (c.created_at ?? null) as string | null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);

  const contractsByMember: Record<string, ContractItem[]> = {};
  for (const c of contractsRaw) {
    const key = originInSubtree(c);
    if (!subtreeIdSet.has(key)) continue;

    const item = {
      id: (c as any).id as string,
      contract_code: (c as any).contract_code as string,
      join_date: (c as any).join_date ? String((c as any).join_date).slice(0, 10) : null,
      product_type: (c as any).product_type ?? null,
      item_name: (c as any).item_name ?? null,
      rental_request_no: (c as any).rental_request_no ?? null,
      invoice_no: (c as any).invoice_no ?? null,
      memo: (c as any).memo ?? null,
      status: (c as any).status as string,
      unit_count: (c as any).unit_count ?? null,
      customer_name: (c as any).customers?.name ?? '',
    };

    if (!contractsByMember[key]) contractsByMember[key] = [];
    contractsByMember[key].push(item);

    const customerKeyRaw = remapCustomerMemberId((c as any).customer_id as string);
    const customerKey = customerKeyRaw && subtreeIdSet.has(customerKeyRaw) ? customerKeyRaw : '';
    if (customerKey && customerKey !== key) {
      if (!contractsByMember[customerKey]) contractsByMember[customerKey] = [];
      contractsByMember[customerKey].push(item);
    }
  }
  debugStats.contracts_by_member_keys = Object.keys(contractsByMember).slice(0, 30);
  debugStats.contracts_by_member_total_rows = Object.values(contractsByMember).reduce((s, arr) => s + arr.length, 0);

  if (debugEnabled) {
    debugStats.debug_customer_param = debugCustomerNeedle || null;
    debugStats.contracts_raw_in_window_count = contractsRaw.length;
    debugStats.subtree_member_sample = subtreeMembers.slice(0, 20).map((m) => ({
      id: m.id,
      name: m.name,
      rank: m.rank,
      external_id: m.external_id,
      source_customer_id: m.source_customer_id,
    }));
    if (debugCustomerNeedle) {
      debugStats.subtree_members_name_match = subtreeMembers
        .filter((m) => (m.name ?? '').includes(debugCustomerNeedle))
        .map((m) => ({ id: m.id, name: m.name, rank: m.rank, external_id: m.external_id }));
    }
    const explainSamples: Array<Record<string, unknown>> = [];
    for (const c of contractsRaw) {
      if (explainSamples.length >= 35) break;
      const custName = String((c as any).customers?.name ?? '');
      const match =
        !debugCustomerNeedle ||
        custName.includes(debugCustomerNeedle) ||
        String((c as any).customer_id ?? '').includes(debugCustomerNeedle);
      if (!match) continue;
      const ri = contractRemapInput(c);
      const o = originInSubtree(c);
      explainSamples.push({
        contract_id: (c as any).id,
        join_date: (c as any).join_date,
        customer_name: custName || null,
        customer_id: (c as any).customer_id,
        sales_member_id: (c as any).sales_member_id,
        origin_key: o,
        in_subtree_bucket: subtreeIdSet.has(o),
        explain: explainContractOriginForSubtree(ri, subtreeIdSet),
      });
    }
    debugStats.window_contract_explain_samples = explainSamples;
    if (debugCustomerNeedle && explainSamples.length === 0) {
      debugStats.window_contract_explain_note =
        '이 달 contracts_raw(서브트리+HQ병합 후, 날짜창 필터 적용)에서 debug_customer 문자열과 일치하는 고객/ID가 없습니다. HQ에서 걸러진 경우 hq_window_contracts.dropped_samples를 보세요.';
    }

    const hqSalesSet = new Set(hqSalesMemberIds);
    const hqInWindowSamples: Array<Record<string, unknown>> = [];
    for (const c of contractsRaw) {
      if (hqInWindowSamples.length >= 20) break;
      if (!hqSalesSet.has(String((c as any).sales_member_id ?? ''))) continue;
      const ri = contractRemapInput(c);
      hqInWindowSamples.push({
        contract_id: (c as any).id,
        customer_name: (c as any).customers?.name ?? null,
        origin_key: originInSubtree(c),
        explain: explainContractOriginForSubtree(ri, subtreeIdSet),
      });
    }
    debugStats.window_hq_attributed_contract_samples = hqInWindowSamples;

    console.log('[organization:debug]', {
      memberId,
      yearMonth,
      debug_customer: debugCustomerNeedle || null,
      contracts_raw_in_window: contractsRaw.length,
      hq_window: debugStats.hq_window_contracts,
      first_drop_reason: (hqWindowDroppedSamples[0] as { explain?: { reason?: string } } | undefined)?.explain
        ?.reason,
    });
  }

  const periodPendingTreeContractCount = (treeForDisplay as any[]).reduce((sum: number, root: any) => {
    const ids = collectSubtreeIds(root);
    const c = countByStatus(ids, contractsByMember);
    return sum + c.준비 + c.대기;
  }, 0);

  // edges/subtree는 calculateOrgNodeMetrics에 넣을 때도 서브트리만 유지
  const subtreeEdges = edgesRemapped.filter(
    (e) => e.child_id && subtreeIdSet.has(e.child_id) && e.parent_id && subtreeIdSet.has(e.parent_id),
  );
  const orgMetricsById = calculateOrgNodeMetrics({
    roots: treeForDisplay as any[],
    members: subtreeMembers.map((m) => ({
      id: m.id,
      rank: m.rank,
      leader_rank_effective_at: m.leader_rank_effective_at ?? undefined,
    })),
    edges: subtreeEdges.map((e) => ({ parent_id: e.parent_id, child_id: e.child_id })),
    treeRows: subtreeTreeRows,
    previousLeaderByPromotedMemberId,
    policyPromotedMemberIdSet,
    leaderPromotionEventsForThreshold: (promoRows ?? []) as any[],
    leaderPromotionThresholdContractCreatedAtById,
    attributeCommissionToTopLineUnderHq: false,
    // 누적 구좌는 전체 기간 기준이어야 하므로 all-time 계약으로 계산한다.
    contracts: eligibleContractsAllTimeForMetrics as any[],
    rules,
    settlementWindow: { start_date, end_date, label_year_month },
  });

  return (
    <div className="p-3 sm:p-6">
      {debugEnabled ? (
        <div className="mb-4 bg-slate-50 border border-slate-200 rounded-lg p-4">
          <div className="text-sm font-semibold text-slate-800 mb-2">[organization debug] stats</div>
          <p className="text-[11px] text-slate-600 mb-2">
            URL 예: <code className="bg-slate-200 px-1 rounded">?debug=1</code> · 특정 고객만 샘플링:{' '}
            <code className="bg-slate-200 px-1 rounded">?debug=1&amp;debug_customer=신희석</code> · 터미널(
            <code className="bg-slate-200 px-1 rounded">npm run dev</code>)에는{' '}
            <code className="bg-slate-200 px-1 rounded">[organization:debug]</code> 로그가 출력됩니다.
          </p>
          <pre className="text-[11px] leading-4 text-slate-700 whitespace-pre-wrap">
            {JSON.stringify(debugStats, null, 2)}
          </pre>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4 sm:mb-6">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-gray-800">내 조직도</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            기준 {label_year_month} · {start_date}~{end_date}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3 w-full">
            <div className="bg-white border border-gray-200 rounded-lg px-4 py-2 text-sm shadow-sm">
              <span className="text-gray-500">선택달 준비·대기 건수</span>
              <span className="ml-2 font-bold text-gray-800">
                {periodPendingTreeContractCount.toLocaleString('ko-KR')}건
              </span>
              <div className="text-[11px] text-gray-400 mt-0.5">
                기준 {label_year_month} · {start_date}~{end_date}
              </div>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg px-4 py-2 text-sm shadow-sm">
              <span className="text-gray-500">누적 가입 구좌 수</span>
              <span className="ml-2 font-bold text-gray-800">{totalJoinUnits.toLocaleString('ko-KR')}구좌</span>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg px-4 py-2 text-sm shadow-sm">
              <span className="text-gray-500">선택달 가입 구좌 수</span>
              <span className="ml-2 font-bold text-gray-800">{periodJoinUnits.toLocaleString('ko-KR')}구좌</span>
              <div className="text-[11px] text-gray-400 mt-0.5">
                기준 {label_year_month} · {start_date}~{end_date}
              </div>
            </div>
          </div>
          <AccountActionsClient
            showChangePassword={false}
            redirectAfterLogout={`/login?redirect=${encodeURIComponent(`/organization?year_month=${yearMonth}`)}`}
          />
        </div>
      </div>

      <YearMonthSelector
        value={yearMonth}
        todayValue={defaultYearMonth}
        years={yearsForPicker}
        keepQuery={
          debugEnabled
            ? {
                debug: '1',
                ...(debugCustomerNeedle ? { debug_customer: debugCustomerNeedle } : {}),
              }
            : { debug: null, debug_customer: null }
        }
      />

      <div className="mb-4 flex justify-end">
        <Link
          href={`/organization/statement?year_month=${encodeURIComponent(yearMonth)}`}
          className="inline-flex items-center px-3 py-2 text-sm rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
        >
          명세서 보기
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <OrgTree
          roots={treeForDisplay as any}
          contractsByMember={contractsByMember}
          metricsById={orgMetricsById as any}
          editable={false}
          showMetrics={false}
          showForecast={true}
          hideHqRoot={true}
          debug={
            debugEnabled
              ? ({ enabled: true } as any)
              : ({ enabled: false, hqId: null, hqEligibleTotal: 0, hqEligibleMappedToCustomerNode: 0, hqEligibleMissingCustomerNode: 0 } as any)
          }
        />
      </div>
    </div>
  );
}

