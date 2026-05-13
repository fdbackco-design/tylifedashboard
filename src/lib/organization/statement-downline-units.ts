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
  opts?: { debug?: boolean },
): Promise<
  | number
  | {
      downline_units: number;
      debug_rows: Array<{
        contract_id: string;
        contract_code: string | null;
        join_date: string;
        unit_count: number;
        origin_member_id: string;
        origin_member_name: string | null;
        nearest_leader_id: string | null;
        nearest_leader_name: string | null;
        excluded_by_leader_after_promotion: boolean;
        excluded_by_root_leader_effective_at: boolean;
      }>;
    }
> {
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
    m.name === '안성준' ? { ...m, rank: '본사' } : m,
  );
  const edgesRaw = (edgesRes.data ?? []) as Array<{ parent_id: string | null; child_id: string }>;

  const { remapMemberId, resolveContractOriginForSubtree, hqIds, membersFiltered } =
    buildOrgContractSalesRemap(membersRaw);
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
  const treeRows = treeRowsBase.map((r) => ({
    ...r,
    parent_id: r.rank === '본사' ? null : edgeByChild.get(r.id) ?? null,
  }));

  const childrenByParent = buildChildrenByParentFromRows(treeRows);
  const subtreeIds = collectSubtreeMemberIdsDownstream(rootMemberId, childrenByParent);
  const subtreeIdSet = subtreeIds;
  const rankById = new Map(membersFiltered.map((m) => [m.id, m.rank] as const));
  const nameById = new Map(membersFiltered.map((m) => [m.id, m.name] as const));
  const rootRank = rankById.get(rootMemberId) ?? null;
  const rootLeaderEffectiveAt =
    rootRank === '리더' && rootLeaderRankEffectiveAt && String(rootLeaderRankEffectiveAt).trim() !== ''
      ? String(rootLeaderRankEffectiveAt).trim()
      : null;
  const parentByChild = new Map<string, string | null>(
    treeRows.map((r) => [r.id as string, (r.parent_id ?? null) as string | null]),
  );

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

  // threshold_contract_id의 created_at이 필요 (동일 join_date에서 경계 처리)
  const leaderPromotionThresholdContractCreatedAtById = new Map<string, string | null>();
  const uniqThIds = [...new Set(thresholdContractIds)];
  for (const thChunk of chunk(uniqThIds, 200)) {
    if (thChunk.length === 0) continue;
    const { data: thRows } = await db.from('contracts').select('id, created_at').in('id', thChunk);
    for (const row of (thRows ?? []) as Array<{ id: string; created_at?: string | null }>) {
      if (!row?.id) continue;
      leaderPromotionThresholdContractCreatedAtById.set(String(row.id), (row.created_at ?? null) as string | null);
    }
  }

  // 요구: 명세서의 “산하 실적 구좌”는 오버라이드(롤업) 계산 기준과 동일하게,
  // 리더 산하에서 또 다른 리더가 있는 경우 그 하위 리더 subtree 실적은 상위 리더 산하에 포함하지 않는다.
  // 단, “하위 리더가 발생하는 계약(승격 계약)까지”는 상위 리더 산하에 포함해야 한다.
  // 따라서 root가 리더면: 계약 단위로, (origin의 가장 가까운 하위 리더)가 승격 계약 이후인지에 따라 포함/제외한다.
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
  const contractSelect =
    'id, contract_code, join_date, status, unit_count, sales_member_id, customer_id, is_cancelled, sales_link_status, rental_request_no, invoice_no, memo, created_at, customers(name, phone)';

  const hqWindowRemapInput = (row: {
    sales_member_id?: string | null;
    customer_id?: string | null;
    status?: string;
    rental_request_no?: string | null;
    invoice_no?: string | null;
    memo?: string | null;
    customers?: { phone?: string | null } | null;
    contract_code?: string | null;
  }) =>
    ({
      sales_member_id: String(row.sales_member_id ?? ''),
      customer_id: String(row.customer_id ?? ''),
      status: String(row.status ?? ''),
      rental_request_no: row.rental_request_no ?? null,
      invoice_no: row.invoice_no ?? null,
      memo: row.memo ?? null,
      customer_phone: row.customers?.phone ?? null,
      contract_code: row.contract_code ?? null,
      customer_name: (row.customers as { name?: string | null } | null)?.name ?? null,
    }) as const;

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

  let contractsRaw = contractResList.flatMap((r) => (r.data ?? []) as Record<string, unknown>[]);

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
      const winInput = hqWindowRemapInput(row as any);
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
        const winInput = hqWindowRemapInput(row as any);
        const eff = resolveContractOriginForSubtree(winInput, subtreeIdSet);
        if (!subtreeIdSet.has(eff)) continue;
        seenOwn.add(row.id as string);
        contractsRaw.push(row);
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
  });

  let scopeAttributedTotal = 0;
  const debugRows: Array<{
    contract_id: string;
    contract_code: string | null;
    join_date: string;
    unit_count: number;
    origin_member_id: string;
    origin_member_name: string | null;
    nearest_leader_id: string | null;
    nearest_leader_name: string | null;
    excluded_by_leader_after_promotion: boolean;
    excluded_by_root_leader_effective_at: boolean;
  }> = [];
  for (const c of contractsRaw) {
    if (!isSettlementEligibleContract(c as any)) continue;
    const origin = resolveContractOriginForSubtree(contractRemapInput(c), subtreeIdSet);

    // 기본: 내 서브트리 귀속만 집계
    if (!subtreeIdSet.has(origin)) continue;

    // root가 리더인 경우: "리더가 된 이후" 계약만 포함
    let excludedByRootLeaderEffectiveAt = false;
    if (rootLeaderEffectiveAt) {
      const createdAt = (c.created_at as string | null | undefined) ?? null;
      if (createdAt && createdAt < rootLeaderEffectiveAt) {
        excludedByRootLeaderEffectiveAt = true;
      } else if (!createdAt) {
        const jd = String((c.join_date as string | null | undefined) ?? '').slice(0, 10);
        const effYmd = rootLeaderEffectiveAt.slice(0, 10);
        if (jd && effYmd && jd < effYmd) excludedByRootLeaderEffectiveAt = true;
      }
      if (excludedByRootLeaderEffectiveAt) {
        if (opts?.debug) {
          const jd = String((c.join_date as string | null | undefined) ?? '').slice(0, 10);
          debugRows.push({
            contract_id: String(c.id),
            contract_code: (c.contract_code as string | null | undefined) ?? null,
            join_date: jd,
            unit_count: Number((c.unit_count as number | null | undefined) ?? 0),
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

    // 리더일 때만: "하위 리더 발생 시점(승격 계약)" 기준으로 계약 단위 포함/제외
    let excludedByPromotionAfter = false;
    let nearestLeaderId: string | null = null;
    if (rootRank === '리더') {
      nearestLeaderId = nearestLeaderBelowRoot(origin);
      if (nearestLeaderId) {
        const thBase = promotionThresholdByMemberId.get(nearestLeaderId) ?? null;
        const th: SalesMemberPromotionThreshold | null = thBase
          ? {
              ...thBase,
              threshold_created_at:
                leaderPromotionThresholdContractCreatedAtById.get(thBase.threshold_contract_id) ?? null,
            }
          : null;
        if (!th) {
          // 이미 리더(승격 임계 정보 없음)면 상위 리더 산하에 포함하지 않는다.
          continue;
        }
        const jd = String((c.join_date as string | null | undefined) ?? '').slice(0, 10);
        const createdAt = (c.created_at as string | null | undefined) ?? null;
        const after = isContractStrictlyAfterPromotionThreshold(
          jd,
          String(c.id),
          th,
          createdAt,
        );
        // 승격 계약 "이후"부터는 하위 리더 실적으로 귀속 → 상위 리더 산하에서 제외
        if (after) {
          excludedByPromotionAfter = true;
          if (opts?.debug) {
            debugRows.push({
              contract_id: String(c.id),
              contract_code: (c.contract_code as string | null | undefined) ?? null,
              join_date: jd,
              unit_count: Number((c.unit_count as number | null | undefined) ?? 0),
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
    return { downline_units: downline, debug_rows: debugRows };
  }
  return downline;
}
