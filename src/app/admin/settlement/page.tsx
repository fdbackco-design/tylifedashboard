import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import YearMonthSelector from '@/components/YearMonthSelector';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { buildOrgTree, formatKRW } from '@/lib/settlement/calculator';
import { getSettlementWindowForYearMonth, getSettlementWindowSeoul } from '@/lib/settlement/settlement-window';
import { BASE_AMOUNT_PER_UNIT } from '@/lib/settlement/constants';
import type { RankType } from '@/lib/types';
import type { SettlementCalculationDetail } from '@/lib/types/settlement';
import RecalcButton from './RecalcButton';
import { isOrgDisplayHiddenMemberName } from '@/lib/organization/org-display-hidden';
import { extractMemberName } from '@/lib/utils/normalize-member-name';
import SettlementLineTableClient, { type SettlementLineRow } from './SettlementLineTableClient';
import {
  computeSalesMemberPromotionThreshold,
  type AttributedJoinContractRow,
} from '@/lib/settlement/leader-promotion';
import {
  loadStatementDownlineSharedData,
  computeStatementDownlineUnitsWithSharedContext,
  loadGlobalStatementWindowContractPool,
} from '@/lib/organization/statement-downline-units';

export const metadata: Metadata = { title: '정산 현황' };
export const dynamic = 'force-dynamic';

const RANKS: RankType[] = ['영업사원', '리더', '센터장', '사업본부장'];

interface PageProps {
  searchParams: Promise<{
    year_month?: string;
    rank?: string;
    member_id?: string;
  }>;
}

