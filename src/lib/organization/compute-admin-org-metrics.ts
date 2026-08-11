import type { SupabaseClient } from '@supabase/supabase-js';
import { calculateOrgNodeMetrics } from '@/lib/settlement/org-node-metrics';
import { isSettlementEligibleContract } from '@/lib/settlement/settlement-eligibility';
import { isContractJoinCompleted } from '@/lib/utils/contract-display-status';
import {
  getSettlementWindowForYearMonth,
  normalizeYearMonthLabel,
} from '@/lib/settlement/settlement-window';
import {
  buildAdminOrgDisplayContext,
  type AdminOrgRawContractRow,
} from '@/lib/organization/admin-org-display-context';
import type { OrganizationMember } from '@/lib/types';
import type { OrgNodeMetrics } from '@/lib/settlement/org-node-metrics';

export async function computeAdminOrgNodeMetrics(
  db: SupabaseClient,
  yearMonthInput: string,
): Promise<Record<string, OrgNodeMetrics>> {
  const yearMonth = normalizeYearMonthLabel(yearMonthInput) ?? yearMonthInput;
  const { start_date, end_date, label_year_month } = getSettlementWindowForYearMonth(yearMonth);

  const [membersRes, edgesRes, contractsRes, rulesRes, promoEventsRes] = await Promise.all([
    db
      .from('organization_members')
      .select('id, name, rank, external_id, phone, source_customer_id, leader_rank_effective_at, lock_center_chief_promotion')
      .eq('is_active', true)
      .order('name'),
    db.from('organization_edges').select('parent_id, child_id'),
    db
      .from('contracts')
      .select(
        'id, contract_code, join_date, product_type, item_name, rental_request_no, invoice_no, memo, status, unit_count, customer_id, sales_member_id, is_cancelled, sales_link_status, happy_call_at, happycall_result, source_snapshot_json, created_at, invoice_registered_at, sequence_no, customers(name, phone, birth_date)',
      )
      .not('sales_member_id', 'is', null)
      .order('join_date', { ascending: false })
      .limit(20000),
    db.from('settlement_rules').select('*'),
    db
      .from('leader_promotion_events')
      .select(
        'member_id, previous_parent_id, leader_maintenance_bonus_paid_year_month, threshold_contract_id, threshold_join_date',
      ),
  ]);

  const membersRaw = ((membersRes.data ?? []) as unknown as OrganizationMember[]).map((m) =>
    m.name === '안성준' ? { ...m, rank: '본사' as const } : m,
  );
  const rawContractRows = (contractsRes.data ?? []) as unknown as AdminOrgRawContractRow[];
  const customerBirthDateById = new Map<string, string | null>();
  const sourceCustomerIds = [
    ...new Set(
      ((membersRes.data ?? []) as Array<{ source_customer_id?: string | null }>)
        .map((m) => m.source_customer_id ?? null)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (sourceCustomerIds.length > 0) {
    const { data: customerRows, error: customerErr } = await db
      .from('customers')
      .select('id, birth_date')
      .in('id', sourceCustomerIds);
    if (customerErr) throw new Error(customerErr.message);
    for (const row of (customerRows ?? []) as Array<{ id: string; birth_date: string | null }>) {
      customerBirthDateById.set(row.id, row.birth_date);
    }
  }

  const ctx = buildAdminOrgDisplayContext({
    membersRaw,
    edgesRaw: edgesRes.data ?? [],
    rawContractRows,
    customerBirthDateById,
  });

  const kpiEligibleForMetrics = rawContractRows
    .filter(isSettlementEligibleContract)
    .map((c) => ({
      contract_id: c.id,
      join_date: c.join_date ?? '',
      unit_count: c.unit_count ?? 0,
      status: c.status,
      item_name: c.item_name ?? null,
      product_type: c.product_type ?? null,
      customer_id: c.customer_id,
      sales_member_id: ctx.resolveSettlementWalkSalesMemberId({
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
      }),
      created_at: c.created_at ?? null,
      happy_call_at: c.happy_call_at ?? null,
      invoice_registered_at: c.invoice_registered_at ?? null,
      sequence_no: (c as { sequence_no?: number | null }).sequence_no ?? null,
    }));

  const prevLeaderByPromotedMemberId = new Map<string, string | null>();
  const leaderMaintBlockByMemberId = new Map<string, boolean>();
  const policyPromotedMemberIdSet = new Set<string>();
  for (const r of (promoEventsRes.data ?? []) as any[]) {
    const mid = r.member_id as string;
    policyPromotedMemberIdSet.add(mid);
    prevLeaderByPromotedMemberId.set(mid, (r.previous_parent_id ?? null) as string | null);
    const paidYm = (r.leader_maintenance_bonus_paid_year_month ?? null) as string | null;
    leaderMaintBlockByMemberId.set(mid, paidYm != null && paidYm !== label_year_month);
  }

  const thresholdPromoContractIds = [
    ...new Set(
      ((promoEventsRes.data ?? []) as any[])
        .filter((r) => r?.threshold_contract_id && r?.threshold_join_date)
        .map((r) => String(r.threshold_contract_id)),
    ),
  ];
  const leaderPromotionThresholdContractMetaById = new Map<
    string,
    {
      join_date: string;
      happy_call_at?: string | null;
      sequence_no?: number | null;
      created_at?: string | null;
    }
  >();
  if (thresholdPromoContractIds.length > 0) {
    const { data: thContractRows } = await db
      .from('contracts')
      .select('id, created_at, join_date, happy_call_at, sequence_no')
      .in('id', thresholdPromoContractIds);
    for (const row of (thContractRows ?? []) as any[]) {
      if (!row?.id) continue;
      leaderPromotionThresholdContractMetaById.set(String(row.id), {
        join_date: String(row.join_date ?? '').slice(0, 10),
        happy_call_at: (row.happy_call_at ?? null) as string | null,
        sequence_no: (row.sequence_no ?? null) as number | null,
        created_at: (row.created_at ?? null) as string | null,
      });
    }
  }

  const effectiveRankById = new Map<string, string>();
  for (const r of ctx.treeRows) effectiveRankById.set(r.id, r.rank);

  return calculateOrgNodeMetrics({
    roots: ctx.tree,
    members: ctx.members.map((m) => ({
      id: m.id,
      rank: (effectiveRankById.get(m.id) ?? m.rank) as OrganizationMember['rank'],
      leader_rank_effective_at: m.leader_rank_effective_at ?? undefined,
    })),
    edges: ctx.dedupedEdges,
    treeRows: ctx.treeRows,
    previousLeaderByPromotedMemberId: prevLeaderByPromotedMemberId,
    hqId: ctx.hqIdForTree,
    leaderMaintenanceBonusBlockedByMemberId: leaderMaintBlockByMemberId,
    policyPromotedMemberIdSet,
    attributeCommissionToTopLineUnderHq: false,
    contracts: kpiEligibleForMetrics,
    rules: (rulesRes.data ?? []) as any[],
    settlementWindow: { start_date, end_date, label_year_month },
    leaderPromotionEventsForThreshold: (promoEventsRes.data ?? []) as any[],
    leaderPromotionThresholdContractMetaById,
  });
}
