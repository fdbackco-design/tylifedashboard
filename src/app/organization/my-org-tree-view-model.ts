import { unstable_cache } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { buildOrgTree } from '@/lib/settlement/calculator';
import { collectSubtreeMemberIdsDownstream } from '@/lib/settlement/settlement-org-tree';
import { contractJoinYmdInInclusiveWindow, getSettlementWindowForYearMonth } from '@/lib/settlement/settlement-window';
import { calculateOrgNodeMetrics } from '@/lib/settlement/org-node-metrics';
import { isSettlementEligibleContract } from '@/lib/settlement/settlement-eligibility';
import { getContractDisplayStatus } from '@/lib/utils/contract-display-status';
import { getContractDisplayProductName } from '@/lib/utils/contract-display-product';
import type { OrgTreeNode, OrgTreeRow } from '@/lib/types';
import type { SettlementRule } from '@/lib/types/settlement';
import { type ContractItem, collectSubtreeIds, countByStatus } from '@/lib/organization/org-tree-contract-counts';
import { buildChildrenByParentFromRows } from '@/lib/settlement/settlement-org-tree';
import { stripOrgTreeNodesForDisplay } from '@/lib/organization/org-tree-display';
import { buildOrgContractSalesRemap } from '@/lib/organization/org-contract-sales-remap';
import { stripCustomerMemberNamePrefix } from '@/lib/dashboard/display-format';

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

export type OrganizationMyTreeViewModel = {
  yearMonth: string;
  label_year_month: string;
  start_date: string;
  end_date: string;
  yearsForPicker: number[];
  greetingDisplayName: string;
  /** 인사말용 직급(없으면 빈 문자열) */
  greetingDisplayRank: string;
  treeForDisplay: OrgTreeNode[];
  contractsByMember: Record<string, ContractItem[]>;
  orgMetricsById: Record<
    string,
    {
      cumulativeUnitCount: number;
      monthlyUnitCount: number;
      recognizedCommissionWon: number;
      paidCommissionWon: number;
    }
  >;
  periodPendingTreeContractCount: number;
  totalJoinUnits: number;
  periodJoinUnits: number;
  basisYear: string;
  basisMonth: string;
};

/**
 * 사전 발급(PENDING) 등으로 member_id 가 아직 매핑되지 않은 사용자를 위한 빈 뷰 모델.
 * - 화면 골격(헤더/탭/주기 선택)은 동일하게 유지하면서 모든 수치를 0/null 로 표시한다.
 * - 영업 데이터는 일체 노출되지 않으므로 권한 누수 없음.
 */
export function buildEmptyMyOrganizationTreeViewModel(params: {
  yearMonth: string;
  displayName: string | null;
}): OrganizationMyTreeViewModel {
  const { yearMonth, displayName } = params;
  const { start_date, end_date, label_year_month } = getSettlementWindowForYearMonth(yearMonth);
  const yearsForPicker = (() => {
    const base = parseInt(label_year_month.slice(0, 4), 10);
    const out: number[] = [];
    for (let y = base; y >= base - 4; y--) out.push(y);
    return out;
  })();
  const [basisYear, basisMonth] = label_year_month.split('-');
  const cleanName = (displayName ?? '').replace(/^\[고객\]\s*/, '').trim() || '사용자';
  return {
    yearMonth,
    label_year_month,
    start_date,
    end_date,
    yearsForPicker,
    greetingDisplayName: cleanName,
    greetingDisplayRank: '',
    treeForDisplay: [],
    contractsByMember: {},
    orgMetricsById: {},
    periodPendingTreeContractCount: 0,
    totalJoinUnits: 0,
    periodJoinUnits: 0,
    basisYear,
    basisMonth,
  };
}

