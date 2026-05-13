import { getSettlementWindowForYearMonth } from '@/lib/settlement/settlement-window';
import {
  calculateMemberSettlement,
  buildOrgTree,
  type LeaderSettlementOpts,
} from '@/lib/settlement/calculator';
import { buildSettlementTreeRows } from '@/lib/settlement/settlement-org-tree';
import {
  computeSalesMemberPromotionThreshold,
  mergeLeaderPromotionEventThresholds,
  type AttributedJoinContractRow,
  isContractStrictlyAfterPromotionThreshold,
} from '@/lib/settlement/leader-promotion';
import type { Contract, OrganizationMember, SettlementRule } from '@/lib/types';
import type { RankType } from '@/lib/types/organization';

function isSettlementDebugEnabled(): boolean {
  const v = process.env.SETTLEMENT_DEBUG;
  return v === '1' || v === 'true' || v === 'yes';
}

export async function calculateMonthlySettlement(params: {
  yearMonth: string;
  db: any;
}): Promise<{ updated_count: number }> {
  const { yearMonth, db } = params;
  const debug = isSettlementDebugEnabled();
  const { end_date } = getSettlementWindowForYearMonth(yearMonth);

  const { data: contracts, error: cErr } = await db
    .from('v_contract_settlement_base')
    .select('*')
    .eq('year_month', yearMonth);
  if (cErr) throw new Error(`계약 조회 실패: ${cErr.message}`);

  if (debug) {
    // eslint-disable-next-line no-console
    console.log('[settlement-debug] monthly-calculate start', {
      yearMonth,
      settlementWindowEnd: end_date,
      contractsInMonth: (contracts ?? []).length,
    });
  }

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
    .select('id, item_name, created_at')
    .in('id', contractIds);
  if (ccErr) throw new Error(`contracts(item_name) 조회 실패: ${ccErr.message}`);

  const itemNameByContractId = new Map<string, string | null>();
  const createdAtByContractId = new Map<string, string | null>();
  for (const r of (contractCustomerRows ?? []) as any[]) {
    if (!r?.id) continue;
    const id = String(r.id);
    itemNameByContractId.set(id, (r.item_name ?? null) as string | null);
    createdAtByContractId.set(id, (r.created_at ?? null) as string | null);
  }

  const { data: rules, error: rErr } = await db.from('settlement_rules').select('*');
  if (rErr) throw new Error(`정산 규칙 조회 실패: ${rErr.message}`);

  const [membersRes, edgesRes, joinContractsRes] = await Promise.all([
    db
      .from('organization_members')
      .select('id, name, rank, external_id, phone, source_customer_id, leader_rank_effective_at')
      .eq('is_active', true),
    db.from('organization_edges').select('parent_id, child_id'),
    db
      .from('contracts')
      .select(
        'id, join_date, unit_count, sales_member_id, sales_link_status, status, is_cancelled, created_at',
      )
      .eq('status', '가입')
      .eq('is_cancelled', false),
  ]);
  if (membersRes.error) throw new Error(`조직원 조회 실패: ${membersRes.error.message}`);
  if (joinContractsRes.error) throw new Error(`가입 계약 조회 실패: ${joinContractsRes.error.message}`);

  const membersRaw = ((membersRes.data ?? []) as unknown as OrganizationMember[]).map((m) =>
    m.name === '안성준' ? { ...m, rank: '본사' as const } : m,
  );

  if (debug) {
    const leaderIds = (membersRaw as OrganizationMember[]).filter((m) => m.rank === '리더').map((m) => m.id);
    // eslint-disable-next-line no-console
    console.log('[settlement-debug] members loaded', {
      yearMonth,
      activeMembers: membersRaw.length,
      dbRankLeaderCount: leaderIds.length,
    });
  }
  const edgesRaw = (edgesRes.data ?? []) as Array<{ parent_id: string | null; child_id: string }>;

  // 월정산 직접 계약 귀속은 v_contract_settlement_base의 sales_member_id와 동일하게 둔다.
  // customer_id → 조직원 치환을 하면 Supabase 뷰와 정산 결과가 어긋날 수 있다.
  const normalizedContracts = normalizedContractsBase.map((c) => {
    const item_name = itemNameByContractId.get(c.id) ?? null;
    const created_at = createdAtByContractId.get(c.id) ?? null;
    return { ...c, item_name, created_at };
  });

  const joinAttributed: AttributedJoinContractRow[] = [];
  for (const row of (joinContractsRes.data ?? []) as any[]) {
    if ((row.sales_link_status ?? 'linked') !== 'linked') continue;
    if (!row.sales_member_id) continue;
    const sid = row.sales_member_id as string;
    joinAttributed.push({
      id: row.id,
      join_date: String(row.join_date ?? '').slice(0, 10),
      unit_count: row.unit_count ?? 0,
      sales_member_id: sid,
      created_at: (row.created_at ?? null) as string | null,
    });
  }

  const treeRows = buildSettlementTreeRows(
    membersRaw as Array<{ id: string; name: string; rank: RankType; source_customer_id?: string | null }>,
    edgesRaw,
  );

  const { data: promoEvents } = await db
    .from('leader_promotion_events')
    .select(
      'member_id, previous_parent_id, leader_maintenance_bonus_paid_year_month, threshold_contract_id, threshold_join_date',
    );
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
    // 산하 20구좌 승격 계약(threshold) 계산: DB가 이미 '리더'여도 동일 기준으로 누적을 잡는다.
    // (leader_promotion_events 없이도 리더 직전 계약=30만·롤업 차액 반영 가능)
    if (r === '리더') rankById.set(m.id as string, '영업사원');
    else rankById.set(m.id as string, r);
  }

  const promotionThresholdByMemberId = computeSalesMemberPromotionThreshold(treeRows, joinAttributed, rankById);

  const eventRowsWithThreshold = ((promoEvents ?? []) as any[]).filter(
    (r) => r?.member_id && r?.threshold_contract_id && r?.threshold_join_date,
  );
  const thresholdContractIds = [
    ...new Set(eventRowsWithThreshold.map((r) => String(r.threshold_contract_id))),
  ];
  const thresholdCreatedAtByContractId = new Map<string, string | null>();
  if (thresholdContractIds.length > 0) {
    const { data: thContractRows, error: thCErr } = await db
      .from('contracts')
      .select('id, created_at')
      .in('id', thresholdContractIds);
    if (thCErr) throw new Error(`승격 계약(created_at) 조회 실패: ${thCErr.message}`);
    for (const row of (thContractRows ?? []) as any[]) {
      if (!row?.id) continue;
      thresholdCreatedAtByContractId.set(String(row.id), (row.created_at ?? null) as string | null);
    }
  }
  mergeLeaderPromotionEventThresholds(
    promotionThresholdByMemberId,
    (promoEvents ?? []) as any[],
    thresholdCreatedAtByContractId,
  );

  const leaderRankEffectiveAtByMemberId = new Map<string, string | null>();
  for (const m of membersRaw as OrganizationMember[]) {
    const at = m.leader_rank_effective_at;
    if (at != null && String(at).trim() !== '') {
      leaderRankEffectiveAtByMemberId.set(m.id, String(at).trim());
    }
  }

  const leaderOpts: LeaderSettlementOpts = {
    treeRows,
    promotionThresholdByMemberId,
    joinOnlyAttributed: joinAttributed,
    settlementEndDate: end_date,
    leaderMaintenanceBonusAlreadyPaidByMemberId: leaderMaintBlockByMemberId,
    previousLeaderByPromotedMemberId: prevLeaderByPromotedMemberId,
    leaderRankEffectiveAtByMemberId,
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
    const cCreated = (c as { created_at?: string | null }).created_at ?? null;
    const dbRankOrigin = rankByIdRaw.get(origin) ?? null;
    // 승격 전 계약을 '상위 리더 직접'으로 귀속하는 것은 DB 영업사원일 때만(기존 정책).
    // DB 리더의 승격 전 계약은 본인에게 두고 단가만 30만으로 계산한다.
    if (
      dbRankOrigin === '영업사원' &&
      th &&
      !isContractStrictlyAfterPromotionThreshold(c.join_date, c.id, th, cCreated)
    ) {
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

    // 디버그(원인 파악용): 리더 기본수당이 30만원으로 떨어지는 케이스를 추적하기 위한 로그.
    // - SETTLEMENT_DEBUG=1|true|yes 일 때 출력.
    // - DB rank가 리더인 모든 멤버에 대해 1줄(직접 실적 0 포함): Vercel에서 "invoked만 보인다" 혼동 방지.
    if (debug && member.rank === '리더') {
      const du = settlement.direct_unit_count ?? 0;
      const perUnitApprox = du > 0 ? Math.round(settlement.base_commission / du) : null;
      // eslint-disable-next-line no-console
      console.log('[settlement-debug] leader line', {
        yearMonth,
        memberId: member.id,
        memberName: (member.name ?? '').replace(/^\[고객\]\s*/, ''),
        dbRank: member.rank,
        directUnitCount: du,
        baseCommission: settlement.base_commission,
        perUnitApprox,
      });
    }

    const { error: uErr } = await db.from('monthly_settlements').upsert(settlement, { onConflict: 'year_month,member_id' });
    if (!uErr) updatedCount++;
  }

  if (debug) {
    // eslint-disable-next-line no-console
    console.log('[settlement-debug] monthly-calculate done', { yearMonth, updated_count: updatedCount });
  }

  return { updated_count: updatedCount };
}

