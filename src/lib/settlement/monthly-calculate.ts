import { getSettlementWindowForYearMonth } from '@/lib/settlement/settlement-window';
import {
  calculateMemberSettlement,
  buildOrgTree,
  type LeaderSettlementOpts,
} from '@/lib/settlement/calculator';
import { buildSettlementTreeRows } from '@/lib/settlement/settlement-org-tree';
import {
  computeLeaderPromotionThresholds,
  mergeLeaderPromotionEventThresholds,
  type AttributedJoinContractRow,
  isContractStrictlyAfterPromotionThreshold,
} from '@/lib/settlement/leader-promotion';
import type { Contract, OrganizationMember, SettlementRule } from '@/lib/types';
import type { RankType } from '@/lib/types/organization';
import type { GroupBonusContractInput } from '@/lib/settlement/group-bonus';
import {
  evaluateContractEligibility,
  computeNextYearMonth,
  happycallYmdSeoul,
  SETTLEMENT_VALID_HAPPYCALL_RESULTS,
  SETTLEMENT_CANCELLED_HAPPYCALL_RESULTS,
} from '@/lib/settlement/settlement-eligibility-v2';
import { resolveHappycallEligibilityFields } from '@/lib/settlement/galaxy-care-mu';

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

  // === 정산 v2 (2026-06 기준) ===
  // 기존 v_contract_settlement_base 뷰(join_date 기반) 대신 contracts 직접 조회 후
  // 새 판정(해피콜 결과/일시 + 송장번호 + 수동/자동 이월)을 적용한다.
  // 뷰 자체는 조직도/대시보드 등 다른 화면 호환을 위해 보존한다.
  const { data: allContractRowsRaw, error: cErr } = await db
    .from('contracts')
    .select(
      [
        'id',
        'contract_code',
        'join_date',
        'unit_count',
        'status',
        'is_cancelled',
        'sales_member_id',
        // 정산용 담당자 override: 있으면 우선 사용. TY 동기화는 절대 덮어쓰지 않는다.
        'settlement_sales_member_id',
        'sales_link_status',
        'happy_call_at',
        'happycall_result',
        'product_type',
        'item_name',
        'source_snapshot_json',
        'invoice_no',
        'invoice_registered_at',
        'rental_request_no',
        'item_name',
        'created_at',
        'customer_id',
        'settlement_deferred',
        'deferred_from_month',
        'deferred_to_month',
        'settlement_status',
      ].join(', '),
    );
  if (cErr) throw new Error(`계약 조회 실패: ${cErr.message}`);

  // 정산 v2: contract row 의 sales_member_id 자리에 항상 effective 값을 넣어둔다.
  // - settlement_sales_member_id 가 있으면 그 값
  // - 없으면 원래 sales_member_id
  // 원본 sales_member_id 는 `original_sales_member_id` 로 따로 보존(필요한 곳에서 참조 가능).
  const allContractRows: any[] = ((allContractRowsRaw ?? []) as any[]).map((r) => {
    const override = (r.settlement_sales_member_id ?? null) as string | null;
    const original = (r.sales_member_id ?? null) as string | null;
    const effective = override ?? original;
    return {
      ...r,
      original_sales_member_id: original,
      sales_member_id: effective,
    };
  });

  // 정산 후보 / 이월 / 제외 판정
  const eligibleContractRows: any[] = [];
  const deferredContractIds: string[] = [];
  let excludedCountForDebug = 0;
  for (const r of (allContractRows ?? []) as any[]) {
    const decision = evaluateContractEligibility(
      {
        id: String(r.id ?? ''),
        status: String(r.status ?? ''),
        is_cancelled: Boolean(r.is_cancelled ?? false),
        sales_member_id: (r.sales_member_id ?? null) as string | null,
        sales_link_status: (r.sales_link_status ?? null) as string | null,
        happy_call_at: r.happy_call_at ?? null,
        happycall_result: (r.happycall_result ?? null) as string | null,
        product_type: (r.product_type ?? null) as string | null,
        item_name: (r.item_name ?? null) as string | null,
        source_snapshot_json: (r.source_snapshot_json ?? null) as Record<string, string | null> | null,
        invoice_no: (r.invoice_no ?? null) as string | null,
        invoice_registered_at: r.invoice_registered_at ?? null,
        settlement_deferred: (r.settlement_deferred ?? false) as boolean | null,
        deferred_to_month: (r.deferred_to_month ?? null) as string | null,
      },
      yearMonth,
    );
    if (decision.result === 'ELIGIBLE') {
      eligibleContractRows.push(r);
    } else if (decision.result === 'DEFERRED') {
      deferredContractIds.push(String(r.id));
    } else {
      excludedCountForDebug++;
    }
  }

  // 이월 / 확정 DB 기록.
  // - DEFERRED: 다음 정산월로 자동 이월 표시
  // - ELIGIBLE: settlement_status='ELIGIBLE_CONFIRMED' 만 갱신 (deferred_* 컬럼은 보존)
  // - EXCLUDED: 자동 손대지 않음 (취소/해약 흐름은 status 기반으로 충분)
  // 실패해도 정산 자체는 진행되도록 try/catch.
  const nextYm = computeNextYearMonth(yearMonth);
  if (deferredContractIds.length > 0) {
    try {
      const { error: defErr } = await db
        .from('contracts')
        .update({
          settlement_deferred: true,
          deferred_from_month: yearMonth,
          deferred_to_month: nextYm,
          deferred_reason: 'invoice_missing',
          settlement_status: 'DEFERRED_TO_NEXT_MONTH',
        })
        .in('id', deferredContractIds);
      if (defErr && debug) {
        // eslint-disable-next-line no-console
        console.warn('[settlement-debug] deferred update error', defErr);
      }
    } catch (e) {
      if (debug) {
        // eslint-disable-next-line no-console
        console.warn('[settlement-debug] deferred update threw', e);
      }
    }
  }
  const eligibleIds = eligibleContractRows.map((r) => String(r.id));
  if (eligibleIds.length > 0) {
    try {
      const { error: eliErr } = await db
        .from('contracts')
        .update({ settlement_status: 'ELIGIBLE_CONFIRMED' })
        .in('id', eligibleIds);
      if (eliErr && debug) {
        // eslint-disable-next-line no-console
        console.warn('[settlement-debug] eligible update error', eliErr);
      }
    } catch (e) {
      if (debug) {
        // eslint-disable-next-line no-console
        console.warn('[settlement-debug] eligible update threw', e);
      }
    }
  }

  if (debug) {
    // eslint-disable-next-line no-console
    console.log('[settlement-debug] monthly-calculate start', {
      yearMonth,
      settlementWindowEnd: end_date,
      totalContracts: (allContractRows ?? []).length,
      eligible: eligibleContractRows.length,
      deferred: deferredContractIds.length,
      excluded: excludedCountForDebug,
    });
  }

  const normalizedContractsBase = eligibleContractRows.map((r) => ({
    id: String(r.id ?? ''),
    contract_code: String(r.contract_code ?? ''),
    join_date: String(r.join_date ?? '').slice(0, 10),
    unit_count: Number(r.unit_count ?? 0),
    status: String(r.status ?? ''),
    is_cancelled: Boolean(r.is_cancelled ?? false),
    sales_member_id: (r.sales_member_id ?? null) as string | null,
    happy_call_at: (r.happy_call_at ?? null) as string | null,
    created_at: (r.created_at ?? null) as string | null,
  }));

  const itemNameByContractId = new Map<string, string | null>();
  const createdAtByContractId = new Map<string, string | null>();
  const customerIdByContractId = new Map<string, string | null>();
  // 그룹 보너스 해피콜 조건(happy_call_at <= 2026-06-12, result in {성공,완료,계약변경}) 판정용
  const happyCallAtByContractId = new Map<string, string | null>();
  const happycallResultByContractId = new Map<string, string | null>();
  for (const r of eligibleContractRows) {
    if (!r?.id) continue;
    const id = String(r.id);
    itemNameByContractId.set(id, (r.item_name ?? null) as string | null);
    createdAtByContractId.set(id, (r.created_at ?? null) as string | null);
    customerIdByContractId.set(id, (r.customer_id ?? null) as string | null);
    happyCallAtByContractId.set(id, (r.happy_call_at ?? null) as string | null);
    happycallResultByContractId.set(id, (r.happycall_result ?? null) as string | null);
  }

  // 그룹 보너스 산정용 고객명 맵 (2구좌당 5만원, 가입일+고객명+담당사원 그룹화)
  const customerIds = [...new Set([...customerIdByContractId.values()].filter((v): v is string => !!v))];
  const customerNameById = new Map<string, string>();
  if (customerIds.length > 0) {
    const { data: customerRows, error: cuErr } = await db
      .from('customers')
      .select('id, name')
      .in('id', customerIds);
    if (cuErr) throw new Error(`customers(name) 조회 실패: ${cuErr.message}`);
    for (const r of (customerRows ?? []) as any[]) {
      if (!r?.id) continue;
      customerNameById.set(String(r.id), String(r.name ?? '').trim());
    }
  }

  const { data: rules, error: rErr } = await db.from('settlement_rules').select('*');
  if (rErr) throw new Error(`정산 규칙 조회 실패: ${rErr.message}`);

  const [membersRes, edgesRes] = await Promise.all([
    db
      .from('organization_members')
      .select('id, name, rank, external_id, phone, source_customer_id, leader_rank_effective_at')
      .eq('is_active', true),
    db.from('organization_edges').select('parent_id, child_id'),
  ]);
  if (membersRes.error) throw new Error(`조직원 조회 실패: ${membersRes.error.message}`);

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

  // 리더 승격(20구좌) / 오버라이드 가입 순서 계산용 가입 인정 계약 집합.
  // - 정산 v2: status='가입' 이 아니어도 해피콜 결과(성공/완료/계약변경)면 가입 인정.
  // - 송장 미충족(=이월) 건도 가입 인정에는 포함 — 수당만 다음 월로 미뤄지는 것이지 가입 자체는 인정.
  // - 정렬·승격 전/후 판정 키: 해피콜 완료일(서울 YMD) 우선, 없으면 join_date.
  const joinAttributed: AttributedJoinContractRow[] = [];
  for (const row of (allContractRows ?? []) as any[]) {
    if (row.is_cancelled) continue;
    const st = String(row.status ?? '');
    if (st === '취소' || st === '해약' || st === '계약취소') continue;
    if (!row.sales_member_id) continue;
    if ((row.sales_link_status ?? 'linked') !== 'linked') continue;
    const { result: hcResult, ymd: hcYmdFromFields } = resolveHappycallEligibilityFields(
      row.happy_call_at,
      row.happycall_result,
    );
    if (SETTLEMENT_CANCELLED_HAPPYCALL_RESULTS.has(hcResult)) continue;
    if (!SETTLEMENT_VALID_HAPPYCALL_RESULTS.has(hcResult)) continue;
    const sid = row.sales_member_id as string;
    const hcYmd = hcYmdFromFields || happycallYmdSeoul(row.happy_call_at);
    joinAttributed.push({
      id: row.id,
      join_date: String(row.join_date ?? '').slice(0, 10),
      unit_count: row.unit_count ?? 0,
      sales_member_id: sid,
      created_at: (row.created_at ?? null) as string | null,
      happy_call_at: hcYmd || (row.happy_call_at ?? null),
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

  const promotionThresholdByMemberId = computeLeaderPromotionThresholds(
    treeRows,
    joinAttributed,
    (membersRaw as OrganizationMember[]).map((m) => ({
      id: m.id,
      rank: m.rank as RankType,
      external_id: m.external_id ?? null,
    })),
  );

  const eventRowsWithThreshold = ((promoEvents ?? []) as any[]).filter(
    (r) => r?.member_id && r?.threshold_contract_id && r?.threshold_join_date,
  );
  const thresholdContractIds = [
    ...new Set(eventRowsWithThreshold.map((r) => String(r.threshold_contract_id))),
  ];
  const thresholdContractMetaById = new Map<
    string,
    { join_date: string; happy_call_at?: string | null; created_at?: string | null }
  >();
  if (thresholdContractIds.length > 0) {
    const { data: thContractRows, error: thCErr } = await db
      .from('contracts')
      .select('id, created_at, join_date, happy_call_at')
      .in('id', thresholdContractIds);
    if (thCErr) throw new Error(`승격 계약(created_at) 조회 실패: ${thCErr.message}`);
    for (const row of (thContractRows ?? []) as any[]) {
      if (!row?.id) continue;
      thresholdContractMetaById.set(String(row.id), {
        join_date: String(row.join_date ?? '').slice(0, 10),
        happy_call_at: (row.happy_call_at ?? null) as string | null,
        created_at: (row.created_at ?? null) as string | null,
      });
    }
  }
  mergeLeaderPromotionEventThresholds(
    promotionThresholdByMemberId,
    (promoEvents ?? []) as any[],
    thresholdContractMetaById,
  );

  const leaderRankEffectiveAtByMemberId = new Map<string, string | null>();
  for (const m of membersRaw as OrganizationMember[]) {
    const at = m.leader_rank_effective_at;
    if (at != null && String(at).trim() !== '') {
      leaderRankEffectiveAtByMemberId.set(m.id, String(at).trim());
    }
  }

  // 2026-06 한정 그룹 보너스 입력: 정산 대상 계약 + 고객명을 묶어 전달.
  // - 그룹 보너스는 group-bonus.ts에서 sales_member_id, join_date, customer_name으로 그룹화.
  // - 해약은 제외(가입 인정 계약 기준).
  const groupBonusContracts: GroupBonusContractInput[] = [];
  for (const c of normalizedContractsBase) {
    if (!c.sales_member_id) continue;
    if (c.is_cancelled) continue;
    const cid = customerIdByContractId.get(c.id) ?? null;
    const customerName = cid ? customerNameById.get(cid) ?? '' : '';
    if (!customerName) continue;
    groupBonusContracts.push({
      join_date: c.join_date,
      customer_name: customerName,
      sales_member_id: c.sales_member_id,
      unit_count: c.unit_count,
      happy_call_at: happyCallAtByContractId.get(c.id) ?? null,
      happycall_result: happycallResultByContractId.get(c.id) ?? null,
    });
  }

  const leaderOpts: LeaderSettlementOpts = {
    treeRows,
    promotionThresholdByMemberId,
    joinOnlyAttributed: joinAttributed,
    settlementEndDate: end_date,
    leaderMaintenanceBonusAlreadyPaidByMemberId: leaderMaintBlockByMemberId,
    previousLeaderByPromotedMemberId: prevLeaderByPromotedMemberId,
    leaderRankEffectiveAtByMemberId,
    groupBonusContracts,
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
      !isContractStrictlyAfterPromotionThreshold(
        {
          id: c.id,
          join_date: c.join_date,
          happy_call_at: (c as { happy_call_at?: string | null }).happy_call_at ?? null,
          created_at: cCreated,
        },
        th,
      )
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

