import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { buildOrgTree, formatKRW } from '@/lib/settlement/calculator';
import { getSettlementWindowForYearMonth } from '@/lib/settlement/settlement-window';
import { BASE_AMOUNT_PER_UNIT } from '@/lib/settlement/constants';
import type { RankType } from '@/lib/types';
import type { SettlementCalculationDetail } from '@/lib/types/settlement';
import RecalcButton from './RecalcButton';
import { isOrgDisplayHiddenMemberName } from '@/lib/organization/org-display-hidden';

export const metadata: Metadata = { title: '정산 현황' };
export const dynamic = 'force-dynamic';

const RANKS: RankType[] = ['영업사원', '리더', '센터장', '사업본부장'];

interface PageProps {
  searchParams: Promise<{
    year_month?: string;
    rank?: string;
    member_id?: string;
    debug?: string;
  }>;
}

function getCurrentYearMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function nextDay(dateYmd: string): string {
  const [y, m, d] = dateYmd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export default async function SettlementPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const yearMonth = params.year_month ?? getCurrentYearMonth();
  const rankFilter = params.rank as RankType | undefined;
  const debugEnabled = params.debug === '1';

  if (params.member_id) {
    const sp = new URLSearchParams();
    sp.set('year_month', yearMonth);
    sp.set('member_id', params.member_id);
    if (debugEnabled) sp.set('debug', '1');
    redirect(`/settlement/member?${sp.toString()}`);
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
      .select('id, name, rank, external_id, phone, source_customer_id')
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
    name: m.name as string,
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
    .select('id, customer_id, item_name')
    .in('id', contractIds);
  const customerIdByContractId = new Map<string, string>();
  const itemNameByContractId = new Map<string, string | null>();
  for (const r of (contractCustomerRows ?? []) as Array<{ id: string; customer_id: string; item_name?: string | null }>) {
    customerIdByContractId.set(r.id, r.customer_id);
    itemNameByContractId.set(r.id, (r as any).item_name ?? null);
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
    let sales_member_id = r.sales_member_id;
    if (customer_id) {
      const mapped = memberIdByCustomerId.get(customer_id);
      if (mapped) {
        sales_member_id = mapped;
      } else if (hqIdsRaw.has(r.sales_member_id)) {
        // fallback (HQ only): customer 매핑이 존재할 때만 치환 가능하므로 여기선 그대로 둔다
      }
    }
    return { ...r, id: r.contract_id, customer_id, sales_member_id, unit_count: r.unit_count ?? 0, item_name };
  });

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

  if (debugEnabled) {
    const sample = eligibleContracts
      .filter((c) => c.sales_member_id && (membersRaw.find((m: any) => m.id === c.sales_member_id)?.name ?? '').includes('김세영'))
      .slice(0, 3)
      .map((c) => ({ contract_code: c.contract_code, sales_member_id: c.sales_member_id, customer_id: c.customer_id }));
    // eslint-disable-next-line no-console
    console.log('[settlement-debug] eligibleContracts', { yearMonth, total: eligibleContracts.length, sample });
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
      const rawName = member?.name ?? '';
      const displayName = rawName.replace(/^\[고객\]\s*/, '');
      const zeroOut = rawName === ZERO_OUT_MEMBER_NAME;
      const direct = directByMember.get(s.member_id as string) ?? { contractIds: new Set<string>(), unitSum: 0 };
      const detail = s.calculation_detail as SettlementCalculationDetail | null;
      const lp = detail?.leader_promotion ?? null;
      const base = zeroOut ? 0 : (s.base_commission as number) ?? 0;
      const rollup = zeroOut ? 0 : (s.rollup_commission as number) ?? 0;
      const leaderMaint = zeroOut ? 0 : lp?.leader_maintenance_bonus_amount ?? 0;
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

  const kpiRow = ((kpiRes.data ?? [])[0] ?? null) as
    | { total_join_units: number; period_join_units: number }
    | null;
  const totalJoinUnits = kpiRow?.total_join_units ?? 0;
  const periodJoinUnits = kpiRow?.period_join_units ?? 0;
  const totalSales = totalJoinUnits * BASE_AMOUNT_PER_UNIT;
  const periodSales = periodJoinUnits * BASE_AMOUNT_PER_UNIT;
  const profit = periodSales - totalAmount;

  // 월 목록: 현재 선택된 기준월(yearMonth)을 맨 앞에 두고 -1개월씩 나열
  // (정산 기준이 26~25라 "오늘 달"과 기준월이 어긋날 수 있음)
  const months: string[] = [];
  {
    const [ys, ms] = yearMonth.split('-');
    const baseY = parseInt(ys, 10);
    const baseM = parseInt(ms, 10); // 1-12
    for (let i = 0; i < 12; i++) {
      const d = new Date(baseY, baseM - 1 - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">정산 현황</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {yearMonth} · 합계 {formatKRW(totalAmount)}
          </p>
          {allContractsCount > 0 && (
            <p className="text-xs text-gray-400 mt-0.5">
              {yearMonth} 계약 {allContractsCount}건 중{' '}
              <span
                className={
                  eligibleContractsCount > 0
                    ? 'text-green-600 font-medium'
                    : 'text-amber-600 font-medium'
                }
              >
                정산 대상 {eligibleContractsCount}건
              </span>
              {eligibleContractsCount === 0 && (
                <> (가입 상태 기준)</>
              )}
            </p>
          )}
        </div>

        <div className="flex items-start gap-3">
          {/* KPI (오른쪽) */}
          <div className="hidden md:grid grid-cols-3 gap-2">
            <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm shadow-sm">
              <div className="text-[11px] text-gray-500">총 매출</div>
              <div className="font-bold text-gray-800 tabular-nums">{formatKRW(totalSales)}</div>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm shadow-sm">
              <div className="text-[11px] text-gray-500">이번달 매출</div>
              <div className="font-bold text-gray-800 tabular-nums">{formatKRW(periodSales)}</div>
              <div className="text-[10px] text-gray-400 mt-0.5">
                기준 {start_date}~{end_date}
              </div>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm shadow-sm">
              <div className="text-[11px] text-gray-500">수익</div>
              <div className={`font-bold tabular-nums ${profit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                {formatKRW(profit)}
              </div>
              <div className="text-[10px] text-gray-400 mt-0.5">
                이번달 매출 - 정산금 합계
              </div>
            </div>
          </div>

          <RecalcButton yearMonth={yearMonth} />
        </div>
      </div>

      {/* 필터 */}
      <div className="flex gap-3 mb-5 flex-wrap items-center">
        {/* 월 선택 */}
        <div className="flex gap-1">
          {months.map((m) => (
            <Link
              key={m}
              href={`/settlement?year_month=${m}${rankFilter ? `&rank=${rankFilter}` : ''}`}
              className={`px-2.5 py-1 rounded text-xs border ${m === yearMonth ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'}`}
            >
              {m.slice(5)}월
            </Link>
          ))}
        </div>

        <span className="text-gray-300">|</span>

        {/* 직급 필터 */}
        <Link
          href={`/settlement?year_month=${yearMonth}`}
          className={`px-3 py-1 rounded text-xs border ${!rankFilter ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-gray-600 border-gray-300'}`}
        >
          전체
        </Link>
        {RANKS.map((r) => (
          <Link
            key={r}
            href={`/settlement?year_month=${yearMonth}&rank=${r}`}
            className={`px-3 py-1 rounded text-xs border ${rankFilter === r ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-gray-600 border-gray-300'}`}
          >
            {r}
          </Link>
        ))}
      </div>

      {/* 정산 테이블 */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {[
                  '담당자',
                  '직급',
                  '리더(정책)',
                  '적용 단가',
                  '직접계약',
                  '직접구좌',
                  '산하구좌',
                  '기본수당',
                  '롤업수당',
                  '유지장려(리더)',
                  '합계',
                  '확정',
                ].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-semibold text-gray-600 whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(settlements ?? []).length === 0 && (
                <tr>
                  <td colSpan={12} className="px-6 py-10 text-center">
                    <p className="text-gray-500 font-medium mb-2">{yearMonth} 정산 데이터가 없습니다.</p>
                    {allContractsCount === 0 ? (
                      <p className="text-xs text-gray-400">
                        이 달에 저장된 계약이 없습니다.{' '}
                        <span className="font-medium">조직도 페이지</span>에서 TY Life 동기화를 먼저 실행하세요.
                      </p>
                    ) : eligibleContractsCount === 0 ? (
                      <p className="text-xs text-amber-600">
                        {allContractsCount}건의 계약이 있지만 정산 대상(가입 인정 기준)이 0건입니다.
                        <br />
                        정산 계산은 <strong>가입 상태 기준</strong>으로 계약을 포함합니다.
                      </p>
                    ) : (
                      <p className="text-xs text-gray-400">
                        위 &apos;{yearMonth} 정산 재계산&apos; 버튼을 눌러 정산을 계산하세요.
                      </p>
                    )}
                  </td>
                </tr>
              )}
              {displayLineRows.map((r) => {
                return (
                  <tr key={r.topLineId} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">
                      <Link
                        href={`/settlement/member?year_month=${yearMonth}&member_id=${r.topLineId}`}
                        className="text-blue-600 hover:underline"
                      >
                        {r.topDisplayName || '-'}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{r.topRank as string}</td>
                    <td className="px-4 py-3 text-xs text-gray-700">
                      -
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600 max-w-[200px] whitespace-normal">
                      라인 합계
                    </td>
                    <td className="px-4 py-3 tabular-nums text-right">
                      {r.direct_contract_ids.size.toLocaleString()}건
                    </td>
                    <td className="px-4 py-3 tabular-nums text-right">
                      {r.direct_unit_sum.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-right">
                      -
                    </td>
                    <td className="px-4 py-3 tabular-nums text-right text-gray-700">
                      {formatKRW(r.base)}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-right text-gray-700">
                      {formatKRW(r.rollup)}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-right text-violet-700">
                      {formatKRW(r.leaderMaint)}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-right font-bold text-gray-900">
                      {formatKRW(r.total)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      -
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {(settlements ?? []).length > 0 && (
              <tfoot className="border-t-2 border-gray-200 bg-gray-50">
                <tr>
                  <td colSpan={7} className="px-4 py-3 font-semibold text-gray-700">
                    합계
                  </td>
                  <td className="px-4 py-3 tabular-nums text-right font-semibold">
                    {formatKRW(
                      (settlements ?? []).reduce((sum, r) => {
                        if (isHiddenMember(r)) return sum;
                        if (isZeroOutMember(r)) return sum;
                        return sum + ((r.base_commission as number) ?? 0);
                      }, 0),
                    )}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-right font-semibold">
                    {formatKRW(
                      (settlements ?? []).reduce((sum, r) => {
                        if (isHiddenMember(r)) return sum;
                        if (isZeroOutMember(r)) return sum;
                        return sum + ((r.rollup_commission as number) ?? 0);
                      }, 0),
                    )}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-right font-semibold text-violet-700">
                    {formatKRW(
                      (settlements ?? []).reduce((sum, r) => {
                        if (isHiddenMember(r)) return sum;
                        if (isZeroOutMember(r)) return sum;
                        const d = r.calculation_detail as SettlementCalculationDetail | null;
                        return sum + (d?.leader_promotion?.leader_maintenance_bonus_amount ?? 0);
                      }, 0),
                    )}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-right font-bold text-gray-900">
                    {formatKRW(totalAmount)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
