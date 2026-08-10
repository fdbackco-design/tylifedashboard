import type { SupabaseClient } from '@supabase/supabase-js';
import { isSettlementEligibleContract } from '@/lib/settlement/settlement-eligibility';
import {
  buildChildrenByParentFromRows,
  collectSubtreeMemberIdsDownstream,
} from '@/lib/settlement/settlement-org-tree';
import { contractJoinYmdInInclusiveWindow } from '@/lib/settlement/settlement-window';
import type { OrgTreeRow } from '@/lib/types';
import { buildOrgContractSalesRemap } from '@/lib/organization/org-contract-sales-remap';
import {
  isContractStrictlyAfterPromotionThreshold,
  contractJoinOrderYmd,
  type SalesMemberPromotionThreshold,
} from '@/lib/settlement/leader-promotion';

type MemberRow = {
  id: string;
  name: string;
  rank: string;
  phone: string | null;
  external_id: string | null;
  source_customer_id: string | null;
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** `sumDownlineAttributedUnitsInSettlementWindow`에서 조직 스냅샷을 한 번만 로드할 때 사용 */
export type StatementDownlineSharedData = {
  remapMemberId: (id: string) => string;
  resolveContractOriginForSubtree: (input: any, subtreeIdSet: Set<string>) => string;
  hqSalesMemberIds: string[];
  membersFiltered: MemberRow[];
  treeRows: OrgTreeRow[];
  childrenByParent: ReturnType<typeof buildChildrenByParentFromRows>;
  rankById: Map<string, string>;
  nameById: Map<string, string>;
  promotionThresholdByMemberId: Map<string, SalesMemberPromotionThreshold>;
  leaderPromotionThresholdContractMetaById: Map<
    string,
    { join_date: string; happy_call_at?: string | null; created_at?: string | null }
  >;
};

export async function loadStatementDownlineSharedData(db: SupabaseClient): Promise<StatementDownlineSharedData> {
  const [membersRes, edgesRes, promoRes] = await Promise.all([
    db
      .from('organization_members')
      .select('id,name,rank,phone,external_id,source_customer_id'),
    db.from('organization_edges').select('parent_id,child_id'),
    db
      .from('leader_promotion_events')
      .select('member_id, threshold_contract_id, threshold_join_date'),
  ]);

  const membersRaw = ((membersRes.data ?? []) as MemberRow[]).map((m) =>
    m.name === '안성준' ? { ...m, rank: '본사' as const } : m,
  );
  const edgesRaw = (edgesRes.data ?? []) as Array<{ parent_id: string | null; child_id: string }>;
  const customerBirthDateById = new Map<string, string | null>();
  const sourceCustomerIds = [
    ...new Set(
      membersRaw
        .map((m) => m.source_customer_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  for (const ids of chunk(sourceCustomerIds, 500)) {
    const { data: customerRows, error: customerErr } = await db
      .from('customers')
      .select('id, birth_date')
      .in('id', ids);
    if (customerErr) throw new Error(`customers(birth_date) 조회 실패: ${customerErr.message}`);
    for (const row of (customerRows ?? []) as Array<{ id: string; birth_date: string | null }>) {
      customerBirthDateById.set(row.id, row.birth_date);
    }
  }

  const baseRemap = buildOrgContractSalesRemap(membersRaw, customerBirthDateById);
  const { remapMemberId, hqIds, membersFiltered } = baseRemap;
  const hqSalesMemberIds = [...hqIds];

  const edgesRemapped = edgesRaw.map((e) => ({
    parent_id: e.parent_id ? remapMemberId(e.parent_id) : null,
    child_id: remapMemberId(e.child_id),
  }));
  const memberIdSetFiltered = new Set(membersFiltered.map((m) => m.id));

  const treeRowsBase: OrgTreeRow[] = membersFiltered.map((m) => ({
    id: m.id,
    name: m.name,
    rank: m.rank as OrgTreeRow['rank'],
    parent_id: m.rank === '본사' ? null : null,
    depth: 0,
  }));
  const edgeByChild = new Map<string, string | null>();
  for (const e of edgesRemapped) {
    if (!memberIdSetFiltered.has(e.child_id)) continue;
    const parent_id =
      e.parent_id && memberIdSetFiltered.has(e.parent_id) ? e.parent_id : null;
    edgeByChild.set(e.child_id, parent_id);
  }
  const { resolveContractOriginForSubtree } = buildOrgContractSalesRemap(
    membersRaw,
    customerBirthDateById,
    { parentByChildId: edgeByChild },
  );
  const treeRows = treeRowsBase.map((r) => ({
    ...r,
    parent_id: r.rank === '본사' ? null : edgeByChild.get(r.id) ?? null,
  }));

  const childrenByParent = buildChildrenByParentFromRows(treeRows);
  const rankById = new Map(membersFiltered.map((m) => [m.id, m.rank] as const));
  const nameById = new Map(membersFiltered.map((m) => [m.id, m.name] as const));

  const promotionThresholdByMemberId = new Map<string, SalesMemberPromotionThreshold>();
  const thresholdContractIds: string[] = [];
  for (const r of (promoRes.data ?? []) as Array<{
    member_id: string;
    threshold_contract_id: string | null;
    threshold_join_date: string | null;
  }>) {
    const mid = String(r.member_id ?? '');
    const cid = String(r.threshold_contract_id ?? '');
    const jd = String(r.threshold_join_date ?? '').slice(0, 10);
    if (!mid || !cid || !jd) continue;
    promotionThresholdByMemberId.set(mid, { threshold_contract_id: cid, threshold_join_date: jd });
    thresholdContractIds.push(cid);
  }

  const leaderPromotionThresholdContractMetaById = new Map<
    string,
    { join_date: string; happy_call_at?: string | null; created_at?: string | null }
  >();
  const uniqThIds = [...new Set(thresholdContractIds)];
  for (const thChunk of chunk(uniqThIds, 200)) {
    if (thChunk.length === 0) continue;
    const { data: thRows } = await db
      .from('contracts')
      .select('id, created_at, join_date, happy_call_at')
      .in('id', thChunk);
    for (const row of (thRows ?? []) as Array<{
      id: string;
      created_at?: string | null;
      join_date?: string | null;
      happy_call_at?: string | null;
    }>) {
      if (!row?.id) continue;
      const id = String(row.id);
      const meta = {
        join_date: String(row.join_date ?? '').slice(0, 10),
        happy_call_at: (row.happy_call_at ?? null) as string | null,
        created_at: (row.created_at ?? null) as string | null,
      };
      leaderPromotionThresholdContractMetaById.set(id, meta);
      const orderYmd = contractJoinOrderYmd(meta);
      for (const [mid, th] of promotionThresholdByMemberId) {
        if (th.threshold_contract_id === id) {
          promotionThresholdByMemberId.set(mid, {
            ...th,
            threshold_join_date: orderYmd,
            threshold_created_at: meta.created_at ?? null,
          });
        }
      }
    }
  }

  return {
    remapMemberId,
    resolveContractOriginForSubtree,
    hqSalesMemberIds,
    membersFiltered,
    treeRows,
    childrenByParent,
    rankById,
    nameById,
    promotionThresholdByMemberId,
    leaderPromotionThresholdContractMetaById,
  };
}

const CONTRACT_SELECT_FOR_STATEMENT =
  'id, contract_code, join_date, status, unit_count, sales_member_id, customer_id, is_cancelled, sales_link_status, rental_request_no, invoice_no, memo, happy_call_at, happycall_result, created_at, customers(name, phone, birth_date)';

function hqWindowRemapInputFromRow(row: {
  sales_member_id?: string | null;
  customer_id?: string | null;
  status?: string;
  rental_request_no?: string | null;
  invoice_no?: string | null;
  memo?: string | null;
  customers?: { phone?: string | null; name?: string | null; birth_date?: string | null } | null;
  contract_code?: string | null;
}) {
  return {
    sales_member_id: String(row.sales_member_id ?? ''),
    customer_id: String(row.customer_id ?? ''),
    status: String(row.status ?? ''),
    rental_request_no: row.rental_request_no ?? null,
    invoice_no: row.invoice_no ?? null,
    memo: row.memo ?? null,
    customer_phone: row.customers?.phone ?? null,
    contract_code: row.contract_code ?? null,
    customer_name: row.customers?.name ?? null,
    customer_birth_date: row.customers?.birth_date ?? null,
  } as const;
}

/**
 * 정산 윈도우 안의 계약을 멤버별 산하 집계에 필요한 범위로 한 번만 조회한다.
 * (기존: 루트마다 subtree별로 contracts를 반복 조회 → N배 DB 비용)
 */
export async function loadGlobalStatementWindowContractPool(
  db: SupabaseClient,
  shared: StatementDownlineSharedData,
  window: { start_date: string; end_date: string },
): Promise<Record<string, unknown>[]> {
  const { start_date, end_date } = window;
  const allMemberIds = shared.membersFiltered.map((m) => m.id);
  const allOwnCustomerIds = [
    ...new Set(
      shared.membersFiltered
        .map((m) => m.source_customer_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ];

  const contractChunks = chunk(allMemberIds, 500);
  const contractResList = await Promise.all(
    contractChunks.map((ids) =>
      ids.length === 0
        ? Promise.resolve({ data: [] as Record<string, unknown>[] })
        : db
            .from('contracts')
            .select(CONTRACT_SELECT_FOR_STATEMENT)
            .in('sales_member_id', ids)
            .gte('join_date', start_date)
            .lte('join_date', end_date)
            .order('join_date', { ascending: false })
            .limit(20000),
    ),
  );

  let contractsRaw = contractResList.flatMap((r) => (r.data ?? []) as Record<string, unknown>[]);

  if (shared.hqSalesMemberIds.length > 0) {
    const { data: hqWindowRows } = await db
      .from('contracts')
      .select(CONTRACT_SELECT_FOR_STATEMENT)
      .in('sales_member_id', shared.hqSalesMemberIds)
      .gte('join_date', start_date)
      .lte('join_date', end_date)
      .order('join_date', { ascending: false })
      .limit(20000);
    const seenWin = new Set(contractsRaw.map((c) => String(c.id ?? '')));
    for (const row of (hqWindowRows ?? []) as Record<string, unknown>[]) {
      const rid = String(row?.id ?? '');
      if (!rid || seenWin.has(rid)) continue;
      seenWin.add(rid);
      contractsRaw.push(row);
    }
  }

  if (allOwnCustomerIds.length > 0) {
    const seenOwn = new Set(contractsRaw.map((c) => String(c.id ?? '')));
    for (const custChunk of chunk(allOwnCustomerIds, 120)) {
      const { data: ownWinRows } = await db
        .from('contracts')
        .select(CONTRACT_SELECT_FOR_STATEMENT)
        .in('customer_id', custChunk)
        .gte('join_date', start_date)
        .lte('join_date', end_date)
        .order('join_date', { ascending: false })
        .limit(20000);
      for (const row of (ownWinRows ?? []) as Record<string, unknown>[]) {
        const rid = String(row?.id ?? '');
        if (!rid || seenOwn.has(rid)) continue;
        seenOwn.add(rid);
        contractsRaw.push(row);
      }
    }
  }

  return contractsRaw.filter((c) =>
    contractJoinYmdInInclusiveWindow(c.join_date as string, start_date, end_date),
  );
}

function narrowPreloadedPoolForRootSubtree(
  pool: Record<string, unknown>[],
  shared: StatementDownlineSharedData,
  subtreeIdSet: Set<string>,
  subtreeMemberIds: string[],
  subtreeMemberOwnCustomerIds: string[],
): Record<string, unknown>[] {
  const subtreeSalesSet = new Set(subtreeMemberIds);
  const subtreeCustomerSet = new Set(subtreeMemberOwnCustomerIds);
  const hqSet = new Set(shared.hqSalesMemberIds);
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];

  for (const row of pool) {
    const id = String(row.id ?? '');
    if (!id || seen.has(id)) continue;

    const rawSales = String(row.sales_member_id ?? '');
    if (subtreeSalesSet.has(rawSales)) {
      seen.add(id);
      out.push(row);
      continue;
    }

    if (hqSet.size > 0 && hqSet.has(rawSales)) {
      const winInput = hqWindowRemapInputFromRow(row as any);
      const eff = shared.resolveContractOriginForSubtree(winInput, subtreeIdSet);
      if (subtreeIdSet.has(eff)) {
        seen.add(id);
        out.push(row);
      }
      continue;
    }

    if (subtreeCustomerSet.size > 0) {
      const cid = String(row.customer_id ?? '');
      if (cid && subtreeCustomerSet.has(cid)) {
        const winInput = hqWindowRemapInputFromRow(row as any);
        const eff = shared.resolveContractOriginForSubtree(winInput, subtreeIdSet);
        if (subtreeIdSet.has(eff)) {
          seen.add(id);
          out.push(row);
        }
      }
    }
  }

  return out;
}

export async function computeStatementDownlineUnitsWithSharedContext(
  db: SupabaseClient,
  shared: StatementDownlineSharedData,
  rootMemberId: string,
  window: { start_date: string; end_date: string },
  directUnitCountFromSettlement: number,
  rootLeaderRankEffectiveAt: string | null,
  opts?: { debug?: boolean; preloadedGlobalPool?: Record<string, unknown>[] },
): Promise<
  | number
  | {
      downline_units: number;
      included_units_before_personal: number;
      personal_units_from_settlement: number;
      debug_rows: Array<{
        contract_id: string;
        contract_code: string | null;
        join_date: string;
        unit_count: number;
        raw_sales_member_id: string;
        raw_sales_member_name: string | null;
        origin_member_id: string;
        origin_member_name: string | null;
        nearest_leader_id: string | null;
        nearest_leader_name: string | null;
        excluded_by_leader_after_promotion: boolean;
        excluded_by_root_leader_effective_at: boolean;
      }>;
    }
> {
  const {
    remapMemberId,
    resolveContractOriginForSubtree,
    hqSalesMemberIds,
    membersFiltered,
    treeRows,
    childrenByParent,
    rankById,
    nameById,
    promotionThresholdByMemberId,
    leaderPromotionThresholdContractMetaById,
  } = shared;

  const subtreeIds = collectSubtreeMemberIdsDownstream(rootMemberId, childrenByParent);
  const subtreeIdSet = subtreeIds;
  const rootRank = rankById.get(rootMemberId) ?? null;
  const rootLeaderEffectiveAt =
    rootRank === '리더' && rootLeaderRankEffectiveAt && String(rootLeaderRankEffectiveAt).trim() !== ''
      ? String(rootLeaderRankEffectiveAt).trim()
      : null;
  const rootLeaderEffectiveYmd = rootLeaderEffectiveAt ? rootLeaderEffectiveAt.slice(0, 10) : null;
  const parentByChild = new Map<string, string | null>(
    treeRows.map((r) => [r.id as string, (r.parent_id ?? null) as string | null]),
  );

  const rootPromotionThresholdBase = promotionThresholdByMemberId.get(rootMemberId) ?? null;
  const rootPromotionThreshold: SalesMemberPromotionThreshold | null = rootPromotionThresholdBase ?? null;

  const nearestLeaderBelowRoot = (originMemberId: string): string | null => {
    if (originMemberId === rootMemberId) return null;
    let cur: string | null = originMemberId;
    const visited = new Set<string>();
    while (cur) {
      if (visited.has(cur)) return null;
      visited.add(cur);
      const p: string | null = parentByChild.get(cur) ?? null;
      if (!p) return null;
      if (p === rootMemberId) return null;
      if ((rankById.get(p) ?? null) === '리더') return p;
      cur = p;
    }
    return null;
  };
  const subtreeMemberIds = [...subtreeIdSet];
  const subtreeMembers = membersFiltered.filter((m) => subtreeIdSet.has(m.id));
  const subtreeMemberOwnCustomerIds = [
    ...new Set(
      subtreeMembers
        .map((m) => m.source_customer_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ];

  const { start_date, end_date } = window;

  let contractsRaw: Record<string, unknown>[];

  if (opts?.preloadedGlobalPool != null) {
    contractsRaw = narrowPreloadedPoolForRootSubtree(
      opts.preloadedGlobalPool,
      shared,
      subtreeIdSet,
      subtreeMemberIds,
      subtreeMemberOwnCustomerIds,
    );
  } else {
    const contractSelect = CONTRACT_SELECT_FOR_STATEMENT;

    const contractChunks = chunk(subtreeMemberIds, 500);
    const contractResList = await Promise.all(
      contractChunks.map((ids) =>
        ids.length === 0
          ? Promise.resolve({ data: [] as Record<string, unknown>[] })
          : db
              .from('contracts')
              .select(contractSelect)
              .in('sales_member_id', ids)
              .gte('join_date', start_date)
              .lte('join_date', end_date)
              .order('join_date', { ascending: false })
              .limit(20000),
      ),
    );

    contractsRaw = contractResList.flatMap((r) => (r.data ?? []) as Record<string, unknown>[]);

    if (hqSalesMemberIds.length > 0) {
      const { data: hqWindowRows } = await db
        .from('contracts')
        .select(contractSelect)
        .in('sales_member_id', hqSalesMemberIds)
        .gte('join_date', start_date)
        .lte('join_date', end_date)
        .order('join_date', { ascending: false })
        .limit(20000);
      const seenWin = new Set(contractsRaw.map((c) => c.id as string));
      for (const row of (hqWindowRows ?? []) as Record<string, unknown>[]) {
        if (!row?.id || seenWin.has(row.id as string)) continue;
        const winInput = hqWindowRemapInputFromRow(row as any);
        const eff = resolveContractOriginForSubtree(winInput, subtreeIdSet);
        if (!subtreeIdSet.has(eff)) continue;
        seenWin.add(row.id as string);
        contractsRaw.push(row);
      }
    }

    if (subtreeMemberOwnCustomerIds.length > 0) {
      const seenOwn = new Set(contractsRaw.map((c) => c.id as string));
      for (const custChunk of chunk(subtreeMemberOwnCustomerIds, 120)) {
        const { data: ownWinRows } = await db
          .from('contracts')
          .select(contractSelect)
          .in('customer_id', custChunk)
          .gte('join_date', start_date)
          .lte('join_date', end_date)
          .order('join_date', { ascending: false })
          .limit(20000);
        for (const row of (ownWinRows ?? []) as Record<string, unknown>[]) {
          if (!row?.id || seenOwn.has(row.id as string)) continue;
          const winInput = hqWindowRemapInputFromRow(row as any);
          const eff = resolveContractOriginForSubtree(winInput, subtreeIdSet);
          if (!subtreeIdSet.has(eff)) continue;
          seenOwn.add(row.id as string);
          contractsRaw.push(row);
        }
      }
    }
  }

  contractsRaw = contractsRaw.filter((c) =>
    contractJoinYmdInInclusiveWindow(c.join_date as string, start_date, end_date),
  );

  const contractRemapInput = (c: Record<string, unknown>) => ({
    sales_member_id: String(c.sales_member_id ?? ''),
    customer_id: String(c.customer_id ?? ''),
    status: c.status as string,
    rental_request_no: (c.rental_request_no ?? null) as string | null,
    invoice_no: (c.invoice_no ?? null) as string | null,
    memo: (c.memo ?? null) as string | null,
    customer_phone: ((c.customers as { phone?: string | null } | null)?.phone ?? null) as string | null,
    contract_code: (c.contract_code ?? null) as string | null,
    customer_name: ((c.customers as { name?: string | null } | null)?.name ?? null) as string | null,
    customer_birth_date: (
      (c.customers as { birth_date?: string | null } | null)?.birth_date ?? null
    ) as string | null,
  });

  let scopeAttributedTotal = 0;
  const debugRows: Array<{
    contract_id: string;
    contract_code: string | null;
    join_date: string;
    unit_count: number;
    raw_sales_member_id: string;
    raw_sales_member_name: string | null;
    origin_member_id: string;
    origin_member_name: string | null;
    nearest_leader_id: string | null;
    nearest_leader_name: string | null;
    excluded_by_leader_after_promotion: boolean;
    excluded_by_root_leader_effective_at: boolean;
  }> = [];
  for (const c of contractsRaw) {
    if (!isSettlementEligibleContract(c as any)) continue;
    const rawSalesMemberId = String((c.sales_member_id as string | null | undefined) ?? '');
    const rawSalesMemberIdRemapped = remapMemberId(rawSalesMemberId);
    const origin = resolveContractOriginForSubtree(contractRemapInput(c), subtreeIdSet);

    if (!subtreeIdSet.has(origin)) continue;

    let excludedByRootLeaderEffectiveAt = false;
    if (rootRank === '리더') {
      const jd = String((c.join_date as string | null | undefined) ?? '').slice(0, 10);
      const isDirectByRawSales = rawSalesMemberIdRemapped === rootMemberId;
      if (!isDirectByRawSales) {
        const createdAt = (c.created_at as string | null | undefined) ?? null;

        if (rootLeaderEffectiveAt && rootLeaderEffectiveYmd) {
          if (jd && jd < rootLeaderEffectiveYmd) {
            excludedByRootLeaderEffectiveAt = true;
          } else if (jd && jd === rootLeaderEffectiveYmd) {
            if (createdAt && createdAt < rootLeaderEffectiveAt) excludedByRootLeaderEffectiveAt = true;
          }
        } else if (rootPromotionThreshold) {
          const after = isContractStrictlyAfterPromotionThreshold(
            {
              id: String(c.id),
              join_date: jd,
              happy_call_at: (c.happy_call_at as string | null | undefined) ?? null,
              created_at: createdAt,
            },
            rootPromotionThreshold,
          );
          if (!after) excludedByRootLeaderEffectiveAt = true;
        }
      }

      if (excludedByRootLeaderEffectiveAt) {
        if (opts?.debug) {
          debugRows.push({
            contract_id: String(c.id),
            contract_code: (c.contract_code as string | null | undefined) ?? null,
            join_date: jd,
            unit_count: Number((c.unit_count as number | null | undefined) ?? 0),
            raw_sales_member_id: rawSalesMemberIdRemapped,
            raw_sales_member_name: nameById.get(rawSalesMemberIdRemapped) ?? null,
            origin_member_id: origin,
            origin_member_name: nameById.get(origin) ?? null,
            nearest_leader_id: null,
            nearest_leader_name: null,
            excluded_by_leader_after_promotion: false,
            excluded_by_root_leader_effective_at: true,
          });
        }
        continue;
      }
    }

    let excludedByPromotionAfter = false;
    let nearestLeaderId: string | null = null;
    if (rootRank === '리더') {
      nearestLeaderId = nearestLeaderBelowRoot(origin);
      if (nearestLeaderId) {
        const thBase = promotionThresholdByMemberId.get(nearestLeaderId) ?? null;
        const th: SalesMemberPromotionThreshold | null = thBase ?? null;
        if (!th) {
          continue;
        }
        const jd = String((c.join_date as string | null | undefined) ?? '').slice(0, 10);
        const createdAt = (c.created_at as string | null | undefined) ?? null;
        const after = isContractStrictlyAfterPromotionThreshold(
          {
            id: String(c.id),
            join_date: jd,
            happy_call_at: (c.happy_call_at as string | null | undefined) ?? null,
            created_at: createdAt,
          },
          th,
        );
        if (after) {
          excludedByPromotionAfter = true;
          if (opts?.debug) {
            debugRows.push({
              contract_id: String(c.id),
              contract_code: (c.contract_code as string | null | undefined) ?? null,
              join_date: jd,
              unit_count: Number((c.unit_count as number | null | undefined) ?? 0),
              raw_sales_member_id: rawSalesMemberIdRemapped,
              raw_sales_member_name: nameById.get(rawSalesMemberIdRemapped) ?? null,
              origin_member_id: origin,
              origin_member_name: nameById.get(origin) ?? null,
              nearest_leader_id: nearestLeaderId,
              nearest_leader_name: nameById.get(nearestLeaderId) ?? null,
              excluded_by_leader_after_promotion: true,
              excluded_by_root_leader_effective_at: false,
            });
          }
          continue;
        }
      }
    }

    const u = Number((c.unit_count as number | null | undefined) ?? 0);
    if (Number.isFinite(u) && u > 0) {
      scopeAttributedTotal += u;
      if (opts?.debug) {
        debugRows.push({
          contract_id: String(c.id),
          contract_code: (c.contract_code as string | null | undefined) ?? null,
          join_date: String((c.join_date as string | null | undefined) ?? '').slice(0, 10),
          unit_count: u,
          raw_sales_member_id: rawSalesMemberIdRemapped,
          raw_sales_member_name: nameById.get(rawSalesMemberIdRemapped) ?? null,
          origin_member_id: origin,
          origin_member_name: nameById.get(origin) ?? null,
          nearest_leader_id: nearestLeaderId,
          nearest_leader_name: nearestLeaderId ? (nameById.get(nearestLeaderId) ?? null) : null,
          excluded_by_leader_after_promotion: excludedByPromotionAfter,
          excluded_by_root_leader_effective_at: excludedByRootLeaderEffectiveAt,
        });
      }
    }
  }

  const personal = Math.max(0, Math.floor(Number(directUnitCountFromSettlement) || 0));
  const downline = Math.max(0, scopeAttributedTotal - personal);
  if (opts?.debug) {
    return {
      downline_units: downline,
      included_units_before_personal: scopeAttributedTotal,
      personal_units_from_settlement: personal,
      debug_rows: debugRows,
    };
  }
  return downline;
}

/** 여러 루트(본사 직속 라인 등)의 산하 실적 구좌를 한 번의 스냅샷 로드로 계산한다. */
export async function computeStatementDownlineUnitsByMemberIds(
  db: SupabaseClient,
  memberIds: string[],
  window: { start_date: string; end_date: string },
  directUnitsByMemberId: Record<string, number>,
  leaderRankEffectiveAtByMemberId: Record<string, string | null>,
): Promise<Record<string, number>> {
  const uniqIds = [...new Set(memberIds.map((id) => String(id).trim()).filter(Boolean))];
  const out: Record<string, number> = {};
  if (uniqIds.length === 0) return out;

  const shared = await loadStatementDownlineSharedData(db);
  const preloadedGlobalPool = await loadGlobalStatementWindowContractPool(db, shared, window);

  const BATCH = 48;
  for (let i = 0; i < uniqIds.length; i += BATCH) {
    const slice = uniqIds.slice(i, i + BATCH);
    const results = await Promise.all(
      slice.map((mid) =>
        computeStatementDownlineUnitsWithSharedContext(
          db,
          shared,
          mid,
          window,
          directUnitsByMemberId[mid] ?? 0,
          leaderRankEffectiveAtByMemberId[mid] ?? null,
          { preloadedGlobalPool },
        ),
      ),
    );
    slice.forEach((mid, j) => {
      const res = results[j];
      out[mid] = typeof res === 'number' ? res : res.downline_units;
    });
  }

  return out;
}

/**
 * 지급 명세서용: 정산 윈도우 안에서 귀속 담당자가 `rootMemberId` 서브트리에 속한 계약 구좌 합(본인 포함)에서,
 * 명세서 개인 실적(`directUnitCountFromSettlement`)을 뺀 값을 산하 실적으로 반환한다.
 * /organization 과 동일한 `resolveContractOriginForSubtree`·정산 대상 필터를 사용한다.
 */
export async function sumDownlineAttributedUnitsInSettlementWindow(
  db: SupabaseClient,
  rootMemberId: string,
  window: { start_date: string; end_date: string },
  directUnitCountFromSettlement: number,
  rootLeaderRankEffectiveAt: string | null,
  opts?: { debug?: boolean; preloadedGlobalPool?: Record<string, unknown>[] },
): Promise<
  | number
  | {
      downline_units: number;
      included_units_before_personal: number;
      personal_units_from_settlement: number;
      debug_rows: Array<{
        contract_id: string;
        contract_code: string | null;
        join_date: string;
        unit_count: number;
        raw_sales_member_id: string;
        raw_sales_member_name: string | null;
        origin_member_id: string;
        origin_member_name: string | null;
        nearest_leader_id: string | null;
        nearest_leader_name: string | null;
        excluded_by_leader_after_promotion: boolean;
        excluded_by_root_leader_effective_at: boolean;
      }>;
    }
> {
  const shared = await loadStatementDownlineSharedData(db);
  return computeStatementDownlineUnitsWithSharedContext(
    db,
    shared,
    rootMemberId,
    window,
    directUnitCountFromSettlement,
    rootLeaderRankEffectiveAt,
    opts,
  );
}
