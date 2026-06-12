import type { Metadata } from 'next';
import Link from 'next/link';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { getSettlementWindowForYearMonth } from '@/lib/settlement/settlement-window';
import { getContractDisplayStatus } from '@/lib/utils/contract-display-status';
import { isOrgDisplayHiddenMemberName } from '@/lib/organization/org-display-hidden';
import {
  isV2EligibleStatic,
  happycallYmdSeoul,
} from '@/lib/settlement/settlement-eligibility-v2';
import { getRollupAmountPerUnit } from '@/lib/settlement/calculator';
import type { SettlementCalculationDetail, SettlementRule } from '@/lib/types/settlement';
import type { RankType } from '@/lib/types';

export const metadata: Metadata = { title: '정산 현황 · 정산 상세' };
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    year_month?: string;
    member_id?: string;
  }>;
}

function nextDay(dateYmd: string): string {
  const [y, m, d] = dateYmd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function collectSubtreeMemberIds(
  parentByChild: Map<string, string | null>,
  rootId: string,
): Set<string> {
  const out = new Set<string>();
  const stack: string[] = [rootId];
  while (stack.length) {
    const cur = stack.pop()!;
    if (out.has(cur)) continue;
    out.add(cur);
    for (const [child, parent] of parentByChild.entries()) {
      if (parent === cur) stack.push(child);
    }
  }
  return out;
}

function formatWon(n: number): string {
  return `₩${Math.round(Number(n) || 0).toLocaleString('ko-KR')}`;
}

export default async function SettlementMemberSubtreePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const yearMonth = params.year_month;
  const memberId = params.member_id;

  if (!yearMonth || !memberId) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-600">year_month와 member_id가 필요합니다.</p>
        <Link className="text-sm text-blue-600 underline mt-2 inline-block" href="/admin/settlement">
          정산 현황으로
        </Link>
      </div>
    );
  }

  const db = createAdminSupabaseClient();
  const { start_date, end_date } = getSettlementWindowForYearMonth(yearMonth);
  const endExclusive = nextDay(end_date);

  const [memberRes, membersRes, edgesRes, contractRowsRes, settlementsRes, rootSettlementRes, rulesRes] =
    await Promise.all([
      db
        .from('organization_members')
        .select('id, name, rank, external_id, phone, source_customer_id, leader_rank_effective_at')
        .eq('id', memberId)
        .maybeSingle(),
      db
        .from('organization_members')
        .select('id, name, rank, external_id, phone, source_customer_id, leader_rank_effective_at')
        .eq('is_active', true),
      db.from('organization_edges').select('parent_id, child_id'),
      db
        .from('contracts')
        .select(
          'id, contract_code, join_date, status, unit_count, item_name, sales_member_id, customer_id, sales_link_status, is_cancelled, rental_request_no, invoice_no, memo, happy_call_at, happycall_result, settlement_sales_member_id, customers(name)',
        )
        .gte('join_date', start_date)
        .lt('join_date', endExclusive),
      // 모든 멤버의 monthly_settlements (계약별 직접 수당 = direct_contracts.subtotal 맵 구축용)
      db
        .from('monthly_settlements')
        .select('member_id, calculation_detail')
        .eq('year_month', yearMonth),
      // 선택한 멤버 본인의 정산 결과(합계 카드용)
      db
        .from('monthly_settlements')
        .select(
          'member_id, year_month, rank, direct_contract_count, direct_unit_count, subordinate_unit_count, total_unit_count, base_commission, rollup_commission, incentive_amount, total_amount',
        )
        .eq('year_month', yearMonth)
        .eq('member_id', memberId)
        .maybeSingle(),
      // 정책 단가 계산용: settlement_rules 전체 (효력일자별)
      db.from('settlement_rules').select('*'),
    ]);

  const member = memberRes.data as any;
  if (!member) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-600">멤버를 찾을 수 없습니다.</p>
        <Link className="text-sm text-blue-600 underline mt-2 inline-block" href={`/admin/settlement?year_month=${yearMonth}`}>
          정산 현황으로
        </Link>
      </div>
    );
  }

  const rawName = (member.name ?? '').replace(/^\[고객\]\s*/, '').trim();
  if (rawName === '안성준' || isOrgDisplayHiddenMemberName(member.name ?? '')) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">이 멤버는 정산 목록에서 표시되지 않습니다.</p>
        <Link className="text-sm text-blue-600 underline mt-2 inline-block" href={`/admin/settlement?year_month=${yearMonth}`}>
          정산 현황으로
        </Link>
      </div>
    );
  }

  const membersRaw = (((membersRes.data ?? []) as unknown as any[]) ?? []).map((m) =>
    m.name === '안성준' ? { ...m, rank: '본사' as const } : m,
  );
  const edgesRaw = (edgesRes.data ?? []) as Array<{ parent_id: string | null; child_id: string }>;

  const hqIdsRaw = new Set(
    membersRaw.filter((m) => m.name === '안성준' || m.rank === '본사').map((m) => m.id as string),
  );
  const hqIdForTree =
    membersRaw.find((m) => m.name === '안성준')?.id ?? (hqIdsRaw.values().next().value ?? null);

  const memberIdSet = new Set(membersRaw.map((m) => m.id as string));
  const edgeMap = new Map<string, string | null>();
  const bestByChild = new Map<string, { parent_id: string | null; child_id: string }>();
  const isBetter = (
    next: { parent_id: string | null; child_id: string },
    prev: { parent_id: string | null; child_id: string },
  ): boolean => {
    const nextIsHq = next.parent_id != null && hqIdsRaw.has(next.parent_id);
    const prevIsHq = prev.parent_id != null && hqIdsRaw.has(prev.parent_id);
    if (nextIsHq !== prevIsHq) return nextIsHq;
    if ((next.parent_id != null) !== (prev.parent_id != null)) return next.parent_id != null;
    return false;
  };
  for (const e of edgesRaw) {
    const parent_id = e.parent_id && memberIdSet.has(e.parent_id) ? e.parent_id : null;
    const child_id = e.child_id as string;
    if (!memberIdSet.has(child_id)) continue;
    const next = { parent_id, child_id };
    const prev = bestByChild.get(child_id);
    if (!prev || isBetter(next, prev)) bestByChild.set(child_id, next);
  }
  for (const e of bestByChild.values()) edgeMap.set(e.child_id, e.parent_id);

  // child -> parent
  const parentByChild = new Map<string, string | null>();
  for (const m of membersRaw as any[]) {
    const id = m.id as string;
    if (m.rank === '본사') {
      parentByChild.set(id, null);
      continue;
    }
    const forced =
      hqIdForTree && (m.source_customer_id ?? null) != null ? hqIdForTree : (edgeMap.get(id) ?? null);
    parentByChild.set(id, forced);
  }

  // 선택 멤버의 산하 (본인 포함)
  const subtreeIds = collectSubtreeMemberIds(parentByChild, memberId);

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

  const attributedSalesMemberId = (r: { customer_id: string | null; sales_member_id: string }): string => {
    const customer_id = r.customer_id ?? null;
    let sales_member_id = r.sales_member_id;
    if (customer_id) {
      const mapped = memberIdByCustomerId.get(customer_id);
      if (mapped) sales_member_id = mapped;
    }
    return sales_member_id;
  };

  const nameById = new Map<string, string>();
  const rankById = new Map<string, string>();
  const leaderEffectiveAtById = new Map<string, string | null>();
  for (const m of membersRaw as any[]) {
    const id = m.id as string;
    nameById.set(id, String(m.name ?? '').replace(/^\[고객\]\s*/, ''));
    rankById.set(id, String(m.rank ?? ''));
    const effRaw = (m.leader_rank_effective_at ?? null) as string | null;
    leaderEffectiveAtById.set(id, effRaw && String(effRaw).trim() !== '' ? String(effRaw) : null);
  }

  // ── 산하구좌 게이트: 하위 리더 승격 전 계약만 상위 리더(=root)의 산하구좌에 포함 ──────
  //
  // 정산 계산(`computeStatementDownlineUnitsWithSharedContext`)의 `excludedByPromotionAfter`
  // 동작과 일치하도록, 산하구좌 상세에서도 다음 규칙을 적용한다:
  //   - root(memberId) 의 rank 가 '리더' 인 경우에만 게이트 작동
  //   - 계약의 effectiveSalesMemberId 부터 root 까지 path 를 따라 올라가며
  //     가장 가까운 "리더" 노드(effective 자신 포함)를 찾는다.
  //   - 그 리더의 leader_rank_effective_at 이 존재하면, 계약 가입일이 그 시점보다
  //     strict before 인 계약만 root 의 산하구좌 상세에 포함한다.
  //   - leader_rank_effective_at 이 null 이거나 path 위에 리더가 없으면 그대로 포함.
  //
  // 정산 본체와 동일하게 root 자신의 승격 시점 게이트(`excludedByRootLeaderEffectiveAt`)
  // 는 본 상세 화면 분류에서는 적용하지 않는다(사용자 요구 범위 외).
  const rootRank = String((member as { rank?: string | null }).rank ?? '');
  const isDownlineEligibleForLeaderGate = (
    effectiveMemberId: string,
    joinYmd: string,
  ): boolean => {
    if (rootRank !== '리더') return true;
    if (!joinYmd) return true;
    const visited = new Set<string>();
    let cur: string | null = effectiveMemberId;
    while (cur && !visited.has(cur)) {
      visited.add(cur);
      if (cur === memberId) return true; // root 본인까지 도달
      if ((rankById.get(cur) ?? '') === '리더') {
        const eff = leaderEffectiveAtById.get(cur) ?? null;
        if (!eff) return true; // 승격 시점 정보 없음 → 보수적으로 포함
        const effYmd = String(eff).slice(0, 10);
        if (!effYmd) return true;
        // 계약 가입일이 리더 승격 시점 이전이면 상위 리더의 산하구좌에 포함
        // 같은 날이나 이후이면 그 하위 리더 자신의 산하 카운트로 흡수됨 → 제외
        return joinYmd < effYmd;
      }
      cur = parentByChild.get(cur) ?? null;
    }
    return true;
  };

  // ── 계약별 정산금(직접 수당) 맵 구축 ─────────────────────────
  // monthly_settlements.calculation_detail.direct_contracts 를 모든 멤버에 대해 모은다.
  // 한 계약은 하나의 멤버에 직접 귀속되므로 동일 계약이 다른 멤버에 중복 들어가지 않는다.
  const subtotalByContractId = new Map<string, { memberId: string; subtotal: number }>();
  for (const row of (settlementsRes.data ?? []) as Array<{
    member_id: string | null;
    calculation_detail: SettlementCalculationDetail | null;
  }>) {
    const mid = String(row.member_id ?? '');
    const detail = row.calculation_detail;
    if (!detail || !mid) continue;
    for (const dc of detail.direct_contracts ?? []) {
      const cid = String((dc as any).contract_id ?? '');
      if (!cid) continue;
      const subtotal = Number((dc as any).subtotal ?? 0) || 0;
      // 첫번째 등록만 사용 (계약은 한 멤버에 직접 귀속되므로 충돌 시에도 가장 먼저 만난 값 유지)
      if (!subtotalByContractId.has(cid)) {
        subtotalByContractId.set(cid, { memberId: mid, subtotal });
      }
    }
  }

  // ── 계약 변환 (v2 정적 가입 인정 기준) ───────────────────────
  const rows = ((contractRowsRes.data ?? []) as any[])
    .filter((c) =>
      isV2EligibleStatic({
        status: String(c.status ?? ''),
        is_cancelled: Boolean(c.is_cancelled ?? false),
        sales_member_id: (c.sales_member_id ?? null) as string | null,
        sales_link_status: (c.sales_link_status ?? null) as string | null,
        happycall_result: (c.happycall_result ?? null) as string | null,
        invoice_no: (c.invoice_no ?? null) as string | null,
      }),
    )
    .map((c) => {
      const rawSalesMemberId = String(c.sales_member_id ?? '');
      const overrideId = (c.settlement_sales_member_id ?? null) as string | null;
      // 정산용 담당자: override 우선 → 없으면 원 담당자
      const effectiveSalesMemberId = (overrideId && overrideId.trim() !== '' ? overrideId : rawSalesMemberId) as string;
      const origin = attributedSalesMemberId({
        customer_id: (c.customer_id ?? null) as string | null,
        sales_member_id: rawSalesMemberId,
      });
      const joinYmd = String(c.join_date ?? '').slice(0, 10);
      const happycallYmd = happycallYmdSeoul(c.happy_call_at);
      const contractId = c.id as string;
      const wonInfo = subtotalByContractId.get(contractId);
      const settlementWon = wonInfo?.subtotal ?? 0;
      return {
        contract_id: contractId,
        contract_code: c.contract_code as string,
        join_date: c.join_date as string | null,
        join_ymd: joinYmd,
        happycall_ymd: happycallYmd,
        unit_count: Number(c.unit_count ?? 0),
        status: String(c.status ?? ''),
        origin,
        customer_name: ((c.customers as any)?.name as string | undefined) ?? '-',
        item_name: (c.item_name as string | null | undefined) ?? null,
        display_status: getContractDisplayStatus({
          status: String(c.status ?? ''),
          rental_request_no: (c.rental_request_no ?? null) as string | null,
          invoice_no: (c.invoice_no ?? null) as string | null,
          memo: (c.memo ?? null) as string | null,
        }),
        raw_sales_member_id: rawSalesMemberId,
        override_sales_member_id: overrideId,
        effective_sales_member_id: effectiveSalesMemberId,
        settlement_won: settlementWon,
        settlement_won_member_id: wonInfo?.memberId ?? null,
      };
    });

  // ── 분류: 직접구좌 / 산하구좌 ─────────────────────────────
  // 직접구좌: effectiveSalesMemberId === memberId
  // 산하구좌: effectiveSalesMemberId ∈ (subtreeIds - {memberId})
  const directRows = rows
    .filter((r) => r.effective_sales_member_id === memberId)
    .sort((a, b) => (b.join_date ?? '').localeCompare(a.join_date ?? ''));

  const downlineRows = rows
    .filter(
      (r) =>
        r.effective_sales_member_id !== memberId &&
        subtreeIds.has(r.effective_sales_member_id),
    )
    // 하위 리더의 leader_rank_effective_at 이후 계약은 그 하위 리더 본인의 산하 카운트로
    // 흡수되므로 root 의 산하구좌 상세에서 제외 (정산 본체와 동일 기준)
    .filter((r) => isDownlineEligibleForLeaderGate(r.effective_sales_member_id, r.join_ymd))
    .sort((a, b) => (b.join_date ?? '').localeCompare(a.join_date ?? ''));

  const directUnitSum = directRows.reduce((s, r) => s + Number(r.unit_count ?? 0), 0);
  const directWonSum = directRows.reduce((s, r) => s + Number(r.settlement_won ?? 0), 0);
  const downlineUnitSum = downlineRows.reduce((s, r) => s + Number(r.unit_count ?? 0), 0);
  // 산하 멤버 직접 수당 합 (참고용)
  const downlineMemberDirectWonSum = downlineRows.reduce(
    (s, r) => s + Number(r.settlement_won ?? 0),
    0,
  );

  const rootMs = (rootSettlementRes.data ?? null) as null | {
    base_commission: number | null;
    rollup_commission: number | null;
    incentive_amount: number | null;
    total_amount: number | null;
    direct_contract_count: number | null;
    direct_unit_count: number | null;
    subordinate_unit_count: number | null;
    total_unit_count: number | null;
    rank: string | null;
  };

  const rootRollupWon = Number(rootMs?.rollup_commission ?? 0) || 0;
  const rootIncentiveWon = Number(rootMs?.incentive_amount ?? 0) || 0;
  const rootTotalWon = Number(rootMs?.total_amount ?? 0) || 0;

  // ── Rollup 수당 발생 계약 내역 ─────────────────────────────
  // SSOT: monthly_settlements[root].calculation_detail.rollup_items (from_member 단위)
  // 화면 표시는 계약 단위 — RollupItem 자체에는 contract_id 가 없으므로
  // 각 from_member 의 calculation_detail.direct_contracts 의 contract_id 를 가져와
  // (계약 unit_count × rollup_amount_per_unit) 로 분배한다.
  // 분배 합은 from_member.subtotal 과 동일해야 하며 (rate × Σ unit), 계약 정보가 빠진
  // 경우(=윈도우 밖) 에는 fallback 으로 contract_id 만 표시한다.
  type CalcDetailRow = { member_id: string | null; calculation_detail: SettlementCalculationDetail | null };
  const allCalcRows = ((settlementsRes.data ?? []) as CalcDetailRow[]).filter(
    (r) => r.calculation_detail != null,
  );
  const rootCalcDetail =
    allCalcRows.find((r) => String(r.member_id ?? '') === memberId)?.calculation_detail ?? null;
  const calcDirectContractsByMember = new Map<string, Array<{ contract_id: string; unit_count: number; subtotal: number }>>();
  for (const r of allCalcRows) {
    const mid = String(r.member_id ?? '');
    if (!mid) continue;
    const items: Array<{ contract_id: string; unit_count: number; subtotal: number }> = [];
    for (const dc of r.calculation_detail?.direct_contracts ?? []) {
      const cid = String((dc as any).contract_id ?? '');
      if (!cid) continue;
      items.push({
        contract_id: cid,
        unit_count: Number((dc as any).unit_count ?? 0) || 0,
        subtotal: Number((dc as any).subtotal ?? 0) || 0,
      });
    }
    calcDirectContractsByMember.set(mid, items);
  }

  // contractRowsRes 의 raw 계약 데이터를 contract_id → 기본 정보 맵으로 변환 (v2 정적 필터 거치지 않음)
  type RawContractRow = {
    id: string;
    contract_code: string;
    join_date: string | null;
    item_name?: string | null;
    sales_member_id: string;
    customer_id: string | null;
    customers?: { name?: string | null } | null;
    happy_call_at?: string | null;
    happycall_result?: string | null;
    invoice_no?: string | null;
    memo?: string | null;
    rental_request_no?: string | null;
    status?: string | null;
    is_cancelled?: boolean | null;
    settlement_sales_member_id?: string | null;
  };
  const contractMetaById = new Map<
    string,
    {
      contract_code: string;
      customer_name: string;
      join_ymd: string;
      happycall_ymd: string;
      item_name: string | null;
      unit_count: number;
      raw_sales_member_id: string;
      override_sales_member_id: string | null;
      effective_sales_member_id: string;
      origin: string;
      display_status: string;
    }
  >();
  for (const r of (contractRowsRes.data ?? []) as unknown as Array<RawContractRow & { unit_count?: number | null }>) {
    const id = r.id;
    if (!id) continue;
    const rawSalesMemberId = String(r.sales_member_id ?? '');
    const overrideId = (r.settlement_sales_member_id ?? null) as string | null;
    const effectiveSalesMemberId = (overrideId && overrideId.trim() !== '' ? overrideId : rawSalesMemberId) as string;
    contractMetaById.set(id, {
      contract_code: String(r.contract_code ?? ''),
      customer_name: String(r.customers?.name ?? '-'),
      join_ymd: String(r.join_date ?? '').slice(0, 10),
      happycall_ymd: happycallYmdSeoul(r.happy_call_at ?? null),
      item_name: (r.item_name ?? null) as string | null,
      unit_count: Number((r as any).unit_count ?? 0) || 0,
      raw_sales_member_id: rawSalesMemberId,
      override_sales_member_id: overrideId,
      effective_sales_member_id: effectiveSalesMemberId,
      origin: attributedSalesMemberId({
        customer_id: (r.customer_id ?? null) as string | null,
        sales_member_id: rawSalesMemberId,
      }),
      display_status: getContractDisplayStatus({
        status: String(r.status ?? ''),
        rental_request_no: (r.rental_request_no ?? null) as string | null,
        invoice_no: (r.invoice_no ?? null) as string | null,
        memo: (r.memo ?? null) as string | null,
      }),
    });
  }

  // join_date 윈도우 밖의 rollup 대상 계약이 있으면 추가로 조회해 보강
  type RollupRowOut = {
    contract_id: string;
    contract_code: string;
    customer_name: string;
    join_ymd: string;
    happycall_ymd: string;
    item_name: string | null;
    unit_count: number;
    raw_sales_member_id: string;
    override_sales_member_id: string | null;
    effective_sales_member_id: string;
    origin: string;
    from_member_id: string;
    from_member_name: string;
    from_rank: string;
    rollup_amount_per_unit: number;
    rollup_amount: number;
    display_status: string;
    missingMeta: boolean;
  };

  const rollupItems = (rootCalcDetail?.rollup_items ?? []) as Array<{
    from_member_id: string;
    from_member_name: string;
    from_rank: string;
    unit_count: number;
    rollup_amount_per_unit: number;
    subtotal: number;
  }>;

  // 누락된 contract id 들을 한 번에 보강 조회
  // Rollup 후보는 root subtree 내 모든 멤버(본인 제외)의 direct_contracts 이므로,
  // 그 범위까지 모두 prefetch 한다.
  const neededContractIds = new Set<string>();
  for (const subMemberId of subtreeIds) {
    if (subMemberId === memberId) continue;
    const cs = calcDirectContractsByMember.get(subMemberId) ?? [];
    for (const c of cs) {
      if (!contractMetaById.has(c.contract_id)) neededContractIds.add(c.contract_id);
    }
  }
  if (neededContractIds.size > 0) {
    const ids = [...neededContractIds];
    // Supabase in() 의 인자 수 제한을 고려하여 청크 처리
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 500) chunks.push(ids.slice(i, i + 500));
    for (const cidChunk of chunks) {
      const { data } = await db
        .from('contracts')
        .select(
          'id, contract_code, join_date, status, unit_count, item_name, sales_member_id, customer_id, settlement_sales_member_id, rental_request_no, invoice_no, memo, happy_call_at, customers(name)',
        )
        .in('id', cidChunk);
      for (const r of (data ?? []) as unknown as Array<RawContractRow & { unit_count?: number | null }>) {
        const id = r.id;
        if (!id || contractMetaById.has(id)) continue;
        const rawSalesMemberId = String(r.sales_member_id ?? '');
        const overrideId = (r.settlement_sales_member_id ?? null) as string | null;
        const effectiveSalesMemberId = (overrideId && overrideId.trim() !== '' ? overrideId : rawSalesMemberId) as string;
        contractMetaById.set(id, {
          contract_code: String(r.contract_code ?? ''),
          customer_name: String(r.customers?.name ?? '-'),
          join_ymd: String(r.join_date ?? '').slice(0, 10),
          happycall_ymd: happycallYmdSeoul(r.happy_call_at ?? null),
          item_name: (r.item_name ?? null) as string | null,
          unit_count: Number((r as any).unit_count ?? 0) || 0,
          raw_sales_member_id: rawSalesMemberId,
          override_sales_member_id: overrideId,
          effective_sales_member_id: effectiveSalesMemberId,
          origin: attributedSalesMemberId({
            customer_id: (r.customer_id ?? null) as string | null,
            sales_member_id: rawSalesMemberId,
          }),
          display_status: getContractDisplayStatus({
            status: String(r.status ?? ''),
            rental_request_no: (r.rental_request_no ?? null) as string | null,
            invoice_no: (r.invoice_no ?? null) as string | null,
            memo: (r.memo ?? null) as string | null,
          }),
        });
      }
    }
  }

  // 정책 단가 계산용 컨텍스트
  // - calculator.ts 의 calcRollupItemsWithLeaderPromotion 은 root 의 "직접 자식" 별로 subtree
  //   전체 계약(자손 포함)의 합 subtotal 과 그 평균(subtotal/childUnits) 을 RollupItem 으로 저장한다.
  //   따라서 RollupItem.from_member_id 는 root 의 직접 자식만, from_rank 는 그 자식의 직급이라
  //   계약별 실제 담당자/단가 정보가 아니다.
  // - 화면에서 계약별 정확한 Rollup 단가를 표시하려면 root subtree 내 모든 멤버의 direct_contracts
  //   를 직접 모아 (rootRank − contractEffectiveSalesMemberRank) 정책 단가를 계약별로 산정해야 한다.
  // - 정책 단가가 0 이면 그 계약은 본 root 에게 rollup 이 발생하지 않으므로 행에서 제외한다.
  // - 산하 리더 승격 게이트(isDownlineEligibleForLeaderGate) 도 동일하게 적용해 정산 본체와 분류 기준을 맞춘다.
  // - 합계 검증은 그대로 monthly_settlements.rollup_commission 과 비교한다 (= SSOT).
  const settlementRules = ((rulesRes.data ?? []) as SettlementRule[]) ?? [];
  const policyRefDate = `${yearMonth}-25`;
  const rootRankForRollup = (rootRank || (member as { rank?: string }).rank || '') as RankType;
  const policyRateByRank = new Map<string, number>();
  const getPolicyRateForRank = (fromRank: string): number => {
    const key = String(fromRank ?? '');
    if (policyRateByRank.has(key)) return policyRateByRank.get(key)!;
    const fromRankType = key as RankType;
    let rate = 0;
    try {
      rate = getRollupAmountPerUnit(rootRankForRollup, fromRankType, settlementRules, policyRefDate);
    } catch {
      rate = 0;
    }
    policyRateByRank.set(key, rate);
    return rate;
  };

  // 계약 단가 산정 시 사용할 "계약 시점의 historic rank".
  //
  // 정산 본체(`calcRollupItemsWithLeaderPromotion` + `commissionPerUnitForDirectContract`)는
  // 계약 단위로 leader_rank_effective_at / promotion threshold 를 보고 단가를 분기한다.
  // 화면도 같은 기준을 따라야 한다:
  //   - effective member 가 현재는 리더라도, leader_rank_effective_at 이전(joinYmd < eff) 계약은
  //     "그 시점에는 영업사원" 이었으므로 lower rank='영업사원' 로 보고 정책 단가를 계산한다.
  //   - 그렇지 않으면 현재 직급 그대로 사용.
  //
  // 이 처리가 없으면 `리더 - 리더 = 0` 으로 빠져 산하 리더 승격 전 계약이 화면에서 누락된다.
  const getHistoricRankForPolicy = (effectiveMemberId: string, joinYmd: string): string => {
    const currentRank = rankById.get(effectiveMemberId) ?? '';
    if (currentRank !== '리더') return currentRank;
    const eff = leaderEffectiveAtById.get(effectiveMemberId) ?? null;
    if (!eff) return currentRank;
    const effYmd = String(eff).slice(0, 10);
    if (!effYmd || !joinYmd) return currentRank;
    if (joinYmd < effYmd) return '영업사원';
    return currentRank;
  };

  // root 의 직접 자식 path 매핑: subtree 내 임의 멤버에서 root 까지 거슬러 올라갈 때 마지막으로 통과하는
  // (=root 직전) 노드. 이 값을 "Rollup 귀속 가지" 컬럼에 표시한다.
  const rootDirectChildById = new Map<string, string>();
  for (const mid of subtreeIds) {
    if (mid === memberId) continue;
    let cur: string | null = mid;
    let last: string | null = null;
    const seen = new Set<string>();
    while (cur && cur !== memberId && !seen.has(cur)) {
      seen.add(cur);
      last = cur;
      cur = parentByChild.get(cur) ?? null;
    }
    if (cur === memberId && last) rootDirectChildById.set(mid, last);
  }
  const rollupItemByFromId = new Map<string, (typeof rollupItems)[number]>();
  for (const it of rollupItems) rollupItemByFromId.set(it.from_member_id, it);

  const isDev = process.env.NODE_ENV == 'production';

  // root subtree 내 모든 멤버(본인 제외) 의 direct_contracts 를 평탄화해 rollup 후보로 수집한다.
  const rollupRows: RollupRowOut[] = [];
  for (const subMemberId of subtreeIds) {
    if (subMemberId === memberId) continue;
    const directs = calcDirectContractsByMember.get(subMemberId) ?? [];
    for (const c of directs) {
      const meta = contractMetaById.get(c.contract_id) ?? null;
      const unit = meta?.unit_count ?? c.unit_count ?? 0;
      const effectiveMemberId = meta?.effective_sales_member_id ?? subMemberId;
      const effectiveRank = rankById.get(effectiveMemberId) ?? '';
      const historicRank = getHistoricRankForPolicy(effectiveMemberId, meta?.join_ymd ?? '');
      const policyRate = getPolicyRateForRank(historicRank);

      const gateOk = isDownlineEligibleForLeaderGate(effectiveMemberId, meta?.join_ymd ?? '');
      const includeRow = gateOk && policyRate > 0;

      const rootChildId =
        rootDirectChildById.get(effectiveMemberId) ?? rootDirectChildById.get(subMemberId) ?? subMemberId;
      const matchedFromItem = rollupItemByFromId.get(rootChildId) ?? null;

      if (isDev) {
        // eslint-disable-next-line no-console
        console.log('[rollup-detail-rate]', {
          rootMemberId: memberId,
          rootRank: rootRankForRollup,
          subtreeOwnerMemberId: subMemberId,
          contractId: c.contract_id,
          effectiveSalesMemberId: effectiveMemberId,
          contractEffectiveRank: effectiveRank,
          historicRankForPolicy: historicRank,
          rootDirectChildId: rootChildId,
          rootDirectChildRank: rankById.get(rootChildId) ?? null,
          policyRate,
          fallbackAvgRate: matchedFromItem?.rollup_amount_per_unit ?? null,
          gateOk,
          includeRow,
        });
      }

      if (!includeRow) continue;

      rollupRows.push({
        contract_id: c.contract_id,
        contract_code: meta?.contract_code ?? c.contract_id,
        customer_name: meta?.customer_name ?? '-',
        join_ymd: meta?.join_ymd ?? '',
        happycall_ymd: meta?.happycall_ymd ?? '',
        item_name: meta?.item_name ?? null,
        unit_count: unit,
        raw_sales_member_id: meta?.raw_sales_member_id ?? subMemberId,
        override_sales_member_id: meta?.override_sales_member_id ?? null,
        effective_sales_member_id: effectiveMemberId,
        origin: meta?.origin ?? subMemberId,
        from_member_id: rootChildId,
        from_member_name: nameById.get(rootChildId) ?? rootChildId,
        from_rank: rankById.get(rootChildId) ?? '',
        rollup_amount_per_unit: policyRate,
        rollup_amount: Math.max(0, Math.round(unit * policyRate)),
        display_status: meta?.display_status ?? '-',
        missingMeta: !meta,
      });
    }
  }
  rollupRows.sort((a, b) => (b.join_ymd ?? '').localeCompare(a.join_ymd ?? ''));

  const rollupItemsSubtotalSum = rollupItems.reduce((s, it) => s + (Number(it.subtotal ?? 0) || 0), 0);
  const rollupContractCount = rollupRows.length;
  const rollupUnitSum = rollupRows.reduce((s, r) => s + Number(r.unit_count ?? 0), 0);
  const rollupAmountSum = rollupRows.reduce((s, r) => s + Number(r.rollup_amount ?? 0), 0);

  // 합계 검증: detail rollup 합 vs monthly_settlements.rollup_commission
  const rollupMismatch = Math.round(rollupItemsSubtotalSum) !== Math.round(rootRollupWon);
  const rollupContractDistributionMismatch = Math.round(rollupAmountSum) !== Math.round(rollupItemsSubtotalSum);

  const displayName = String(member.name ?? '').replace(/^\[고객\]\s*/, '');

  // 정산 담당자 표시 도우미
  const labelOfMember = (id: string | null | undefined): string => {
    if (!id) return '-';
    return nameById.get(id) ?? id;
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="text-xs text-gray-500">
            <Link className="text-blue-600 hover:underline" href={`/admin/settlement?year_month=${yearMonth}`}>
              정산 현황
            </Link>
            <span className="mx-1">/</span>
            <span>정산 상세</span>
          </div>
          <h2 className="text-2xl font-bold text-gray-800 mt-2">
            {displayName} · {yearMonth}
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            기준 {start_date}~{end_date}
          </p>
        </div>
      </div>

      {/* 합계 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <SummaryCard label="직접구좌 수" value={`${directRows.length.toLocaleString('ko-KR')}건 / ${directUnitSum.toLocaleString('ko-KR')}구좌`} />
        <SummaryCard label="직접구좌 정산금 합계" value={formatWon(directWonSum)} accent="emerald" />
        <SummaryCard label="산하구좌 수" value={`${downlineRows.length.toLocaleString('ko-KR')}건 / ${downlineUnitSum.toLocaleString('ko-KR')}구좌`} />
        <SummaryCard
          label="Rollup 대상"
          value={`${rollupContractCount.toLocaleString('ko-KR')}건 / ${rollupUnitSum.toLocaleString('ko-KR')}구좌`}
          accent="amber"
          hint={`from_member ${rollupItems.length.toLocaleString('ko-KR')}명`}
        />
        <SummaryCard
          label="Rollup 수당 합계"
          value={formatWon(rootRollupWon)}
          accent="amber"
          hint={`상세 분배 합 ${formatWon(rollupAmountSum)} / detail subtotal 합 ${formatWon(rollupItemsSubtotalSum)}`}
        />
        <SummaryCard
          label="전체 정산금 합계"
          value={formatWon(rootTotalWon)}
          accent="indigo"
          hint={rootMs ? `기본 ${formatWon(rootMs.base_commission ?? 0)} + 산하 ${formatWon(rootRollupWon)} + 보너스 ${formatWon(rootIncentiveWon)}` : '월정산 결과 없음'}
        />
      </div>

      {/* 직접구좌 섹션 */}
      <SectionTitle title="직접구좌 계약 내역" countLabel={`${directRows.length.toLocaleString('ko-KR')}건 · ${directUnitSum.toLocaleString('ko-KR')}구좌 · ${formatWon(directWonSum)}`} />
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden mb-8">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {[
                  '계약코드', '고객명', '가입일', '해피콜일', '물품명', '표시상태', '구좌',
                  '귀속(산하)', '원 담당자', '정산 담당자', '정산금액',
                ].map((h) => (
                  <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-gray-600 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {directRows.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-6 py-10 text-center text-sm text-gray-500">
                    직접구좌 계약이 없습니다.
                  </td>
                </tr>
              )}
              {directRows.map((r) => (
                <ContractRow
                  key={r.contract_id}
                  r={r}
                  labelOfMember={labelOfMember}
                  showOverrideBadge={!!r.override_sales_member_id}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 산하구좌 섹션 */}
      <SectionTitle
        title="산하구좌 계약 내역"
        countLabel={`${downlineRows.length.toLocaleString('ko-KR')}건 · ${downlineUnitSum.toLocaleString('ko-KR')}구좌 · 산하 직접수당 합 ${formatWon(downlineMemberDirectWonSum)} · 본인 rollup ${formatWon(rootRollupWon)}`}
      />
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {[
                  '계약코드', '고객명', '가입일', '해피콜일', '물품명', '표시상태', '구좌',
                  '귀속(산하)', '원 담당자', '정산 담당자', '산하 담당자 정산금(직접)',
                ].map((h) => (
                  <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-gray-600 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {downlineRows.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-6 py-10 text-center text-sm text-gray-500">
                    산하구좌 계약이 없습니다.
                  </td>
                </tr>
              )}
              {downlineRows.map((r) => (
                <ContractRow
                  key={r.contract_id}
                  r={r}
                  labelOfMember={labelOfMember}
                  showOverrideBadge={!!r.override_sales_member_id}
                />
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-3 text-xs text-gray-500 border-t border-gray-100">
          ※ "산하 담당자 정산금(직접)" 은 그 계약을 직접 담당한 산하 멤버의 직접 수당입니다.
          본인({displayName})에게 반영되는 금액은 아래 "Rollup 수당 발생 계약 내역" 으로 표시됩니다.
        </p>
      </div>

      {/* Rollup 수당 발생 계약 내역 */}
      <div className="mt-10" />
      <SectionTitle
        title="Rollup 수당 발생 계약 내역"
        countLabel={`${rollupContractCount.toLocaleString('ko-KR')}건 · ${rollupUnitSum.toLocaleString('ko-KR')}구좌 · 분배 합 ${formatWon(rollupAmountSum)} · 정산 rollup_commission ${formatWon(rootRollupWon)}`}
      />

      {/* 합계 검증 경고 */}
      {(rollupMismatch || rollupContractDistributionMismatch) && (
        <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          {rollupMismatch && (
            <p>
              ⚠ 상세 rollup 합계({formatWon(rollupItemsSubtotalSum)})와 정산
              rollup_commission({formatWon(rootRollupWon)})이 일치하지 않습니다. 정산 재계산 또는
              calculation_detail 저장 구조를 확인해주세요.
            </p>
          )}
          {rollupContractDistributionMismatch && (
            <p className={rollupMismatch ? 'mt-1' : ''}>
              ⚠ 계약 단위로 분배한 rollup 합({formatWon(rollupAmountSum)})이 detail subtotal 합(
              {formatWon(rollupItemsSubtotalSum)})과 일치하지 않습니다. 일부 계약 정보가 누락되었거나
              from_member 단위 unit_count 와 direct_contracts unit_count 가 다를 수 있습니다.
            </p>
          )}
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {[
                  '계약코드', '고객명', '가입일', '해피콜일', '물품명', '구좌',
                  '실제 정산 담당자', '원본 담당자', '정산 override',
                  'Rollup 대상 산하', 'Rollup 단가', 'Rollup 금액',
                ].map((h) => (
                  <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-gray-600 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rollupRows.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-6 py-10 text-center text-sm text-gray-500">
                    Rollup 수당이 발생한 계약이 없습니다.
                  </td>
                </tr>
              )}
              {rollupRows.map((r) => (
                <tr key={`${r.from_member_id}__${r.contract_id}`} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-mono text-xs text-gray-700 whitespace-nowrap">
                    {r.contract_code}
                    {r.missingMeta && (
                      <span className="ml-1 inline-block px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 text-[10px] align-middle">
                        meta?
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.customer_name}</td>
                  <td className="px-3 py-2 tabular-nums text-gray-600 whitespace-nowrap">{r.join_ymd || '-'}</td>
                  <td className="px-3 py-2 tabular-nums text-gray-600 whitespace-nowrap">{r.happycall_ymd || '-'}</td>
                  <td className="px-3 py-2 text-xs text-gray-700 whitespace-nowrap">{r.item_name ?? '-'}</td>
                  <td className="px-3 py-2 tabular-nums text-right whitespace-nowrap">{Number(r.unit_count ?? 0).toLocaleString('ko-KR')}</td>
                  <td className="px-3 py-2 text-xs text-gray-700 whitespace-nowrap">
                    {labelOfMember(r.effective_sales_member_id)}
                    {r.override_sales_member_id && (
                      <span className="ml-1 inline-block px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] align-middle">
                        override
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{labelOfMember(r.raw_sales_member_id)}</td>
                  <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
                    {r.override_sales_member_id ? labelOfMember(r.override_sales_member_id) : '-'}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-700 whitespace-nowrap">
                    {labelOfMember(r.from_member_id)}
                    {r.from_rank && (
                      <span className="ml-1 text-[10px] text-gray-400 align-middle">({r.from_rank})</span>
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-right whitespace-nowrap text-xs text-gray-600">
                    {formatWon(r.rollup_amount_per_unit)} <span className="text-gray-400">/구좌</span>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-right whitespace-nowrap font-semibold text-amber-700">
                    {formatWon(r.rollup_amount)}
                  </td>
                </tr>
              ))}
            </tbody>
            {rollupRows.length > 0 && (
              <tfoot className="bg-gray-50">
                <tr>
                  <td colSpan={5} className="px-3 py-2 text-xs text-gray-600 text-right">합계</td>
                  <td className="px-3 py-2 tabular-nums text-right text-xs">{rollupUnitSum.toLocaleString('ko-KR')}</td>
                  <td colSpan={5} />
                  <td className="px-3 py-2 tabular-nums text-right text-xs font-semibold text-amber-700">
                    {formatWon(rollupAmountSum)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <p className="px-4 py-3 text-xs text-gray-500 border-t border-gray-100">
          ※ Rollup 수당 발생 계약 내역은 monthly_settlements.calculation_detail.rollup_items
          (SSOT) 의 from_member 단위 금액을 그 멤버의 direct_contracts 의 unit_count × rollup
          단가로 분배한 결과입니다. 분배 합과 detail subtotal 합이 일치하지 않으면 상단에 경고가
          표시됩니다.
        </p>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  accent,
  hint,
}: {
  label: string;
  value: string;
  accent?: 'emerald' | 'amber' | 'indigo';
  hint?: string;
}) {
  const accentClass =
    accent === 'emerald'
      ? 'text-emerald-700'
      : accent === 'amber'
        ? 'text-amber-700'
        : accent === 'indigo'
          ? 'text-indigo-700'
          : 'text-gray-800';
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-sm">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-base font-semibold tabular-nums ${accentClass}`}>{value}</div>
      {hint && <div className="mt-1 text-[11px] text-gray-400">{hint}</div>}
    </div>
  );
}

function SectionTitle({ title, countLabel }: { title: string; countLabel: string }) {
  return (
    <div className="mb-2 flex items-end justify-between">
      <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
      <p className="text-xs text-gray-500 tabular-nums">{countLabel}</p>
    </div>
  );
}

type ContractRowProps = {
  r: {
    contract_id: string;
    contract_code: string;
    join_ymd: string;
    happycall_ymd: string;
    unit_count: number;
    customer_name: string;
    item_name: string | null;
    display_status: string;
    origin: string;
    raw_sales_member_id: string;
    override_sales_member_id: string | null;
    effective_sales_member_id: string;
    settlement_won: number;
  };
  labelOfMember: (id: string | null | undefined) => string;
  showOverrideBadge: boolean;
};

function ContractRow({ r, labelOfMember, showOverrideBadge }: ContractRowProps) {
  return (
    <tr className="hover:bg-gray-50">
      <td className="px-3 py-2 font-mono text-xs text-gray-700 whitespace-nowrap">
        {r.contract_code}
      </td>
      <td className="px-3 py-2 whitespace-nowrap">{r.customer_name}</td>
      <td className="px-3 py-2 tabular-nums text-gray-600 whitespace-nowrap">{r.join_ymd}</td>
      <td className="px-3 py-2 tabular-nums text-gray-600 whitespace-nowrap">{r.happycall_ymd || '-'}</td>
      <td className="px-3 py-2 text-xs text-gray-700 whitespace-nowrap">{r.item_name ?? '-'}</td>
      <td className="px-3 py-2 whitespace-nowrap">{r.display_status}</td>
      <td className="px-3 py-2 tabular-nums text-right whitespace-nowrap">{Number(r.unit_count ?? 0).toLocaleString('ko-KR')}</td>
      <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">{labelOfMember(r.origin)}</td>
      <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{labelOfMember(r.raw_sales_member_id)}</td>
      <td className="px-3 py-2 text-xs text-gray-700 whitespace-nowrap">
        {labelOfMember(r.effective_sales_member_id)}
        {showOverrideBadge && (
          <span className="ml-1 inline-block px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] align-middle">
            override
          </span>
        )}
      </td>
      <td className="px-3 py-2 tabular-nums text-right whitespace-nowrap">
        ₩{Math.round(Number(r.settlement_won) || 0).toLocaleString('ko-KR')}
      </td>
    </tr>
  );
}
