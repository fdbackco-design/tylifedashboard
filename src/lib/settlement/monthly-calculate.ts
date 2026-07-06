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
  refreshPromotionThresholdsFromJoinAttributed,
  isPromotionAccumulationJoinContractRow,
  debugPromotionThresholdPath,
  enrichThresholdPrePromotionUnits,
  buildPromotionUnitSplitByMemberIds,
  buildPromotionCommissionWalkForMember,
  LEADER_PROMOTION_MIN_UNITS,
  type AttributedJoinContractRow,
  type LeaderPromotionEventRecord,
  type PromotionEventWalkMismatch,
  type PromotionEventValidation,
  type JoinStatusContractCandidate,
  isContractStrictlyAfterPromotionThreshold,
} from '@/lib/settlement/leader-promotion';
import type { Contract, OrganizationMember, SettlementRule } from '@/lib/types';
import type { RankType } from '@/lib/types/organization';
import type { GroupBonusContractInput } from '@/lib/settlement/group-bonus';
import {
  evaluateContractEligibility,
  computeNextYearMonth,
  happycallYmdSeoul,
} from '@/lib/settlement/settlement-eligibility-v2';

function isSettlementDebugEnabled(): boolean {
  const v = process.env.SETTLEMENT_DEBUG;
  return v === '1' || v === 'true' || v === 'yes';
}

const DB_ID_CHUNK_SIZE = 500;
const SETTLEMENT_UPSERT_BATCH_SIZE = 100;

