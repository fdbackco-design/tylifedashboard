import { buildOrgTree } from '@/lib/settlement/calculator';
import {
  type ContractSalesRemapInput,
  type OrgMemberForContractRemap,
} from '@/lib/organization/org-contract-sales-remap';
import { buildOrgStructuralTreeContext } from '@/lib/organization/org-structural-tree';
import {
  computeLeaderPromotionThresholds,
  computeCenterChiefPromotionMemberIds,
  computeCenterChiefDemotionMemberIds,
  isCustomerVirtualOrgMember,
  type AttributedJoinContractRow,
} from '@/lib/settlement/leader-promotion';
import { isContractJoinCompleted } from '@/lib/utils/contract-display-status';
import type { OrgTreeNode, OrgTreeRow, OrganizationMember } from '@/lib/types';
import type { RankType } from '@/lib/types/organization';

export type AdminOrgRawContractRow = {
  id: string;
  contract_code: string;
  join_date: string | null;
  product_type?: string | null;
  item_name?: string | null;
  status: string;
  unit_count: number | null;
  customer_id: string;
  sales_member_id: string;
  is_cancelled?: boolean | null;
  sales_link_status?: string | null;
  rental_request_no?: string | null;
  invoice_no?: string | null;
  memo?: string | null;
  happy_call_at?: string | null;
  happycall_result?: string | null;
  source_snapshot_json?: Record<string, string | null> | null;
  created_at?: string | null;
  invoice_registered_at?: string | null;
  customers: { name: string; phone: string | null } | null;
};

export type AdminOrgDisplayContext = {
  members: OrganizationMember[];
  dedupedEdges: { parent_id: string | null; child_id: string }[];
  treeRows: OrgTreeRow[];
  tree: OrgTreeNode[];
  hqIdForTree: string | null;
  remapMemberId: (id: string) => string;
  resolveContractSalesMemberId: (c: ContractSalesRemapInput) => string;
  remapCustomerMemberId: (
    customerId: string,
    expectedName?: string | null,
    customerPhone?: string | null,
  ) => string;
  salesMemberDisplayName: (salesMemberId: string | null | undefined) => string;
};

export function buildAdminOrgDisplayContext(params: {
  membersRaw: OrganizationMember[];
  edgesRaw: { parent_id: string | null; child_id: string }[];
  rawContractRows: AdminOrgRawContractRow[];
  parentOverrideByChildId?: ReadonlyMap<string, string | null>;
}): AdminOrgDisplayContext {
  const { membersRaw, edgesRaw, rawContractRows, parentOverrideByChildId } = params;

  const orgStructural = buildOrgStructuralTreeContext({
    membersRaw: membersRaw as unknown as OrgMemberForContractRemap[],
    edgesRaw,
    parentOverrideByChildId,
  });
  const {
    treeRows: treeRowsBase,
    remapMemberId,
    resolveContractSalesMemberId,
    remapCustomerMemberId,
    hqIds: hqIdsRaw,
    membersFiltered,
  } = orgStructural;

  const members = membersFiltered as unknown as OrganizationMember[];
  const memberNameById = new Map(members.map((m) => [m.id, (m.name ?? '').replace(/^\[고객\]\s*/, '').trim()]));

  const hqIdForTree =
    members.find((m) => m.name === '안성준')?.id ?? (hqIdsRaw.values().next().value ?? null);

  const lockedCenterChiefSet = new Set(
    membersRaw
      .filter((m) => Boolean((m as { lock_center_chief_promotion?: boolean }).lock_center_chief_promotion))
      .map((m) => m.id),
  );

  const dedupedEdges = treeRowsBase.map((r) => ({
    parent_id: r.parent_id,
    child_id: r.id,
  }));

  let treeRows: OrgTreeRow[] = treeRowsBase;

  {
    const externalIdByMemberId = new Map<string, string | null>();
    for (const m of membersRaw) {
      externalIdByMemberId.set(m.id, (m.external_id ?? null) as string | null);
    }

    const joinAttributedForThreshold: AttributedJoinContractRow[] = rawContractRows
      .filter((c) => (c.sales_link_status ?? 'linked') === 'linked')
      .filter((c) => !c.is_cancelled)
      .filter((c) =>
        isContractJoinCompleted({
          status: c.status,
          rental_request_no: c.rental_request_no ?? null,
          invoice_no: c.invoice_no ?? null,
          memo: c.memo ?? null,
        }),
      )
      .map((c) => ({
        id: c.id,
        join_date: String(c.join_date ?? '').slice(0, 10),
        unit_count: c.unit_count ?? 0,
        sales_member_id: resolveContractSalesMemberId({
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
        created_at: c.created_at ?? null,
        happy_call_at: c.happy_call_at ?? null,
        invoice_registered_at: c.invoice_registered_at ?? null,
      }));

    const promotionThresholdByMemberId = computeLeaderPromotionThresholds(
      treeRowsBase,
      joinAttributedForThreshold,
      membersRaw.map((m) => ({
        id: m.id,
        rank: m.rank as RankType,
        external_id: (m.external_id ?? null) as string | null,
      })),
    );

    const rankByIdRaw = new Map<string, string>();
    for (const m of members) rankByIdRaw.set(m.id, String(m.rank));

    treeRows = treeRowsBase.map((r) => {
      if (r.rank === '본사') return r;
      if (isCustomerVirtualOrgMember(externalIdByMemberId.get(r.id))) return r;
      const th = promotionThresholdByMemberId.get(r.id) ?? null;
      if (!th) return r;
      if ((rankByIdRaw.get(r.id) ?? '') !== '영업사원') return r;
      return { ...r, rank: '리더' as RankType };
    });

    {
      const rankByIdForCenterChief = new Map<string, RankType>();
      for (const r of treeRows) rankByIdForCenterChief.set(r.id, r.rank as RankType);
      const toDemoteDisplay = computeCenterChiefDemotionMemberIds(
        treeRows,
        rankByIdForCenterChief,
        externalIdByMemberId,
      ).filter((id) => !lockedCenterChiefSet.has(String(id)));
      if (toDemoteDisplay.length > 0) {
        const demoteSet = new Set(toDemoteDisplay);
        treeRows = treeRows.map((r) =>
          demoteSet.has(r.id) && r.rank === '센터장' ? { ...r, rank: '리더' as RankType } : r,
        );
        for (const id of toDemoteDisplay) rankByIdForCenterChief.set(id, '리더');
      }
      const toCenterChiefIds = computeCenterChiefPromotionMemberIds(
        treeRows,
        rankByIdForCenterChief,
        externalIdByMemberId,
      ).filter((id) => !lockedCenterChiefSet.has(String(id)));
      if (toCenterChiefIds.length > 0) {
        const centerChiefSet = new Set(toCenterChiefIds);
        treeRows = treeRows.map((r) =>
          centerChiefSet.has(r.id) ? { ...r, rank: '센터장' as RankType } : r,
        );
      }
    }
  }

  const tree = buildOrgTree(treeRows);

  const salesMemberDisplayName = (salesMemberId: string | null | undefined): string => {
    const id = remapMemberId(String(salesMemberId ?? ''));
    if (!id) return '-';
    return memberNameById.get(id) ?? '-';
  };

  return {
    members,
    dedupedEdges,
    treeRows,
    tree,
    hqIdForTree,
    remapMemberId,
    resolveContractSalesMemberId,
    remapCustomerMemberId,
    salesMemberDisplayName,
  };
}
