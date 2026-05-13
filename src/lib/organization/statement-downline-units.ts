import type { SupabaseClient } from '@supabase/supabase-js';
import { isSettlementEligibleContract } from '@/lib/settlement/settlement-eligibility';
import {
  buildChildrenByParentFromRows,
  collectSubtreeMemberIdsDownstream,
} from '@/lib/settlement/settlement-org-tree';
import { contractJoinYmdInInclusiveWindow } from '@/lib/settlement/settlement-window';
import type { OrgTreeRow } from '@/lib/types';
import { buildOrgContractSalesRemap } from '@/lib/organization/org-contract-sales-remap';

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
 * 지급 명세서용: 정산 윈도우 안에서, 귀속 담당자가 `rootMemberId`의 직접 산하(본인 제외)에 속한 계약 구좌 합계.
 * /organization 과 동일한 `resolveContractOriginForSubtree`·정산 대상 필터를 사용한다.
 */
export async function sumDownlineAttributedUnitsInSettlementWindow(
  db: SupabaseClient,
  rootMemberId: string,
  window: { start_date: string; end_date: string },
): Promise<number> {
  const [membersRes, edgesRes] = await Promise.all([
    db
      .from('organization_members')
      .select('id,name,rank,phone,external_id,source_customer_id'),
    db.from('organization_edges').select('parent_id,child_id'),
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
  const descendantIds = new Set(subtreeIds);
  descendantIds.delete(rootMemberId);
  if (descendantIds.size === 0) return 0;

  const subtreeIdSet = subtreeIds;
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
    'id, contract_code, join_date, status, unit_count, sales_member_id, customer_id, is_cancelled, sales_link_status, rental_request_no, invoice_no, memo, customers(name, phone)';

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

  let sum = 0;
  for (const c of contractsRaw) {
    if (!isSettlementEligibleContract(c as any)) continue;
    const origin = resolveContractOriginForSubtree(contractRemapInput(c), subtreeIdSet);
    if (!descendantIds.has(origin)) continue;
    const u = Number((c.unit_count as number | null | undefined) ?? 0);
    if (Number.isFinite(u) && u > 0) sum += u;
  }

  return sum;
}