export async function buildMyOrganizationTreeViewModel(
  adminDb: SupabaseClient,
  params: { memberId: string; yearMonth: string },
): Promise<OrganizationMyTreeViewModel> {
  const { memberId, yearMonth } = params;
  const { start_date, end_date, label_year_month } = getSettlementWindowForYearMonth(yearMonth);
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
    /** 조직원 본인 customers.id — HQ id 불일치 등으로 HQ 전용 쿼리가 0건일 때도 직접 가입 계약을 불러온다 */
    const subtreeMemberOwnCustomerIds = [
      ...new Set(
        subtreeMembers
          .map((m) => m.source_customer_id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    ];

    // 계약은 subtree에 속한 sales_member_id만 조회(월 버튼 클릭 시 지연 감소)
    const subtreeMemberIds = [...subtreeIdSet.values()];
    const memberNameById = new Map(
      membersForTree.map((m) => [m.id, stripCustomerMemberNamePrefix(m.name) || m.name]),
    );
    const salesMemberDisplayName = (salesMemberId: string | null | undefined): string => {
      const id = remapMemberId(String(salesMemberId ?? ''));
      if (!id) return '-';
      return memberNameById.get(id) ?? '-';
    };
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
      'id, contract_code, join_date, product_type, item_name, rental_request_no, invoice_no, memo, status, unit_count, sales_member_id, customer_id, is_cancelled, sales_link_status, happy_call_at, happycall_result, source_snapshot_json, customers(name, phone), created_at';

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

    if (hqSalesMemberIds.length > 0) {
      const { data: hqWindowRows } = await adminDb
        .from('contracts')
        .select(contractSelect)
        .in('sales_member_id', hqSalesMemberIds)
        .gte('join_date', start_date)
        .lte('join_date', end_date)
        .order('join_date', { ascending: false })
        .limit(20000);
      const seenWin = new Set(contractsRaw.map((c: any) => c.id as string));
      for (const row of (hqWindowRows ?? []) as any[]) {
        if (!row?.id || seenWin.has(row.id)) continue;
        const winInput = hqWindowRemapInput(row);
        const eff = resolveContractOriginForSubtree(winInput, subtreeIdSet);
        if (!subtreeIdSet.has(eff)) continue;
        seenWin.add(row.id);
        contractsRaw.push(row);
      }
    }

    if (subtreeMemberOwnCustomerIds.length > 0) {
      const seenOwn = new Set(contractsRaw.map((c: any) => c.id as string));
      for (const custChunk of chunk(subtreeMemberOwnCustomerIds, 120)) {
        const { data: ownWinRows } = await adminDb
          .from('contracts')
          .select(contractSelect)
          .in('customer_id', custChunk)
          .gte('join_date', start_date)
          .lte('join_date', end_date)
          .order('join_date', { ascending: false })
          .limit(20000);
        for (const row of (ownWinRows ?? []) as any[]) {
          if (!row?.id || seenOwn.has(row.id)) continue;
          const winInput = hqWindowRemapInput(row);
          const eff = resolveContractOriginForSubtree(winInput, subtreeIdSet);
          if (!subtreeIdSet.has(eff)) continue;
          seenOwn.add(row.id);
          contractsRaw.push(row);
        }
      }
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

    const tree = buildOrgTree(subtreeTreeRows);
    // /organization에서는 최상단 본사(person) 노드는 숨기고, 자식들을 루트로 승격해서 보여준다.
    const treeForDisplay = stripOrgTreeNodesForDisplay(tree as any);

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
      'id, join_date, unit_count, status, rental_request_no, invoice_no, memo, is_cancelled, sales_member_id, customer_id, item_name, created_at, sales_link_status, happy_call_at, happycall_result, customers(name, phone)';
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

    if (subtreeMemberOwnCustomerIds.length > 0) {
      const seenOwnC = new Set(cumulativeContractsRaw.map((c: any) => c.id as string));
      for (const custChunk of chunk(subtreeMemberOwnCustomerIds, 120)) {
        const { data: ownCumRows } = await adminDb
          .from('contracts')
          .select(cumulativeContractsSelect)
          .in('customer_id', custChunk)
          .not('sales_member_id', 'is', null)
          .limit(50000);
        for (const row of (ownCumRows ?? []) as any[]) {
          if (!row?.id || seenOwnC.has(row.id)) continue;
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
          seenOwnC.add(row.id);
          cumulativeContractsRaw.push(row);
        }
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
        happy_call_at: ((c as any).happy_call_at ?? null) as string | null,
        product_type: getContractDisplayProductName({
          product_type: (c as any).product_type ?? null,
          item_name: (c as any).item_name ?? null,
          source_snapshot_json: ((c as any).source_snapshot_json ?? null) as Record<
            string,
            string | null
          > | null,
        }),
        item_name: (c as any).item_name ?? null,
        rental_request_no: (c as any).rental_request_no ?? null,
        invoice_no: (c as any).invoice_no ?? null,
        memo: (c as any).memo ?? null,
        status: (c as any).status as string,
        unit_count: (c as any).unit_count ?? null,
        customer_name: (c as any).customers?.name ?? '',
        sales_member_name: salesMemberDisplayName((c as any).sales_member_id),
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

  const [basisYear, basisMonth] = label_year_month.split('-');

  const selfMemberRow =
    membersForTree.find((m) => m.id === memberId) ?? membersRaw.find((m) => m.id === memberId) ?? null;
  const greetingDisplayName = (() => {
    const raw = selfMemberRow?.name?.trim() ?? '';
    if (!raw) return '회원';
    const stripped = stripCustomerMemberNamePrefix(raw).trim();
    return stripped || '회원';
  })();
  const greetingDisplayRank = (selfMemberRow?.rank ?? '').trim();

  return {
    yearMonth,
    label_year_month,
    start_date,
    end_date,
    yearsForPicker,
    greetingDisplayName,
    greetingDisplayRank,
    treeForDisplay: treeForDisplay as OrgTreeNode[],
    contractsByMember,
    orgMetricsById: orgMetricsById as OrganizationMyTreeViewModel['orgMetricsById'],
    periodPendingTreeContractCount,
    totalJoinUnits,
    periodJoinUnits,
    basisYear,
    basisMonth,
  };
}