function nextDay(dateYmd: string): string {
  const [y, m, d] = dateYmd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export default async function SettlementPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const todayYearMonth = getSettlementWindowSeoul().label_year_month;
  const yearMonth = params.year_month ?? todayYearMonth;
  const rankFilter = params.rank as RankType | undefined;

  if (params.member_id) {
    const sp = new URLSearchParams();
    sp.set('year_month', yearMonth);
    sp.set('member_id', params.member_id);
    redirect(`/admin/settlement/member?${sp.toString()}`);
  }

  const db = createAdminSupabaseClient();

  // 해당 월 계약 현황 (정산 대상 여부 파악용)
  // 목록 전체를 내려받지 말고 count만 조회 (빠름)
  const { start_date, end_date } = getSettlementWindowForYearMonth(yearMonth);
  const endExclusive = nextDay(end_date);

  const [allCountRes, eligibleCountRes, kpiRes] = await Promise.all([
    db
      .from('contracts')
      .select('id', { head: true, count: 'estimated' })
      .gte('join_date', start_date)
      .lt('join_date', endExclusive),
    db
      // 정산 대상 계약 수: “가입 인정 기준” (SSOT) 과 동일하게
      // DB view(v_contract_settlement_base)는 동일 기준으로 필터링되어야 함
      .from('v_contract_settlement_base')
      .select('contract_id', { head: true, count: 'estimated' })
      .eq('year_month', yearMonth),
    db.rpc('get_organization_kpis', { p_start_date: start_date, p_end_date: end_date }),
  ]);

  const allContractsCount = allCountRes.count ?? 0;
  const eligibleContractsCount = eligibleCountRes.count ?? 0;

  // 조직도 결과(실지급액) → 정산현황 기본수당에 반영
  const [membersRes, edgesRes, eligibleBaseRes, rulesRes] = await Promise.all([
    db
      .from('organization_members')
      .select('id, name, rank, external_id, phone, source_customer_id, leader_rank_effective_at')
      .eq('is_active', true),
    db.from('organization_edges').select('parent_id, child_id'),
    db
      .from('v_contract_settlement_base')
      .select('contract_id, contract_code, join_date, unit_count, status, is_cancelled, sales_member_id')
      .eq('year_month', yearMonth),
    db.from('settlement_rules').select('*'),
  ]);

  const membersRaw = (((membersRes.data ?? []) as unknown as any[]) ?? []).map((m) =>
    m.name === '안성준' ? { ...m, rank: '본사' as const } : m,
  );
  const leaderRankEffectiveAtByMemberId: Record<string, string | null> = {};
  for (const m of membersRaw as Array<{ id: string; leader_rank_effective_at?: string | null }>) {
    leaderRankEffectiveAtByMemberId[String(m.id)] = (m.leader_rank_effective_at ?? null) as string | null;
  }
  const edgesRaw = (edgesRes.data ?? []) as Array<{ parent_id: string | null; child_id: string }>;

  const hqIdsRaw = new Set(
    membersRaw.filter((m) => m.name === '안성준' || m.rank === '본사').map((m) => m.id as string),
  );
  const hqIdForTree =
    membersRaw.find((m) => m.name === '안성준')?.id ?? (hqIdsRaw.values().next().value ?? null);

  const memberIdSet = new Set(membersRaw.map((m) => m.id as string));
  const edgeMap = new Map<string, string | null>();
  for (const e of edgesRaw) {
    const parent_id = e.parent_id && memberIdSet.has(e.parent_id) ? e.parent_id : null;
    if (!memberIdSet.has(e.child_id)) continue;
    edgeMap.set(e.child_id, parent_id);
  }

  const treeRows = membersRaw.map((m) => ({
    id: m.id as string,
    name: extractMemberName(m.name),
    rank: m.rank as RankType,
    parent_id:
      m.rank === '본사'
        ? null
        : (edgeMap.get(m.id as string) ?? null),
    depth: 0,
  }));

  const roots = buildOrgTree(treeRows as any[]);
  const parentByChildForTree = new Map<string, string | null>();
  const rankByIdForTree = new Map<string, RankType>();
  const nameByIdForTree = new Map<string, string>();
  for (const r of treeRows as any[]) {
    parentByChildForTree.set(r.id as string, (r.parent_id ?? null) as string | null);
    rankByIdForTree.set(r.id as string, r.rank as RankType);
    nameByIdForTree.set(r.id as string, r.name as string);
  }
  const rankByMemberId: Record<string, string> = {};
  for (const [id, rank] of rankByIdForTree.entries()) rankByMemberId[id] = rank;

  // parent -> children (preview UI용)
  const childrenByParent: Record<string, string[]> = {};
  for (const r of treeRows as any[]) {
    const pid = (r.parent_id ?? null) as string | null;
    if (!pid) continue;
    if (!childrenByParent[pid]) childrenByParent[pid] = [];
    childrenByParent[pid].push(r.id as string);
  }

  const getTopLineId = (memberId: string): string => {
    // 본사(hq) 바로 아래 라인(최상위 노드)을 찾는다.
    // treeRows의 parent_id 규칙(본사 직속 customer/source_customer_id 등)을 그대로 따른다.
    let cur = memberId;
    for (let i = 0; i < 64; i++) {
      const p = parentByChildForTree.get(cur) ?? null;
      if (!p) return cur; // 루트 라인
      if (hqIdsRaw.has(p)) return cur; // 본사 직속
      cur = p;
    }
    return memberId;
  };

  const baseRows = (eligibleBaseRes.data ?? []) as Array<{
    contract_id: string;
    contract_code: string;
    join_date: string | null;
    unit_count: number | null;
    status: string;
    is_cancelled: boolean;
    sales_member_id: string;
  }>;
  const contractIds = baseRows.map((r) => r.contract_id);
  const { data: contractCustomerRows } = await db
    .from('contracts')
    .select('id, customer_id, item_name, created_at')
    .in('id', contractIds);
  const customerIdByContractId = new Map<string, string>();
  const itemNameByContractId = new Map<string, string | null>();
  const createdAtByContractId = new Map<string, string | null>();
  for (const r of (contractCustomerRows ?? []) as Array<{
    id: string;
    customer_id: string;
    item_name?: string | null;
    created_at?: string | null;
  }>) {
    customerIdByContractId.set(r.id, r.customer_id);
    itemNameByContractId.set(r.id, (r as any).item_name ?? null);
    createdAtByContractId.set(r.id, (r.created_at ?? null) as string | null);
  }

  // customer_id -> member_id (source_customer_id 우선, 없으면 external_id=customer:* 사용)
  const memberIdByCustomerId = new Map<string, string>();
  for (const m of membersRaw as any[]) {
    const sid = (m.source_customer_id ?? null) as string | null;
    if (sid) {
      memberIdByCustomerId.set(sid, m.id as string);
      continue;
    }
    const ext = (m.external_id ?? null) as string | null;
    if (ext && ext.startsWith('customer:')) {
      memberIdByCustomerId.set(ext.slice('customer:'.length), m.id as string);
    }
  }

  // /organization과 동일 정책:
  // - customer_id가 조직원(고객 노드/가상 노드 포함)으로 매핑되면, 담당자와 무관하게 그 노드의 "직접 계약"으로 귀속한다.
  // - 그 외에 본사 담당(HQ)인 계약도 동일하게 customer 노드로 치환한다.
  const eligibleContracts = baseRows.map((r) => {
    const customer_id = customerIdByContractId.get(r.contract_id) ?? null;
    const item_name = itemNameByContractId.get(r.contract_id) ?? null;
    const created_at = createdAtByContractId.get(r.contract_id) ?? null;
    const raw_sales_member_id = r.sales_member_id;
    let sales_member_id = r.sales_member_id;
    const mappedCustomerMemberId = customer_id ? (memberIdByCustomerId.get(customer_id) ?? null) : null;
    if (customer_id) {
      if (mappedCustomerMemberId) {
        sales_member_id = mappedCustomerMemberId;
      } else if (hqIdsRaw.has(r.sales_member_id)) {
        // fallback (HQ only): customer 매핑이 존재할 때만 치환 가능하므로 여기선 그대로 둔다
      }
    }
    // "본인 고객 계약"은 단순 customer 매핑 존재가 아니라,
    // 고객으로 매핑된 멤버와 원 담당자(raw_sales_member_id)가 동일한 경우에만 true.
    // (그 외는 일반 담당자 직접 계약으로 처리되어야 산하 분리 시 최상위로 과도 귀속되지 않음)
    const is_self_customer_contract =
      !!customer_id &&
      mappedCustomerMemberId != null &&
      mappedCustomerMemberId === raw_sales_member_id;
    return {
      ...r,
      id: r.contract_id,
      customer_id,
      raw_sales_member_id,
      sales_member_id,
      unit_count: r.unit_count ?? 0,
      item_name,
      created_at,
      is_self_customer_contract,
    };
  });

  // 조직도 페이지와 동일한 "정책 승격(산하 가입 누적 20구좌)" 직급 보정(표시용)
  // - 동기화/정산 재계산 없이도 조직도에서 리더로 보이는 케이스가 있어,
  //   정산 현황에서도 같은 기준으로 effective rank를 맞춘다.
  {
    const rankByIdForThreshold = new Map<string, any>();
    for (const m of membersRaw as any[]) {
      rankByIdForThreshold.set(m.id as string, (m.rank === '리더' ? '영업사원' : m.rank) as any);
    }
    const joinAttributedForThreshold: AttributedJoinContractRow[] = eligibleContracts
      .filter((c: any) => !c.is_cancelled)
      .map((c: any) => ({
        id: String(c.id ?? ''),
        join_date: String(c.join_date ?? '').slice(0, 10),
        unit_count: Number(c.unit_count ?? 0),
        sales_member_id: String(c.sales_member_id ?? ''),
        created_at: (c.created_at ?? null) as string | null,
      }))
      .filter((c) => !!c.id && !!c.join_date && !!c.sales_member_id);

    const promotionThresholdByMemberId = computeSalesMemberPromotionThreshold(
      treeRows as any[],
      joinAttributedForThreshold,
      rankByIdForThreshold as any,
    );

    for (const [memberId, th] of promotionThresholdByMemberId.entries()) {
      if (!th) continue;
      // 승격자: 조직도와 동일하게 화면상 리더로 표시
      rankByMemberId[memberId] = '리더';
    }
  }

  // 정산현황 표의 "직접계약/직접구좌"도 위 귀속 기준으로 재계산
  const directByMember = new Map<string, { contractIds: Set<string>; unitSum: number }>();
  for (const c of eligibleContracts) {
    const mid = c.sales_member_id as string | null;
    if (!mid) continue;
    const id = c.id as string;
    const unit = (c.unit_count ?? 0) as number;
    const cur = directByMember.get(mid) ?? { contractIds: new Set<string>(), unitSum: 0 };
    if (!cur.contractIds.has(id)) {
      cur.contractIds.add(id);
      cur.unitSum += unit;
    }
    directByMember.set(mid, cur);
  }

  let query = db
    .from('monthly_settlements')
    .select(
      `
      id,
      year_month,
      member_id,
      rank,
      direct_contract_count,
      direct_unit_count,
      subordinate_unit_count,
      total_unit_count,
      base_commission,
      rollup_commission,
      incentive_amount,
      total_amount,
      calculation_detail,
      is_finalized,
      organization_members(name)
      `,
    )
    .eq('year_month', yearMonth)
    .order('total_amount', { ascending: false });

  if (rankFilter) query = query.eq('rank', rankFilter);

  const { data: settlements, error } = await query;

  if (error) {
    return (
      <div className="p-6">
        <p className="text-red-600 text-sm">정산 데이터 조회 실패: {error.message}</p>
      </div>
    );
  }

  // contract_id -> 기본수당(subtotal) (월정산 계산 결과에서 추출)
  const baseWonByContractId = new Map<string, number>();
  for (const s of (settlements ?? []) as any[]) {
    const detail = s.calculation_detail as SettlementCalculationDetail | null;
    for (const dc of detail?.direct_contracts ?? []) {
      const cid = String((dc as any).contract_id ?? '');
      if (!cid) continue;
      if (!baseWonByContractId.has(cid)) {
        baseWonByContractId.set(cid, Number((dc as any).subtotal ?? 0));
      }
    }
  }

  const contractBaseItems = eligibleContracts
    .map((c) => {
      const contractId = String((c as any).id ?? '');
      if (!contractId) return null;
      const baseWon = baseWonByContractId.get(contractId) ?? 0;
      return {
        contractId,
        baseWon,
        rawSalesMemberId: ((c as any).raw_sales_member_id ?? null) as string | null,
        mappedMemberId: ((c as any).sales_member_id ?? null) as string | null,
        isSelfCustomerContract: Boolean((c as any).is_self_customer_contract ?? false),
      };
    })
    .filter((v): v is {
      contractId: string;
      baseWon: number;
      rawSalesMemberId: string | null;
      mappedMemberId: string | null;
      isSelfCustomerContract: boolean;
    } => v != null);

  const ZERO_OUT_MEMBER_NAME = '정성은';

  const isZeroOutMember = (s: any): boolean => {
    const member = s.organization_members as unknown as { name?: string } | null;
    return (member?.name ?? '') === ZERO_OUT_MEMBER_NAME;
  };

  const isHiddenMember = (s: any): boolean => {
    const member = s.organization_members as unknown as { name?: string } | null;
    const name = member?.name ?? '';
    if (name.replace(/^\[고객\]\s*/, '').trim() === '안성준') return true;
    return isOrgDisplayHiddenMemberName(name);
  };

  const displayRows = (settlements ?? [])
    .map((s) => {
      const member = s.organization_members as unknown as { name: string } | null;
      const rawName = extractMemberName(member?.name);
      const displayName = rawName.replace(/^\[고객\]\s*/, '');
      const zeroOut = rawName === ZERO_OUT_MEMBER_NAME;
      const direct = directByMember.get(s.member_id as string) ?? { contractIds: new Set<string>(), unitSum: 0 };
      const detail = s.calculation_detail as SettlementCalculationDetail | null;
      const lp = detail?.leader_promotion ?? null;
      const base = zeroOut ? 0 : (s.base_commission as number) ?? 0;
      const rollup = zeroOut ? 0 : (s.rollup_commission as number) ?? 0;
      // "보너스" = 기존 유지장려금 + 2026-06 그룹 보너스(2구좌당 5만원).
      // 둘의 합은 monthly_settlements.incentive_amount에 그대로 저장돼 있다.
      const leaderMaint = zeroOut ? 0 : Number((s as any).incentive_amount ?? 0);
      const total = zeroOut ? 0 : (s.total_amount as number) ?? 0;
      return {
        s,
        rawName,
        displayName,
        zeroOut,
        base,
        rollup,
        leaderMaint,
        total,
        direct,
        lp,
        detail,
      };
    })
    .filter((r) => !isHiddenMember(r.s))
    // 본사 직속 "최상위 라인" 기준으로 그룹화(하위 노드는 라인 합계에 포함)
    .reduce(
      (acc, r) => {
        const memberId = r.s.member_id as string;
        const topLineId = getTopLineId(memberId);
        const topNameRaw = nameByIdForTree.get(topLineId) ?? r.displayName;
        const topDisplayName = topNameRaw.replace(/^\[고객\]\s*/, '');
        const key = topLineId;

        const prev = acc.get(key) ?? {
          topLineId,
          topDisplayName,
          topRank: rankByIdForTree.get(topLineId) ?? (r.s.rank as RankType),
          base: 0,
          rollup: 0,
          leaderMaint: 0,
          total: 0,
          direct_contract_ids: new Set<string>(),
          direct_unit_sum: 0,
        };

        prev.base += r.base;
        prev.rollup += r.rollup;
        prev.leaderMaint += r.leaderMaint;
        prev.total += r.total;

        for (const cid of r.direct.contractIds) prev.direct_contract_ids.add(cid);
        prev.direct_unit_sum += r.direct.unitSum;

        acc.set(key, prev);
        return acc;
      },
      new Map<
        string,
        {
          topLineId: string;
          topDisplayName: string;
          topRank: RankType;
          base: number;
          rollup: number;
          leaderMaint: number;
          total: number;
          direct_contract_ids: Set<string>;
          direct_unit_sum: number;
        }
      >(),
    );

  // 멤버별 월정산(기존 계산 결과) 메타/금액 맵 (클라이언트 preview 재집계용)
  const memberAggById: Record<
    string,
    {
      memberId: string;
      displayName: string;
      rank: string;
      base: number;
      rollup: number;
      leaderMaint: number;
      total: number;
      directContractCount: number;
      directUnitSum: number;
    }
  > = {};
  const topLineIdByMemberId: Record<string, string> = {};
  for (const r of (settlements ?? []) as any[]) {
    const memberId = String(r.member_id ?? '');
    if (!memberId) continue;
    const nameRaw = extractMemberName((r.organization_members as any)?.name);
    const displayName = nameRaw.replace(/^\[고객\]\s*/, '');
    const topLineId = getTopLineId(memberId);
    topLineIdByMemberId[memberId] = topLineId;
    const direct = directByMember.get(memberId) ?? { contractIds: new Set<string>(), unitSum: 0 };
    const zeroOut = nameRaw === ZERO_OUT_MEMBER_NAME;
    const base = zeroOut ? 0 : Number(r.base_commission ?? 0);
    const rollup = zeroOut ? 0 : Number(r.rollup_commission ?? 0);
    // "보너스" = 기존 유지장려금 + 2026-06 그룹 보너스. 합산값은 incentive_amount에 그대로 들어 있다.
    const leaderMaint = zeroOut ? 0 : Number(r.incentive_amount ?? 0);
    const total = zeroOut ? 0 : Number(r.total_amount ?? 0);
    memberAggById[memberId] = {
      memberId,
      displayName,
      rank: String(r.rank ?? ''),
      base,
      rollup,
      leaderMaint,
      total,
      directContractCount: direct.contractIds.size,
      directUnitSum: direct.unitSum,
    };
  }

  const displayLineRows = [...displayRows.values()]
    .filter((r) => {
      // 숨김/zero-out 멤버는 이미 월정산 row 단계에서 0이 되었지만,
      // 라인 합계가 의미 없게 되지 않도록 total=0 라인은 숨긴다(선택).
      return true;
    })
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      const nameCmp = a.topDisplayName.localeCompare(b.topDisplayName, 'ko-KR');
      if (nameCmp !== 0) return nameCmp;
      return a.topLineId.localeCompare(b.topLineId);
    });

  const totalAmount = displayLineRows.reduce((sum, r) => sum + (r.total ?? 0), 0);

  // /organization/statement 와 동일: 개인 실적 = 월정산 direct_unit_count, 산하 = 공통 스냅샷 기준 산하 집계
  const settlementMemberIds = [
    ...new Set(
      ((settlements ?? []) as Array<{ member_id?: string | null }>)
        .map((r) => String(r.member_id ?? '').trim())
        .filter(Boolean),
    ),
  ];
  const statementDirectUnitsByMemberId: Record<string, number> = {};
  for (const r of (settlements ?? []) as Array<{
    member_id?: string | null;
    direct_unit_count?: number | null;
  }>) {
    const mid = String(r.member_id ?? '').trim();
    if (!mid) continue;
    statementDirectUnitsByMemberId[mid] = Math.max(0, Math.floor(Number(r.direct_unit_count ?? 0) || 0));
  }
  const statementDownlineUnitsByMemberId: Record<string, number> = {};
  if (settlementMemberIds.length > 0) {
    const sharedDownline = await loadStatementDownlineSharedData(db);
    const window = { start_date, end_date };
    const preloadedGlobalPool = await loadGlobalStatementWindowContractPool(db, sharedDownline, window);
    const BATCH = 48;
    for (let i = 0; i < settlementMemberIds.length; i += BATCH) {
      const slice = settlementMemberIds.slice(i, i + BATCH);
      const results = await Promise.all(
        slice.map((mid) =>
          computeStatementDownlineUnitsWithSharedContext(
            db,
            sharedDownline,
            mid,
            window,
            statementDirectUnitsByMemberId[mid] ?? 0,
            leaderRankEffectiveAtByMemberId[mid] ?? null,
            { preloadedGlobalPool },
          ),
        ),
      );
      slice.forEach((mid, j) => {
        const res = results[j];
        statementDownlineUnitsByMemberId[mid] = typeof res === 'number' ? res : res.downline_units;
      });
    }
  }

  // DB 저장된 "본인 계약 수당 인정" / "산하 분리 보기" 설정 (월/라인 단위)
  const selfIncludedInitialByTopId: Record<string, boolean> = {};
  const splitOpenInitialByTopId: Record<string, boolean> = {};
  try {
    const [selfRes, splitRes] = await Promise.all([
      db
        .from('settlement_self_contract_preferences')
        .select('top_line_id, included')
        .eq('year_month', yearMonth),
      db
        .from('settlement_line_split_preferences')
        .select('top_line_id, is_split')
        .eq('year_month', yearMonth),
    ]);
    if (!selfRes.error) {
      for (const r of (selfRes.data ?? []) as Array<{ top_line_id: string; included: boolean }>) {
        if (!r?.top_line_id) continue;
        selfIncludedInitialByTopId[String(r.top_line_id)] = Boolean(r.included);
      }
    }
    if (!splitRes.error) {
      for (const r of (splitRes.data ?? []) as Array<{ top_line_id: string; is_split: boolean }>) {
        if (!r?.top_line_id) continue;
        splitOpenInitialByTopId[String(r.top_line_id)] = Boolean(r.is_split);
      }
    }
  } catch {
    // ignore
  }

  const kpiRow = ((kpiRes.data ?? [])[0] ?? null) as
    | { total_join_units: number; period_join_units: number }
    | null;
  const totalJoinUnits = kpiRow?.total_join_units ?? 0;
  const periodJoinUnits = kpiRow?.period_join_units ?? 0;
  const totalSales = totalJoinUnits * BASE_AMOUNT_PER_UNIT;
  const periodSales = periodJoinUnits * BASE_AMOUNT_PER_UNIT;
  const profit = periodSales - totalAmount;

  const yearsForPicker = (() => {
    const base = parseInt(todayYearMonth.slice(0, 4), 10);
    const out: number[] = [];
    for (let y = base; y >= base - 4; y--) out.push(y);
    return out;
  })();

  const [basisYear, basisMonth] = yearMonth.split('-');

  return (
    <div className="p-3 sm:p-6">
      {/* 상단: 제목 + 부가지표 + 재계산 */}
      <section className="mb-3 overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm ring-1 ring-slate-900/[0.035] sm:mb-4">
        <div className="flex flex-col gap-2 border-b border-orange-100/80 bg-gradient-to-r from-orange-50/90 via-white to-slate-50/90 px-3 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-3 sm:px-4 sm:py-3.5">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-orange-800/80">관리자</p>
            <h1 className="text-lg font-bold tracking-tight text-slate-900 sm:text-2xl">정산 현황</h1>
            {allContractsCount > 0 && (
              <p className="mt-1 text-[11px] leading-snug text-slate-600 sm:text-xs">
                <span className="tabular-nums text-slate-800">{yearMonth}</span> 계약{' '}
                <span className="font-medium tabular-nums text-slate-800">
                  {allContractsCount.toLocaleString('ko-KR')}
                </span>
                건 중{' '}
                <span
                  className={
                    eligibleContractsCount > 0 ? 'font-semibold text-emerald-700' : 'font-semibold text-amber-700'
                  }
                >
                  정산 대상 {eligibleContractsCount.toLocaleString('ko-KR')}건
                </span>
                {eligibleContractsCount === 0 && <span className="text-slate-500"> (가입 상태 기준)</span>}
              </p>
            )}
          </div>
          <RecalcButton yearMonth={yearMonth} />
        </div>
      </section>

      {/* 기준월 필터 카드 */}
      <section className="mb-3 overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-3 shadow-sm ring-1 ring-slate-900/[0.035] sm:mb-4 sm:p-4">
        <div className="mb-2 flex flex-col gap-0.5 border-b border-slate-100 pb-2 sm:flex-row sm:items-baseline sm:justify-between">
          <p className="text-[13px] font-semibold tabular-nums text-slate-800 sm:text-sm">
            <span className="text-orange-800">{basisYear}년</span>{' '}
            <span className="text-orange-800">{basisMonth}월</span> 기준
          </p>
          <p className="text-[10px] text-slate-500 sm:text-xs">정산 구간 {start_date} ~ {end_date}</p>
        </div>
        <YearMonthSelector
          layout="compact-toolbar"
          className="min-w-0"
          value={yearMonth}
          todayValue={todayYearMonth}
          years={yearsForPicker}
          keepQuery={rankFilter ? { rank: rankFilter } : { rank: null }}
          todayLabel="오늘 기준월"
        />
      </section>

      {/* 직급 pill 탭 */}
      <div className="mb-3 sm:mb-4">
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">직급 필터</p>
        <div className="-mx-1 overflow-x-auto overscroll-x-contain px-1 pb-1">
          <div className="flex w-max gap-1.5 sm:flex-wrap sm:gap-2">
            <Link
              href={`/admin/settlement?year_month=${yearMonth}`}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                !rankFilter
                  ? 'bg-orange-600 text-white shadow-sm ring-1 ring-orange-500/30'
                  : 'bg-slate-50 text-slate-600 ring-1 ring-slate-200/90 hover:bg-slate-100'
              }`}
            >
              전체
            </Link>
            {RANKS.map((r) => (
              <Link
                key={r}
                href={`/admin/settlement?year_month=${yearMonth}&rank=${r}`}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  rankFilter === r
                    ? 'bg-orange-600 text-white shadow-sm ring-1 ring-orange-500/30'
                    : 'bg-slate-50 text-slate-600 ring-1 ring-slate-200/90 hover:bg-slate-100'
                }`}
              >
                {r}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* KPI + 합계 + 테이블(클라이언트 조정 반영) */}
      <SettlementLineTableClient
        yearMonth={yearMonth}
        todayYearMonth={todayYearMonth}
        startDate={start_date}
        endDate={end_date}
        totalSales={totalSales}
        periodSales={periodSales}
        rankByMemberId={rankByMemberId}
        statementDirectUnitsByMemberId={statementDirectUnitsByMemberId}
        statementDownlineUnitsByMemberId={statementDownlineUnitsByMemberId}
        selfIncludedInitialByTopId={selfIncludedInitialByTopId}
        splitOpenInitialByTopId={splitOpenInitialByTopId}
        childrenByParent={childrenByParent}
        memberAggById={memberAggById}
        topLineIdByMemberId={topLineIdByMemberId}
        contractBaseItems={contractBaseItems}
        rows={displayLineRows.map<SettlementLineRow>((r) => ({
          topLineId: r.topLineId,
          topDisplayName: r.topDisplayName,
          topRank: String(r.topRank ?? ''),
          base: r.base,
          rollup: r.rollup,
          leaderMaint: r.leaderMaint,
          total: r.total,
          directContractCount: r.direct_contract_ids.size,
          directUnitSum: r.direct_unit_sum,
          ownDirectUnitSum: directByMember.get(r.topLineId)?.unitSum ?? 0,
        }))}
      />

      {/* 테이블은 클라이언트 컴포넌트에서 렌더(토글/합계 조정 포함) */}
    </div>
  );
}