function chunkIds(ids: string[], size: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
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
        'group_bonus_join_date',
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
      for (const idChunk of chunkIds(deferredContractIds, DB_ID_CHUNK_SIZE)) {
        const { error: defErr } = await db
          .from('contracts')
          .update({
            settlement_deferred: true,
            deferred_from_month: yearMonth,
            deferred_to_month: nextYm,
            deferred_reason: 'invoice_missing',
            settlement_status: 'DEFERRED_TO_NEXT_MONTH',
          })
          .in('id', idChunk);
        if (defErr && debug) {
          // eslint-disable-next-line no-console
          console.warn('[settlement-debug] deferred update error', defErr);
        }
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
      for (const idChunk of chunkIds(eligibleIds, DB_ID_CHUNK_SIZE)) {
        const { error: eliErr } = await db
          .from('contracts')
          .update({ settlement_status: 'ELIGIBLE_CONFIRMED' })
          .in('id', idChunk);
        if (eliErr && debug) {
          // eslint-disable-next-line no-console
          console.warn('[settlement-debug] eligible update error', eliErr);
        }
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
    invoice_registered_at: (r.invoice_registered_at ?? null) as string | null,
  }));

  const itemNameByContractId = new Map<string, string | null>();
  const createdAtByContractId = new Map<string, string | null>();
  const customerIdByContractId = new Map<string, string | null>();
  // 그룹 보너스 해피콜 조건(happy_call_at <= 2026-06-12, result in {성공,완료,계약변경}) 판정용
  const invoiceRegisteredAtByContractId = new Map<string, string | null>();
  const happyCallAtByContractId = new Map<string, string | null>();
  const happycallResultByContractId = new Map<string, string | null>();
  const groupBonusJoinDateByContractId = new Map<string, string | null>();
  for (const r of eligibleContractRows) {
    if (!r?.id) continue;
    const id = String(r.id);
    itemNameByContractId.set(id, (r.item_name ?? null) as string | null);
    createdAtByContractId.set(id, (r.created_at ?? null) as string | null);
    invoiceRegisteredAtByContractId.set(id, (r.invoice_registered_at ?? null) as string | null);
    customerIdByContractId.set(id, (r.customer_id ?? null) as string | null);
    happyCallAtByContractId.set(id, (r.happy_call_at ?? null) as string | null);
    happycallResultByContractId.set(id, (r.happycall_result ?? null) as string | null);
    const gbjd = (r as { group_bonus_join_date?: string | null }).group_bonus_join_date ?? null;
    if (gbjd != null && String(gbjd).trim() !== '') {
      groupBonusJoinDateByContractId.set(id, String(gbjd).slice(0, 10));
    }
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
    const invoice_registered_at = invoiceRegisteredAtByContractId.get(c.id) ?? null;
    return { ...c, item_name, created_at, invoice_registered_at };
  });

  // 리더 승격(20구좌) walk: 가입 인정 계약만 누적.
  // - status=가입 → 포함
  // - status=준비/대기 → happycall_result=성공 + 송장번호 있을 때만 포함
  // - 정렬: happy_call_at → invoice_registered_at → created_at → id
  const joinAttributed: AttributedJoinContractRow[] = [];
  for (const row of (allContractRows ?? []) as any[]) {
    if (!isPromotionAccumulationJoinContractRow(row)) continue;
    const sid = row.sales_member_id as string;
    joinAttributed.push({
      id: row.id,
      contract_code: (row.contract_code ?? null) as string | null,
      status: String(row.status ?? ''),
      join_date: String(row.join_date ?? '').slice(0, 10),
      unit_count: row.unit_count ?? 0,
      sales_member_id: sid,
      created_at: (row.created_at ?? null) as string | null,
      happy_call_at: (row.happy_call_at ?? null) as string | null,
      invoice_registered_at: (row.invoice_registered_at ?? null) as string | null,
      happycall_result: (row.happycall_result ?? null) as string | null,
      invoice_no: (row.invoice_no ?? null) as string | null,
      product_type: (row.product_type ?? null) as string | null,
      item_name: (row.item_name ?? null) as string | null,
      source_snapshot_json: (row.source_snapshot_json ?? null) as Record<string, string | null> | null,
    });
  }

  const treeRows = buildSettlementTreeRows(
    membersRaw as Array<{ id: string; name: string; rank: RankType; source_customer_id?: string | null }>,
    edgesRaw,
  );

  const { data: promoEvents } = await db
    .from('leader_promotion_events')
    .select(
      'member_id, previous_parent_id, leader_maintenance_bonus_paid_year_month, threshold_contract_id, threshold_join_date, created_at',
    );
  const prevParentByMemberId = new Map<string, string | null>();
  const leaderMaintBlockByMemberId = new Map<string, boolean>();
  const prevLeaderByPromotedMemberId = new Map<string, string | null>();
  const policyPromotedLeaderIds = new Set<string>();
  const promotionEventsByMemberId = new Map<string, LeaderPromotionEventRecord>();
  for (const r of (promoEvents ?? []) as any[]) {
    const mid = r.member_id as string;
    policyPromotedLeaderIds.add(mid);
    prevParentByMemberId.set(mid, (r.previous_parent_id ?? null) as string | null);
    prevLeaderByPromotedMemberId.set(mid, (r.previous_parent_id ?? null) as string | null);
    const paidYm = (r.leader_maintenance_bonus_paid_year_month ?? null) as string | null;
    leaderMaintBlockByMemberId.set(mid, paidYm != null && paidYm !== yearMonth);
    if (r?.threshold_contract_id && r?.threshold_join_date) {
      promotionEventsByMemberId.set(mid, {
        member_id: mid,
        threshold_contract_id: String(r.threshold_contract_id),
        threshold_join_date: String(r.threshold_join_date).slice(0, 10),
        previous_parent_id: (r.previous_parent_id ?? null) as string | null,
        created_at: (r.created_at ?? null) as string | null,
      });
    }
  }

  // 신규 승급 자동화(A): walk 누적 20구좌 최초 도달 시 leader_promotion_events 생성
  const walkThresholdsForNewEvents = computeLeaderPromotionThresholds(
    treeRows,
    joinAttributed,
    (membersRaw as OrganizationMember[]).map((m) => ({
      id: m.id,
      rank: m.rank as RankType,
      external_id: m.external_id ?? null,
    })),
  );
  const parentByChildForPromo = new Map<string, string | null>();
  for (const e of edgesRaw) parentByChildForPromo.set(e.child_id, e.parent_id ?? null);
  const newPromoRows: Array<{
    member_id: string;
    previous_parent_id: string | null;
    threshold_contract_id: string;
    threshold_join_date: string;
  }> = [];
  const newPromoMemberIds: string[] = [];
  for (const m of membersRaw as OrganizationMember[]) {
    if (promotionEventsByMemberId.has(m.id)) continue;
    const th = walkThresholdsForNewEvents.get(m.id) ?? null;
    if (!th) continue;
    if (m.rank !== '영업사원' && m.rank !== '리더') continue;
    newPromoRows.push({
      member_id: m.id,
      previous_parent_id: parentByChildForPromo.get(m.id) ?? null,
      threshold_contract_id: th.threshold_contract_id,
      threshold_join_date: th.threshold_join_date,
    });
    newPromoMemberIds.push(m.id);
    promotionEventsByMemberId.set(m.id, {
      member_id: m.id,
      threshold_contract_id: th.threshold_contract_id,
      threshold_join_date: th.threshold_join_date,
      previous_parent_id: parentByChildForPromo.get(m.id) ?? null,
      created_at: null,
    });
    policyPromotedLeaderIds.add(m.id);
  }
  if (newPromoRows.length > 0) {
    const { error: newPromoErr } = await db
      .from('leader_promotion_events')
      .upsert(newPromoRows as any, { onConflict: 'member_id' });
    if (newPromoErr) {
      throw new Error(`walk 기반 leader_promotion_events 생성 실패: ${newPromoErr.message}`);
    }
    const toRankUp = newPromoMemberIds.filter((id) => {
      const m = (membersRaw as OrganizationMember[]).find((x) => x.id === id);
      return m?.rank === '영업사원';
    });
    if (toRankUp.length > 0) {
      await db.from('organization_members').update({ rank: '리더' }).in('id', toRankUp).eq('rank', '영업사원');
    }
  }

  const joinStatusCandidates: JoinStatusContractCandidate[] = [];
  for (const row of (allContractRows ?? []) as any[]) {
    const st = String(row.status ?? '').trim();
    if (st !== '가입' && st !== '준비' && st !== '대기') continue;
    if (!row.sales_member_id) continue;
    joinStatusCandidates.push({
      id: row.id,
      contract_code: (row.contract_code ?? null) as string | null,
      unit_count: row.unit_count ?? 0,
      sales_member_id: row.sales_member_id as string,
      join_date: String(row.join_date ?? '').slice(0, 10),
      status: String(row.status ?? ''),
      is_cancelled: row.is_cancelled ?? null,
      sales_link_status: (row.sales_link_status ?? null) as string | null,
      happy_call_at: row.happy_call_at ?? null,
      happycall_result: (row.happycall_result ?? null) as string | null,
      invoice_no: (row.invoice_no ?? null) as string | null,
      invoice_registered_at: (row.invoice_registered_at ?? null) as string | null,
      created_at: (row.created_at ?? null) as string | null,
      product_type: (row.product_type ?? null) as string | null,
      item_name: (row.item_name ?? null) as string | null,
      source_snapshot_json: (row.source_snapshot_json ?? null) as Record<string, string | null> | null,
    });
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
    {
      join_date: string;
      happy_call_at?: string | null;
      invoice_registered_at?: string | null;
      created_at?: string | null;
    }
  >();
  if (thresholdContractIds.length > 0) {
    const { data: thContractRows, error: thCErr } = await db
      .from('contracts')
      .select('id, created_at, join_date, happy_call_at, invoice_registered_at')
      .in('id', thresholdContractIds);
    if (thCErr) throw new Error(`승격 계약(created_at) 조회 실패: ${thCErr.message}`);
    for (const row of (thContractRows ?? []) as any[]) {
      if (!row?.id) continue;
      thresholdContractMetaById.set(String(row.id), {
        join_date: String(row.join_date ?? '').slice(0, 10),
        happy_call_at: (row.happy_call_at ?? null) as string | null,
        invoice_registered_at: (row.invoice_registered_at ?? null) as string | null,
        created_at: (row.created_at ?? null) as string | null,
      });
    }
  }
  mergeLeaderPromotionEventThresholds(
    promotionThresholdByMemberId,
    (promoEvents ?? []) as any[],
    thresholdContractMetaById,
  );

  // DB 리더(정책 승격 제외): joinAttributed 기준 threshold 재계산.
  // 정책 승격자는 leader_promotion_events 가 SSOT — refresh 로 덮어쓰면 6월 승격계약으로 잡혀
  // 5월 승격 이후 계약까지 전부 30만원/구좌가 된다.
  const thresholdRefreshIds = new Set<string>();
  for (const m of membersRaw as OrganizationMember[]) {
    if (m.rank === '리더' && !policyPromotedLeaderIds.has(m.id)) {
      thresholdRefreshIds.add(m.id);
    }
  }
  refreshPromotionThresholdsFromJoinAttributed(
    promotionThresholdByMemberId,
    treeRows,
    joinAttributed,
    thresholdRefreshIds,
  );

  for (const mid of policyPromotedLeaderIds) {
    const th = promotionThresholdByMemberId.get(mid);
    if (!th) continue;
    promotionThresholdByMemberId.set(
      mid,
      enrichThresholdPrePromotionUnits(th, mid, treeRows, joinAttributed),
    );
  }

  const promotionCommissionMemberIds = (membersRaw as OrganizationMember[])
    .filter((m) => m.rank === '영업사원' || m.rank === '리더')
    .map((m) => m.id);

  const promotionEventWalkMismatches: PromotionEventWalkMismatch[] = [];
  const promotionEventValidations: PromotionEventValidation[] = [];
  const splitBuildOptions = {
    promotionThresholdByMemberId,
    promotionEventsByMemberId,
    joinStatusCandidates,
    walkMismatchOut: promotionEventWalkMismatches,
    validationOut: promotionEventValidations,
    treeRows,
  };

  const promotionUnitSplitByMemberId = buildPromotionUnitSplitByMemberIds(
    promotionCommissionMemberIds,
    treeRows,
    joinAttributed,
    splitBuildOptions,
  );

  const promotionCommissionAuditByMemberId = new Map(
    promotionCommissionMemberIds.map((mid) => [
      mid,
      buildPromotionCommissionWalkForMember(
        mid,
        treeRows,
        joinAttributed,
        LEADER_PROMOTION_MIN_UNITS,
        splitBuildOptions,
      ).audit,
    ]),
  );

  const promotionEventWalkMismatchByMemberId = new Map(
    promotionEventWalkMismatches.map((m) => [m.member_id, m]),
  );
  const promotionEventValidationByMemberId = new Map(
    promotionEventValidations.map((v) => [v.member_id, v]),
  );

  if (debug) {
    const imId = (membersRaw as OrganizationMember[]).find(
      (m) => (m.name ?? '').replace(/^\[고객\]\s*/, '') === '임태순',
    )?.id;
    if (imId) {
      // eslint-disable-next-line no-console
      console.log('[settlement-debug] 임태순 promotion threshold', {
        yearMonth,
        threshold: promotionThresholdByMemberId.get(imId) ?? null,
        path: debugPromotionThresholdPath(imId, treeRows, joinAttributed),
      });
    }
  }

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
      group_bonus_join_date: groupBonusJoinDateByContractId.get(c.id) ?? null,
      customer_name: customerName,
      sales_member_id: c.sales_member_id,
      unit_count: c.unit_count,
      happy_call_at: happyCallAtByContractId.get(c.id) ?? null,
      happycall_result: happycallResultByContractId.get(c.id) ?? null,
    });
  }

  const incentiveAmountOverrideByMemberId = new Map<string, number>();
  const { data: bonusOverrideRows, error: bonusOvErr } = await db
    .from('settlement_statement_overrides')
    .select('member_id, bonus_amount')
    .eq('year_month', yearMonth)
    .not('bonus_amount', 'is', null);
  if (bonusOvErr) throw new Error(`보너스 override 조회 실패: ${bonusOvErr.message}`);
  for (const row of (bonusOverrideRows ?? []) as Array<{ member_id: string; bonus_amount: number }>) {
    const mid = String(row.member_id ?? '').trim();
    if (!mid) continue;
    const amt = Number(row.bonus_amount);
    if (!Number.isFinite(amt)) continue;
    incentiveAmountOverrideByMemberId.set(mid, Math.round(amt));
  }

  const leaderOpts: LeaderSettlementOpts = {
    treeRows,
    promotionThresholdByMemberId,
    promotionUnitSplitByMemberId,
    promotionCommissionAuditByMemberId,
    promotionEventWalkMismatchByMemberId,
    promotionEventValidationByMemberId,
    joinOnlyAttributed: joinAttributed,
    settlementEndDate: end_date,
    leaderMaintenanceBonusAlreadyPaidByMemberId: leaderMaintBlockByMemberId,
    previousLeaderByPromotedMemberId: prevLeaderByPromotedMemberId,
    leaderRankEffectiveAtByMemberId,
    groupBonusContracts,
    incentiveAmountOverrideByMemberId,
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
          invoice_registered_at:
            (c as { invoice_registered_at?: string | null }).invoice_registered_at ?? null,
          created_at: cCreated,
          unit_count: c.unit_count ?? 0,
        },
        null,
        promotionUnitSplitByMemberId.get(origin),
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

  leaderOpts.orgNodeByMemberId = nodeById;

  const settlementRows: Awaited<ReturnType<typeof calculateMemberSettlement>>[] = [];
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

    settlementRows.push(settlement);
  }

  let updatedCount = 0;
  for (let i = 0; i < settlementRows.length; i += SETTLEMENT_UPSERT_BATCH_SIZE) {
    const batch = settlementRows.slice(i, i + SETTLEMENT_UPSERT_BATCH_SIZE);
    const { error: uErr } = await db
      .from('monthly_settlements')
      .upsert(batch, { onConflict: 'year_month,member_id' });
    if (!uErr) updatedCount += batch.length;
  }

  if (debug) {
    // eslint-disable-next-line no-console
    console.log('[settlement-debug] monthly-calculate done', { yearMonth, updated_count: updatedCount });
  }

  return { updated_count: updatedCount };
}

