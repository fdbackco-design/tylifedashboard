/**
 * POST /api/settlement/calculate
 * 월별 정산 계산/재계산 (서버 전용)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import {
  calculateMemberSettlement,
  buildOrgTree,
  type LeaderSettlementOpts,
} from '@/lib/settlement/calculator';
import { getSettlementWindowForYearMonth } from '@/lib/settlement/settlement-window';
import { buildSettlementTreeRows } from '@/lib/settlement/settlement-org-tree';
import {
  computeSalesMemberPromotionThreshold,
  type AttributedJoinContractRow,
} from '@/lib/settlement/leader-promotion';
import { isContractStrictlyAfterPromotionThreshold } from '@/lib/settlement/leader-promotion';
import type { Contract, OrganizationMember, SettlementRule } from '@/lib/types';
import type { RankType } from '@/lib/types/organization';

export async function POST(req: NextRequest): Promise<NextResponse> {
  // TODO: 인증 추가 필요 (현재 서버 내부 호출 가정)
  let body: { year_month?: string; force?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON body 필요' }, { status: 400 });
  }

  const { year_month, force = false } = body;

  if (!year_month || !/^\d{4}-\d{2}$/.test(year_month)) {
    return NextResponse.json(
      { error: 'year_month 필드가 필요합니다 (형식: YYYY-MM)' },
      { status: 400 },
    );
  }

  const db = createAdminSupabaseClient();

  // 확정된 정산 재계산 방지
  if (!force) {
    const { data: existing } = await db
      .from('monthly_settlements')
      .select('id, is_finalized')
      .eq('year_month', year_month)
      .eq('is_finalized', true)
      .limit(1);

    if (existing && existing.length > 0) {
      return NextResponse.json(
        { error: `${year_month} 정산이 이미 확정되었습니다. force=true로 재계산하세요.` },
        { status: 409 },
      );
    }
  }

  try {
    const result = await calculateMonthlySettlement(year_month, db);
    return NextResponse.json({ success: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/settlement/calculate] 정산 계산 실패:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

async function calculateMonthlySettlement(
  yearMonth: string,
  db: ReturnType<typeof createAdminSupabaseClient>,
): Promise<{ updated_count: number }> {
  const { end_date } = getSettlementWindowForYearMonth(yearMonth);

  // 1. 정산 대상 계약 조회 (v_contract_settlement_base가 SSOT 기준으로 필터링)
  const { data: contracts, error: cErr } = await db
    .from('v_contract_settlement_base')
    .select('*')
    .eq('year_month', yearMonth);

  if (cErr) throw new Error(`계약 조회 실패: ${cErr.message}`);

  // v_contract_settlement_base는 contract_id 컬럼을 사용한다.
  // 정산 계산 로직은 Contract.id를 사용하므로, 런타임에서 id가 undefined가 되지 않도록 정규화한다.
  const normalizedContractsBase = ((contracts ?? []) as any[]).map((r) => ({
    id: String(r.contract_id ?? ''),
    contract_code: String(r.contract_code ?? ''),
    join_date: String(r.join_date ?? '').slice(0, 10),
    unit_count: Number(r.unit_count ?? 0),
    status: String(r.status ?? ''),
    is_cancelled: Boolean(r.is_cancelled ?? false),
    sales_member_id: (r.sales_member_id ?? null) as string | null,
  }));

  // 조직도/정산현황과 동일한 정책: customer_id가 organization_members로 매핑되면 해당 노드로 귀속 치환
  // (김세영 케이스: 조직도에서는 customer 노드/직원 노드 병합/치환을 적용하지만, 정산 재계산은 그걸 안 해서 불일치가 생김)
  const contractIds = normalizedContractsBase.map((c) => c.id).filter(Boolean);
  const { data: contractCustomerRows, error: ccErr } = await db
    .from('contracts')
    .select('id, customer_id')
    .in('id', contractIds);
  if (ccErr) throw new Error(`contracts(customer_id) 조회 실패: ${ccErr.message}`);
  const customerIdByContractId = new Map<string, string>();
  for (const r of (contractCustomerRows ?? []) as any[]) {
    if (r?.id && r?.customer_id) customerIdByContractId.set(String(r.id), String(r.customer_id));
  }

  // 2. 정산 규칙 조회
  const { data: rules, error: rErr } = await db
    .from('settlement_rules')
    .select('*');

  if (rErr) throw new Error(`정산 규칙 조회 실패: ${rErr.message}`);

  // 3. 조직원 전체 + edges 조회 (/settlement 페이지와 동일 트리)
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

  const hqIdsRaw = new Set(
    membersRaw.filter((m) => m.name === '안성준' || m.rank === '본사').map((m) => m.id as string),
  );
  const hqIdForReparent =
    membersRaw.find((m) => m.name === '안성준')?.id ??
    membersRaw.find((m) => (m.rank as RankType) === '본사')?.id ??
    null;

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
    const customerId = customerIdByContractId.get(c.id) ?? null;
    if (customerId) {
      const mapped = memberIdByCustomerId.get(customerId) ?? null;
      if (mapped) return { ...c, sales_member_id: mapped };
    }
    return c;
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

  // 승격 전 귀속/유지장려(1회성)/이전 상위 리더 안정화를 위한 이벤트 조회 (threshold 계산에도 사용)
  const { data: promoEvents } = await db
    .from('leader_promotion_events')
    .select('member_id, previous_parent_id, leader_maintenance_bonus_paid_at, leader_maintenance_bonus_paid_year_month');
  const prevParentByMemberId = new Map<string, string | null>();
  const leaderMaintBlockByMemberId = new Map<string, boolean>();
  const prevLeaderByPromotedMemberId = new Map<string, string | null>();
  const policyPromotedLeaderIds = new Set<string>();
  for (const r of (promoEvents ?? []) as any[]) {
    const mid = r.member_id as string;
    policyPromotedLeaderIds.add(mid);
    prevParentByMemberId.set(mid, (r.previous_parent_id ?? null) as string | null);
    prevLeaderByPromotedMemberId.set(mid, (r.previous_parent_id ?? null) as string | null);
    // 같은 정산월(yearMonth) 재계산에서는 보너스를 계속 포함해야 함 → "다른 월에 이미 지급"만 차단
    const paidYm = (r.leader_maintenance_bonus_paid_year_month ?? null) as string | null;
    leaderMaintBlockByMemberId.set(mid, paidYm != null && paidYm !== yearMonth);
  }

  // 승격 threshold 계산은 DB rank 변화에 영향받지 않아야 한다.
  // 단, 모든 '리더'를 영업사원으로 간주하면(기존 리더 포함) 리더에게 잘못 threshold/유지장려가 붙는다.
  // 따라서 "정책 승격 리더(leader_promotion_events가 있는 리더)"만 임시 영업사원 취급한다.
  const rankById = new Map<string, RankType>();
  for (const m of membersRaw) {
    const r = m.rank as RankType;
    if (r === '리더' && policyPromotedLeaderIds.has(m.id as string)) {
      rankById.set(m.id as string, '영업사원');
    } else {
      rankById.set(m.id as string, r);
    }
  }

  const promotionThresholdByMemberId = computeSalesMemberPromotionThreshold(
    treeRows,
    joinAttributed,
    rankById,
  );

  const leaderOpts: LeaderSettlementOpts = {
    treeRows,
    promotionThresholdByMemberId,
    joinOnlyAttributed: joinAttributed,
    settlementEndDate: end_date,
  };

  // leaderOpts에 1회성 지급/이전 상위 리더 전달
  leaderOpts.leaderMaintenanceBonusAlreadyPaidByMemberId = leaderMaintBlockByMemberId;
  leaderOpts.previousLeaderByPromotedMemberId = prevLeaderByPromotedMemberId;

  // 4) "기본수당(직접)" 귀속용 계약 맵은 승격 전/후로 분리해 구성한다.

  // 5. 롤업 계산용 계약 맵(원본 담당자 기준)은 유지한다.
  const contractsByMember = new Map<string, Contract[]>();
  for (const c of normalizedContracts as any[]) {
    const origin = (c.sales_member_id ?? null) as string | null;
    if (!origin) continue;
    const arr = contractsByMember.get(origin) ?? [];
    arr.push(c);
    contractsByMember.set(origin, arr);
  }

  // 6. "기본수당(직접)" 귀속용 계약 맵은 승격 전/후로 분리해 구성한다.
  // - 승격 전(승격 계약 포함): 기존 상위 리더에게 귀속(단, 단가는 영업사원 기준)
  // - 승격 후(21구좌부터): 승격자 본인 귀속
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
        // 리더에게 귀속되더라도 단가는 "원래 영업사원 계약" 기준으로 계산되어야 함
        (c as any).__attributed_origin_member_id = origin;
        (c as any).__attributed_origin_rank = '영업사원';
      }
    }

    const arr = directContractsByMemberForSettlement.get(assignTo) ?? [];
    arr.push(c);
    directContractsByMemberForSettlement.set(assignTo, arr);
  }

  // 6-1) 첫 재계산에서도 롤업이 즉시 맞도록, "승격 + 본사 재배치 대상"을 미리 이벤트로 기록한다.
  // (edges가 이후에 바뀌어도 prevParent가 남아야 재계산이 안정적)
  {
    const toRecord: Array<{ member_id: string; previous_parent_id: string; th: any }> = [];
    for (const m of membersRaw) {
      if ((m.rank as RankType) !== '영업사원') continue;
      const th = promotionThresholdByMemberId.get(m.id as string) ?? null;
      if (!th) continue;
      const parentId = parentByChild.get(m.id as string) ?? null;
      const parentRank = parentId ? (rankByIdRaw.get(parentId) ?? null) : null;
      if (parentId && parentRank === '리더') {
        toRecord.push({ member_id: m.id as string, previous_parent_id: parentId, th });
      }
    }
    if (toRecord.length > 0) {
      await db.from('leader_promotion_events').upsert(
        toRecord.map((r) => ({
          member_id: r.member_id,
          previous_parent_id: r.previous_parent_id,
          threshold_contract_id: r.th.threshold_contract_id,
          threshold_join_date: r.th.threshold_join_date,
        })),
        { onConflict: 'member_id' },
      );

      // 이번 실행에서 바로 롤업에 반영될 수 있게 leaderOpts 맵도 갱신
      if (!leaderOpts.previousLeaderByPromotedMemberId) {
        leaderOpts.previousLeaderByPromotedMemberId = new Map<string, string | null>();
      }
      for (const r of toRecord) {
        leaderOpts.previousLeaderByPromotedMemberId.set(r.member_id, r.previous_parent_id);
      }
    }
  }

  // 7. 조직 트리 빌드
  const trees = buildOrgTree(treeRows);
  const nodeById = new Map<string, ReturnType<typeof buildOrgTree>[number]>();
  (function indexNodes(nodes: ReturnType<typeof buildOrgTree>) {
    for (const n of nodes) {
      nodeById.set(n.id, n);
      indexNodes(n.children);
    }
  })(trees);

  // 8. 각 멤버 정산 계산 및 upsert
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

    const { error: uErr } = await db
      .from('monthly_settlements')
      .upsert(settlement, { onConflict: 'year_month,member_id' });

    if (uErr) {
      console.error(`[settlement] ${member.name} 정산 저장 실패:`, uErr.message);
    } else {
      updatedCount++;
    }
  }

  // 이번 재계산에서 유지장려(리더) 보너스를 포함한 멤버는 지급 이력을 기록
  // - 재계산(같은 yearMonth)은 결과가 같아야 하므로, paid_year_month가 해당 월이면 계속 포함되도록 했다.
  const paidNow: string[] = [];
  // settlements를 별도 수집하지 않으므로, monthly_settlements의 calculation_detail을 조회해 지급 여부를 기록한다.
  const { data: paidRows } = await db
    .from('monthly_settlements')
    .select('member_id, calculation_detail')
    .eq('year_month', yearMonth);
  for (const r of (paidRows ?? []) as any[]) {
    const lp = r.calculation_detail?.leader_promotion ?? null;
    if (!lp) continue;
    if ((lp.leader_maintenance_bonus_amount ?? 0) > 0) {
      paidNow.push(r.member_id as string);
    }
  }
  if (paidNow.length > 0) {
    await db.from('leader_promotion_events').upsert(
      paidNow.map((id) => ({
        member_id: id,
        leader_maintenance_bonus_paid_at: new Date().toISOString(),
        leader_maintenance_bonus_paid_year_month: yearMonth,
      })),
      { onConflict: 'member_id' },
    );
  }

  // 승격 반영(조직도/프로필 표시용): 정산 계산은 "영업사원 + 승격 계약 기준"으로 수행한 뒤,
  // DB rank를 리더로 올려 화면/조직도에서도 일관되게 보이도록 한다.
  {
    const toPromote: string[] = [];
    const toReparentToHq: string[] = [];
    const parentByChild = new Map<string, string | null>();
    for (const e of edgesRaw) parentByChild.set(e.child_id, e.parent_id ?? null);
    const rankByIdRaw = new Map<string, RankType>();
    for (const m of membersRaw) rankByIdRaw.set(m.id as string, m.rank as RankType);

    for (const m of membersRaw) {
      if ((m.rank as RankType) !== '영업사원') continue;
      const th = promotionThresholdByMemberId.get(m.id as string) ?? null;
      if (th) toPromote.push(m.id as string);

      // 추가 규칙: 기존 상위가 리더인 영업사원이 정책 승격하면 본사 직속으로 재배치
      if (th) {
        const parentId = parentByChild.get(m.id as string) ?? null;
        const parentRank = parentId ? (rankByIdRaw.get(parentId) ?? null) : null;
        if (parentId && parentRank === '리더') {
          toReparentToHq.push(m.id as string);
          // 이전 parent(리더) 보존: 재계산 시에도 승격 전 귀속을 안정적으로 재현
          await db.from('leader_promotion_events').upsert(
            {
              member_id: m.id as string,
              previous_parent_id: parentId,
              threshold_contract_id: th.threshold_contract_id,
              threshold_join_date: th.threshold_join_date,
            } as any,
            { onConflict: 'member_id' },
          );
        }
      }
    }
    if (toPromote.length > 0) {
      const { error: upErr } = await db
        .from('organization_members')
        .update({ rank: '리더' })
        .in('id', toPromote)
        .eq('rank', '영업사원'); // 안전장치: 상위직급 덮어쓰기 방지
      if (upErr) throw new Error(`승격 반영 실패: ${upErr.message}`);
    }

    if (hqIdForReparent && toReparentToHq.length > 0) {
      const { error: eErr } = await db
        .from('organization_edges')
        .upsert(
          toReparentToHq.map((id) => ({ parent_id: hqIdForReparent, child_id: id })),
          { onConflict: 'child_id' },
        );
      if (eErr) throw new Error(`승격자 본사 재배치 실패: ${eErr.message}`);
    }
  }

  return { updated_count: updatedCount };
}

