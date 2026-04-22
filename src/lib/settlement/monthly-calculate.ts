import { getSettlementWindowForYearMonth } from '@/lib/settlement/settlement-window';
import {
  calculateMemberSettlement,
  buildOrgTree,
  type LeaderSettlementOpts,
} from '@/lib/settlement/calculator';
import { buildSettlementTreeRows } from '@/lib/settlement/settlement-org-tree';
import {
  computeSalesMemberPromotionThreshold,
  type AttributedJoinContractRow,
  isContractStrictlyAfterPromotionThreshold,
} from '@/lib/settlement/leader-promotion';
import type { Contract, OrganizationMember, SettlementRule } from '@/lib/types';
import type { RankType } from '@/lib/types/organization';

export async function calculateMonthlySettlement(params: {
  yearMonth: string;
  db: any;
}): Promise<{ updated_count: number }> {
  const { yearMonth, db } = params;
  const { end_date } = getSettlementWindowForYearMonth(yearMonth);

  const { data: contracts, error: cErr } = await db
    .from('v_contract_settlement_base')
    .select('*')
    .eq('year_month', yearMonth);
  if (cErr) throw new Error(`계약 조회 실패: ${cErr.message}`);

  const normalizedContractsBase = ((contracts ?? []) as any[]).map((r) => ({
    id: String(r.contract_id ?? ''),
    contract_code: String(r.contract_code ?? ''),
    join_date: String(r.join_date ?? '').slice(0, 10),
    unit_count: Number(r.unit_count ?? 0),
    status: String(r.status ?? ''),
    is_cancelled: Boolean(r.is_cancelled ?? false),
    sales_member_id: (r.sales_member_id ?? null) as string | null,
  }));

  const contractIds = normalizedContractsBase.map((c) => c.id).filter(Boolean);
  const { data: contractCustomerRows, error: ccErr } = await db
    .from('contracts')
    .select('id, customer_id, item_name')
    .in('id', contractIds);
  if (ccErr) throw new Error(`contracts(customer_id, item_name) 조회 실패: ${ccErr.message}`);

  const customerIdByContractId = new Map<string, string>();
  const itemNameByContractId = new Map<string, string | null>();
  for (const r of (contractCustomerRows ?? []) as any[]) {
    if (!r?.id) continue;
    const id = String(r.id);
    itemNameByContractId.set(id, (r.item_name ?? null) as string | null);
    if (r.customer_id) customerIdByContractId.set(id, String(r.customer_id));
  }

  const { data: rules, error: rErr } = await db.from('settlement_rules').select('*');
  if (rErr) throw new Error(`정산 규칙 조회 실패: ${rErr.message}`);

  const [membersRes, edgesRes, joinContractsRes] = await Promise.all([
    db
      .from('organization_members')
      .select('id, name, rank, external_id, phone, source_customer_id')
      .eq('is_active', true),
    db.from('organization_edges').select('parent_id, child_id'),
    db
      .from('contracts')
      .select('id, join_date, unit_count, sales_member_id, customer_id, sales_link_status, status, is_cancelled')
      .eq('status', '가입')
      .eq('is_cancelled', false),
  ]);
  if (membersRes.error) throw new Error(`조직원 조회 실패: ${membersRes.error.message}`);
  if (joinContractsRes.error) throw new Error(`가입 계약 조회 실패: ${joinContractsRes.error.message}`);

  const membersRaw = ((membersRes.data ?? []) as unknown as OrganizationMember[]).map((m) =>
    m.name === '안성준' ? { ...m, rank: '본사' as const } : m,
  );
  const edgesRaw = (edgesRes.data ?? []) as Array<{ parent_id: string | null; child_id: string }>;

  const memberIdByCustomerId = new Map<string, string>();
  for (const m of membersRaw as any[]) {
    const sid = (m.source_customer_id ?? null) as string | null;
    if (sid && m.rank !== '본사') {
      memberIdByCustomerId.set(sid, m.id as string);
      continue;
    }
    const ext = (m.external_id ?? null) as string | null;
    if (ext && ext.startsWith('customer:') && m.rank !== '본사') {
      const customerId = ext.slice('customer:'.length);
      if (!memberIdByCustomerId.has(customerId)) memberIdByCustomerId.set(customerId, m.id as string);
    }
  }

  const normalizedContracts = normalizedContractsBase.map((c) => {
    const item_name = itemNameByContractId.get(c.id) ?? null;
    const withMeta = { ...c, item_name };
    const customerId = customerIdByContractId.get(c.id) ?? null;
    if (customerId) {
      const mapped = memberIdByCustomerId.get(customerId) ?? null;
      if (mapped) return { ...withMeta, sales_member_id: mapped };
    }
    return withMeta;
  });

  const joinAttributed: AttributedJoinContractRow[] = [];
  for (const row of (joinContractsRes.data ?? []) as any[]) {
    if ((row.sales_link_status ?? 'linked') !== 'linked') continue;
    if (!row.sales_member_id) continue;
    let sid = row.sales_member_id as string;
    const cid = row.customer_id as string | null;
    if (cid) {
      const mapped = memberIdByCustomerId.get(cid);
      if (mapped) sid = mapped;
    }
    joinAttributed.push({
      id: row.id,
      join_date: String(row.join_date ?? '').slice(0, 10),
      unit_count: row.unit_count ?? 0,
      sales_member_id: sid,
    });
  }

  const treeRows = buildSettlementTreeRows(
    membersRaw as Array<{ id: string; name: string; rank: RankType; source_customer_id?: string | null }>,
    edgesRaw,
  );

  const { data: promoEvents } = await db
    .from('leader_promotion_events')
    .select('member_id, previous_parent_id, leader_maintenance_bonus_paid_year_month');
  const prevParentByMemberId = new Map<string, string | null>();
  const leaderMaintBlockByMemberId = new Map<string, boolean>();
  const prevLeaderByPromotedMemberId = new Map<string, string | null>();
  const policyPromotedLeaderIds = new Set<string>();
  for (const r of (promoEvents ?? []) as any[]) {
    const mid = r.member_id as string;
    policyPromotedLeaderIds.add(mid);
    prevParentByMemberId.set(mid, (r.previous_parent_id ?? null) as string | null);
    prevLeaderByPromotedMemberId.set(mid, (r.previous_parent_id ?? null) as string | null);
    const paidYm = (r.leader_maintenance_bonus_paid_year_month ?? null) as string | null;
    leaderMaintBlockByMemberId.set(mid, paidYm != null && paidYm !== yearMonth);
  }

  const rankById = new Map<string, RankType>();
  for (const m of membersRaw) {
    const r = m.rank as RankType;
    if (r === '리더' && policyPromotedLeaderIds.has(m.id as string)) rankById.set(m.id as string, '영업사원');
    else rankById.set(m.id as string, r);
  }

  const promotionThresholdByMemberId = computeSalesMemberPromotionThreshold(treeRows, joinAttributed, rankById);

  const leaderOpts: LeaderSettlementOpts = {
    treeRows,
    promotionThresholdByMemberId,
    joinOnlyAttributed: joinAttributed,
    settlementEndDate: end_date,
    leaderMaintenanceBonusAlreadyPaidByMemberId: leaderMaintBlockByMemberId,
    previousLeaderByPromotedMemberId: prevLeaderByPromotedMemberId,
  };

  const contractsByMember = new Map<string, Contract[]>();
  for (const c of normalizedContracts as any[]) {
    const origin = (c.sales_member_id ?? null) as string | null;
    if (!origin) continue;
    const arr = contractsByMember.get(origin) ?? [];
    arr.push(c);
    contractsByMember.set(origin, arr);
  }

  const directContractsByMemberForSettlement = new Map<string, Contract[]>();
  const parentByChild = new Map<string, string | null>();
  for (const e of edgesRaw) parentByChild.set(e.child_id, e.parent_id ?? null);
  const rankByIdRaw = new Map<string, RankType>();
  for (const m of membersRaw) rankByIdRaw.set(m.id as string, m.rank as RankType);

  for (const c of normalizedContracts as any[]) {
    const origin = (c.sales_member_id ?? null) as string | null;
    if (!origin) continue;

    let assignTo = origin;
    const th = promotionThresholdByMemberId.get(origin) ?? null;
    if (th && !isContractStrictlyAfterPromotionThreshold(c.join_date, c.id, th)) {
      const recordedPrev = prevParentByMemberId.get(origin) ?? null;
      const parentId = recordedPrev ?? (parentByChild.get(origin) ?? null);
      const parentRank = parentId ? (rankByIdRaw.get(parentId) ?? null) : null;
      if (parentId && parentRank === '리더') {
        assignTo = parentId;
        (c as any).__attributed_origin_member_id = origin;
        (c as any).__attributed_origin_rank = '영업사원';
      }
    }

    const arr = directContractsByMemberForSettlement.get(assignTo) ?? [];
    arr.push(c);
    directContractsByMemberForSettlement.set(assignTo, arr);
  }

  const trees = buildOrgTree(treeRows);
  const nodeById = new Map<string, any>();
  (function indexNodes(nodes: any[]) {
    for (const n of nodes) {
      nodeById.set(n.id, n);
      indexNodes(n.children ?? []);
    }
  })(trees);

  let updatedCount = 0;
  for (const member of membersRaw as OrganizationMember[]) {
    const orgNode = nodeById.get(member.id) ?? null;
    if (!orgNode) continue;
    const settlement = calculateMemberSettlement(
      { id: member.id, name: member.name, rank: member.rank },
      directContractsByMemberForSettlement.get(member.id) ?? [],
      orgNode,
      contractsByMember,
      rules as SettlementRule[],
      yearMonth,
      leaderOpts,
    );
    const { error: uErr } = await db.from('monthly_settlements').upsert(settlement, { onConflict: 'year_month,member_id' });
    if (!uErr) updatedCount++;
  }

  return { updated_count: updatedCount };
}

