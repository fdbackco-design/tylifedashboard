import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import TyLifePartnersLogo from '@/components/TyLifePartnersLogo';
import YearMonthSelector from '@/components/YearMonthSelector';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';
import { sumDownlineAttributedUnitsInSettlementWindow } from '@/lib/organization/statement-downline-units';
import {
  coalesceYearMonthSearchParam,
  getSettlementWindowForYearMonth,
  getSettlementWindowSeoul,
  normalizeYearMonthLabel,
} from '@/lib/settlement/settlement-window';
import { getContractDisplayStatus } from '@/lib/utils/contract-display-status';
import { isV2EligibleStatic } from '@/lib/settlement/settlement-eligibility-v2';
import type {
  SettlementCalculationDetail,
  RollupContractItem,
  RollupItem,
  RankType,
} from '@/lib/types';

export const metadata: Metadata = { title: '지급 명세서' };
export const dynamic = 'force-dynamic';

function formatWon(value: number): string {
  return `${Math.round(value).toLocaleString('ko-KR')} 원`;
}

export default async function OrganizationStatementPage({
  searchParams,
}: {
  searchParams?: Promise<{ year_month?: string; debug?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const debug = String(sp.debug ?? '').trim() === '1';
  const defaultYearMonth = getSettlementWindowSeoul().label_year_month;
  const requestedYearMonthRaw =
    coalesceYearMonthSearchParam(sp.year_month as string | string[] | undefined) ?? defaultYearMonth;
  const yearMonth = normalizeYearMonthLabel(requestedYearMonthRaw) ?? defaultYearMonth;
  const { start_date, end_date, label_year_month } = getSettlementWindowForYearMonth(yearMonth);

  // 기준월 선택 UI에 표시할 연도 목록 (현재 기준월 연도부터 4년 전까지, /organization 등과 동일)
  const yearsForPicker = (() => {
    const base = parseInt(label_year_month.slice(0, 4), 10);
    const out: number[] = [];
    for (let y = base; y >= base - 4; y--) out.push(y);
    return out;
  })();

  const userDb = await createServerSupabaseClient();
  const {
    data: { user },
  } = await userDb.auth.getUser();

  if (!user) {
    redirect(`/login?redirect=${encodeURIComponent(`/organization/statement?year_month=${yearMonth}`)}`);
  }

  const { data: profile } = await userDb
    .from('user_profiles')
    .select('member_id,is_active,display_name,mapping_status')
    .eq('id', user.id)
    .maybeSingle();

  const memberId = (profile?.member_id as string | null) ?? null;
  const profileDisplayName = (profile?.display_name as string | null) ?? null;
  const mappingStatus = (profile?.mapping_status as string | null) ?? null;
  // 사전 발급(PENDING) 계정도 로그인 상태에서 빈 명세서를 볼 수 있게 한다.
  const isUnmapped = !memberId;

  const db = createAdminSupabaseClient();

  const [memberRes, settlementRes] = isUnmapped
    ? [
        { data: null as { id: string; name: string; rank: string; leader_rank_effective_at?: string | null } | null },
        { data: null as any },
      ]
    : await Promise.all([
        db
          .from('organization_members')
          .select('id,name,rank,leader_rank_effective_at')
          .eq('id', memberId as string)
          .maybeSingle(),
        db
          .from('monthly_settlements')
          .select(
            'year_month, member_id, rank, direct_unit_count, base_commission, rollup_commission, incentive_amount, total_amount, calculation_detail',
          )
          .eq('year_month', label_year_month)
          .eq('member_id', memberId as string)
          .maybeSingle(),
      ]);

  const member = (memberRes.data ?? null) as {
    id: string;
    name: string;
    rank: string;
    leader_rank_effective_at?: string | null;
  } | null;
  const s = (settlementRes.data ?? null) as
    | {
        year_month: string;
        member_id: string;
        rank: string;
        direct_unit_count: number;
        base_commission: number;
        rollup_commission: number;
        incentive_amount: number;
        total_amount: number;
      }
    | null;

  const displayName = isUnmapped
    ? ((profileDisplayName ?? '').replace(/^\[고객\]\s*/, '').trim() || '사용자')
    : ((member?.name ?? '').replace(/^\[고객\]\s*/, '') || '—');
  const rank = isUnmapped ? '—' : (s?.rank ?? member?.rank ?? '—');

  // 사전 발급(미매핑) 계정은 0 채움 명세서를 보여준다.
  const emptySettlement = {
    year_month: label_year_month,
    member_id: '',
    rank: '—',
    direct_unit_count: 0,
    base_commission: 0,
    rollup_commission: 0,
    incentive_amount: 0,
    total_amount: 0,
  };
  const ss = isUnmapped ? emptySettlement : s;

  if (!ss) {
    return (
      <div className="p-6">
        <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <TyLifePartnersLogo className="sm:pt-0.5 shrink-0" mobileSrc="/logo.png" />
          <div className="min-w-0 flex-1">
            <div className="text-xs text-gray-500">
              <Link className="text-blue-600 hover:underline" href={`/organization?year_month=${yearMonth}`}>
                내 조직도
              </Link>
              <span className="mx-1">/</span>
              <span>지급 명세서</span>
            </div>
            <h2 className="text-2xl font-bold text-gray-800 mt-2">지급 명세서</h2>
            <p className="text-sm text-gray-500 mt-1">
              기준 {label_year_month} · {start_date}~{end_date}
            </p>
          </div>
        </div>

        <div className="mb-4">
          <YearMonthSelector
            layout="compact-toolbar"
            value={label_year_month}
            todayValue={defaultYearMonth}
            years={yearsForPicker}
            todayLabel="오늘 기준월"
          />
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <p className="text-sm text-gray-700">
            이 달의 정산 데이터가 아직 계산/저장되지 않았습니다. 관리자 화면(`/admin/settlement`)에서 해당 월 정산 재계산을 실행한 뒤 다시 확인해 주세요.
          </p>
          <div className="mt-4">
            <Link
              className="inline-flex items-center px-3 py-2 text-sm rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              href={`/organization?year_month=${yearMonth}`}
            >
              돌아가기
            </Link>
          </div>
        </div>
      </div>
    );
  }

  let downlineRes: Awaited<ReturnType<typeof sumDownlineAttributedUnitsInSettlementWindow>> | number = 0;
  let downlineAttributedUnits = 0;
  if (!isUnmapped) {
    downlineRes = await sumDownlineAttributedUnitsInSettlementWindow(
      db,
      memberId as string,
      { start_date, end_date },
      ss.direct_unit_count ?? 0,
      member?.leader_rank_effective_at ?? null,
      { debug },
    );
    downlineAttributedUnits =
      typeof downlineRes === 'number' ? downlineRes : downlineRes.downline_units;
  }

  const no = `${label_year_month}-${isUnmapped ? 'GUEST' : String(memberId).slice(0, 4)}`;
  const statementTotalUnits = (ss.direct_unit_count ?? 0) + downlineAttributedUnits;
  const [basisYear, basisMonth] = label_year_month.split('-');

  // ── 본인 정산 상세 (직접 정산 계약 목록 + 롤업수당 상세) ──────────────────────
  // 관리자 페이지 `/admin/settlement/member` 와 동일한 기준으로 본인 데이터만 조회한다.
  const calcDetail = ((settlementRes as { data?: { calculation_detail?: SettlementCalculationDetail | null } | null })
    ?.data?.calculation_detail ?? null) as SettlementCalculationDetail | null;

  type DirectRow = {
    contract_id: string;
    customer_name: string;
    join_ymd: string;
    item_name: string | null;
    display_status: string;
    unit_count: number;
    origin_member_id: string;
    raw_sales_member_id: string;
    settlement_override_id: string | null;
    join_date: string | null;
  };
  let directRowsGrouped: Array<{
    key: string;
    contract_ids: string[];
    customer_name: string;
    join_ymd: string;
    item_name: string | null;
    display_status: string;
    unit_count: number;
    origin_member_id: string;
    raw_sales_member_id: string;
    sort_join_date: string;
    amount: number;
  }> = [];

  type RollupGroupedRow = {
    key: string;
    customer_name: string;
    join_ymd: string;
    item_name: string | null;
    display_status: string;
    from_member_id: string;
    from_member_name: string;
    from_rank: RankType;
    effective_sales_member_id: string;
    effective_sales_member_name: string;
    unit_count: number;
    subtotal: number;
  }[];
  let rollupGroupedRows: RollupGroupedRow = [];
  const rollupItemsForFallback: RollupItem[] = Array.isArray(calcDetail?.rollup_items)
    ? (calcDetail!.rollup_items as RollupItem[])
    : [];
  let rollupContractItemsTotal = 0;
  let directRowsTotalUnits = 0;
  let directRowsTotalAmount = 0;
  let memberNameByIdForRollup = new Map<string, string>();
  const rollupCommissionVal = Number(ss.rollup_commission ?? 0);

  if (!isUnmapped) {
    const endExclusive = (() => {
      const [y, m, d] = end_date.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      dt.setUTCDate(dt.getUTCDate() + 1);
      return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
    })();

    // 1) 직접 정산 계약: (settlement_sales_member_id ?? sales_member_id) === currentMemberId
    //    두 조건을 별도 쿼리로 받아 union (Supabase or 문법 복잡성 회피)
    const baseSelect =
      'id, contract_code, join_date, status, unit_count, item_name, sales_member_id, settlement_sales_member_id, customer_id, sales_link_status, is_cancelled, rental_request_no, invoice_no, memo, happycall_result, customers(name)';
    const [byOverrideRes, byRawRes] = await Promise.all([
      db
        .from('contracts')
        .select(baseSelect)
        .gte('join_date', start_date)
        .lt('join_date', endExclusive)
        .eq('settlement_sales_member_id', memberId as string),
      db
        .from('contracts')
        .select(baseSelect)
        .gte('join_date', start_date)
        .lt('join_date', endExclusive)
        .is('settlement_sales_member_id', null)
        .eq('sales_member_id', memberId as string),
    ]);

    const seenContractIds = new Set<string>();
    const directRowsRaw: DirectRow[] = [];
    for (const list of [byOverrideRes.data ?? [], byRawRes.data ?? []]) {
      for (const c of list as any[]) {
        if (seenContractIds.has(c.id)) continue;
        seenContractIds.add(c.id);
        // 관리자 페이지와 동일한 v2 정적 가입 인정 기준 적용
        if (
          !isV2EligibleStatic({
            status: String(c.status ?? ''),
            is_cancelled: Boolean(c.is_cancelled ?? false),
            sales_member_id: (c.sales_member_id ?? null) as string | null,
            sales_link_status: (c.sales_link_status ?? null) as string | null,
            happycall_result: (c.happycall_result ?? null) as string | null,
            invoice_no: (c.invoice_no ?? null) as string | null,
          })
        ) {
          continue;
        }
        directRowsRaw.push({
          contract_id: c.id as string,
          customer_name: ((c.customers as any)?.name as string | undefined)?.replace(/^\[고객\]\s*/, '') ?? '-',
          join_ymd: String(c.join_date ?? '').slice(0, 10),
          item_name: (c.item_name as string | null | undefined) ?? null,
          display_status: getContractDisplayStatus({
            status: String(c.status ?? ''),
            rental_request_no: (c.rental_request_no ?? null) as string | null,
            invoice_no: (c.invoice_no ?? null) as string | null,
            memo: (c.memo ?? null) as string | null,
          }),
          unit_count: Number(c.unit_count ?? 0),
          origin_member_id: (c.settlement_sales_member_id ?? c.sales_member_id) as string,
          raw_sales_member_id: c.sales_member_id as string,
          settlement_override_id: (c.settlement_sales_member_id ?? null) as string | null,
          join_date: c.join_date as string | null,
        });
      }
    }

    // 계약별 (직접 + 롤업) 수당 합 — 본인 정산의 calculation_detail 기준
    const directContractItems = Array.isArray(calcDetail?.direct_contracts)
      ? (calcDetail!.direct_contracts as Array<{ contract_id: string; subtotal: number }>)
      : [];
    const rollupContractItems: RollupContractItem[] = Array.isArray(calcDetail?.rollup_contract_items)
      ? (calcDetail!.rollup_contract_items as RollupContractItem[])
      : [];
    rollupContractItemsTotal = rollupContractItems.reduce((s, x) => s + Number(x.subtotal ?? 0), 0);
    const amountByContractId = new Map<string, number>();
    for (const it of directContractItems) {
      const prev = amountByContractId.get(it.contract_id) ?? 0;
      amountByContractId.set(it.contract_id, prev + Number(it.subtotal ?? 0));
    }
    for (const it of rollupContractItems) {
      const prev = amountByContractId.get(it.contract_id) ?? 0;
      amountByContractId.set(it.contract_id, prev + Number(it.subtotal ?? 0));
    }

    // 그룹화: (고객명, 가입일, 상품명, 표시상태) 가 동일하면 한 줄로 묶어 구좌·수당 합산
    const directGroupMap = new Map<
      string,
      {
        key: string;
        contract_ids: string[];
        customer_name: string;
        join_ymd: string;
        item_name: string | null;
        display_status: string;
        unit_count: number;
        origin_member_id: string;
        raw_sales_member_id: string;
        sort_join_date: string;
        amount: number;
      }
    >();
    for (const r of directRowsRaw) {
      const key = [r.customer_name, r.join_ymd, r.item_name ?? '', r.display_status].join('||');
      const amount = amountByContractId.get(r.contract_id) ?? 0;
      const existing = directGroupMap.get(key);
      if (!existing) {
        directGroupMap.set(key, {
          key,
          contract_ids: [r.contract_id],
          customer_name: r.customer_name,
          join_ymd: r.join_ymd,
          item_name: r.item_name,
          display_status: r.display_status,
          unit_count: r.unit_count,
          origin_member_id: r.origin_member_id,
          raw_sales_member_id: r.raw_sales_member_id,
          sort_join_date: String(r.join_date ?? ''),
          amount,
        });
        continue;
      }
      existing.contract_ids.push(r.contract_id);
      existing.unit_count += r.unit_count;
      existing.amount += amount;
      if (!existing.item_name && r.item_name) existing.item_name = r.item_name;
    }
    directRowsGrouped = [...directGroupMap.values()].sort((a, b) =>
      (b.sort_join_date ?? '').localeCompare(a.sort_join_date ?? ''),
    );
    directRowsTotalUnits = directRowsGrouped.reduce((s, x) => s + x.unit_count, 0);
    directRowsTotalAmount = directRowsGrouped.reduce((s, x) => s + x.amount, 0);

    // 2) 롤업수당 상세 — rollup_contract_items 기준 메타 fetch
    const rollupContractIds = Array.from(
      new Set(rollupContractItems.map((r) => r.contract_id).filter(Boolean)),
    );
    const rollupContractMetaById = new Map<
      string,
      { customer_name: string; join_ymd: string; item_name: string | null; display_status: string }
    >();
    if (rollupContractIds.length > 0) {
      const { data: metaRows } = await db
        .from('contracts')
        .select(
          'id, status, join_date, item_name, rental_request_no, invoice_no, memo, customers(name)',
        )
        .in('id', rollupContractIds);
      for (const c of (metaRows ?? []) as any[]) {
        rollupContractMetaById.set(c.id as string, {
          customer_name: ((c.customers as any)?.name as string | undefined)?.replace(/^\[고객\]\s*/, '') ?? '-',
          join_ymd: String(c.join_date ?? '').slice(0, 10),
          item_name: (c.item_name as string | null | undefined) ?? null,
          display_status: getContractDisplayStatus({
            status: String(c.status ?? ''),
            rental_request_no: (c.rental_request_no ?? null) as string | null,
            invoice_no: (c.invoice_no ?? null) as string | null,
            memo: (c.memo ?? null) as string | null,
          }),
        });
      }
    }

    // 멤버 이름 매핑 (rollup 의 from_member_id / effective_sales_member_id)
    const memberIdsForRollup = Array.from(
      new Set(
        rollupContractItems.flatMap((r) => [r.from_member_id, r.effective_sales_member_id]).filter(Boolean) as string[],
      ),
    );
    if (memberIdsForRollup.length > 0) {
      const { data: nameRows } = await db
        .from('organization_members')
        .select('id, name')
        .in('id', memberIdsForRollup);
      for (const m of (nameRows ?? []) as any[]) {
        memberNameByIdForRollup.set(
          m.id as string,
          String(m.name ?? '').replace(/^\[고객\]\s*/, ''),
        );
      }
    }

    // 그룹화: (고객명, 가입일, 상품명, 표시상태, 산하멤버)
    const rollupGroupMap = new Map<
      string,
      {
        key: string;
        customer_name: string;
        join_ymd: string;
        item_name: string | null;
        display_status: string;
        from_member_id: string;
        from_member_name: string;
        from_rank: RankType;
        effective_sales_member_id: string;
        effective_sales_member_name: string;
        unit_count: number;
        subtotal: number;
      }
    >();
    for (const r of rollupContractItems) {
      const meta = rollupContractMetaById.get(r.contract_id);
      const customer_name = meta?.customer_name ?? '-';
      const join_ymd = meta?.join_ymd ?? '';
      const item_name = meta?.item_name ?? null;
      const display_status = meta?.display_status ?? '-';
      const key = [
        customer_name,
        join_ymd,
        item_name ?? '',
        display_status,
        r.from_member_id,
      ].join('||');
      const fromName =
        memberNameByIdForRollup.get(r.from_member_id) ?? r.from_member_name ?? r.from_member_id;
      const effName =
        memberNameByIdForRollup.get(r.effective_sales_member_id) ??
        r.effective_sales_member_name ??
        r.effective_sales_member_id;
      const units = Number(r.unit_count ?? 0);
      const sub = Number(r.subtotal ?? 0);
      const existing = rollupGroupMap.get(key);
      if (!existing) {
        rollupGroupMap.set(key, {
          key,
          customer_name,
          join_ymd,
          item_name,
          display_status,
          from_member_id: r.from_member_id,
          from_member_name: fromName,
          from_rank: r.from_rank,
          effective_sales_member_id: r.effective_sales_member_id,
          effective_sales_member_name: effName,
          unit_count: units,
          subtotal: sub,
        });
        continue;
      }
      existing.unit_count += units;
      existing.subtotal += sub;
      if (!existing.item_name && item_name) existing.item_name = item_name;
    }
    rollupGroupedRows = [...rollupGroupMap.values()].sort((a, b) => {
      if (a.join_ymd !== b.join_ymd) return b.join_ymd.localeCompare(a.join_ymd);
      return a.from_member_name.localeCompare(b.from_member_name);
    });
  }

  // 이름 보강용 (직접 정산 계약 목록의 원 담당자 표시)
  const directMemberIdsToResolve = Array.from(
    new Set(
      directRowsGrouped
        .flatMap((r) => [r.origin_member_id, r.raw_sales_member_id])
        .filter(Boolean) as string[],
    ),
  );
  const memberNameByIdForDirect = new Map<string, string>();
  if (!isUnmapped && directMemberIdsToResolve.length > 0) {
    const { data: nameRows } = await db
      .from('organization_members')
      .select('id, name')
      .in('id', directMemberIdsToResolve);
    for (const m of (nameRows ?? []) as any[]) {
      memberNameByIdForDirect.set(
        m.id as string,
        String(m.name ?? '').replace(/^\[고객\]\s*/, ''),
      );
    }
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <TyLifePartnersLogo mobileSrc="/logo.png" />
        <div className="text-xs text-gray-500 sm:text-right">
          <Link className="text-blue-600 hover:underline" href={`/organization?year_month=${yearMonth}`}>
            내 조직도
          </Link>
          <span className="mx-1">/</span>
          <span>지급 명세서</span>
        </div>
      </div>

      <div className="mb-4">
        <YearMonthSelector
          layout="compact-toolbar"
          value={label_year_month}
          todayValue={defaultYearMonth}
          years={yearsForPicker}
          todayLabel="오늘 기준월"
        />
      </div>

      {isUnmapped ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold text-amber-900">계약이 완료되지 않은 계정입니다</p>
          <p className="mt-1 text-xs leading-relaxed text-amber-800">
            본인 명의의 계약/정산 데이터가 아직 연결되지 않아 모든 값은 0 으로 표시됩니다.
            {mappingStatus === 'MANUAL_REVIEW' ? ' (현재 상태: 관리자 검토 대기)' : ' (현재 상태: 대기)'}
          </p>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm ring-1 ring-slate-900/[0.035]">
        <div className="border-t-4 border-orange-400 p-4 sm:p-6">
          <div className="flex items-baseline justify-between gap-3 pb-3 border-b border-gray-200 mb-5">
            <h3 className="m-0 text-base font-semibold text-orange-950">지급 명세서</h3>
            <span className="text-xs text-gray-400">No. {no}</span>
          </div>

          <div className="mb-4 rounded-2xl border border-slate-200/90 bg-gradient-to-b from-white to-slate-50/70 p-3 shadow-[0_1px_2px_rgba(15,23,42,0.06)] ring-1 ring-slate-900/[0.035] sm:mb-5 sm:p-3.5">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-lg font-bold tracking-tight text-slate-900 sm:text-xl">{displayName}</span>
              <span className="inline-flex max-w-full items-center rounded-full border border-orange-200/90 bg-orange-50 px-2.5 py-0.5 text-[11px] font-semibold leading-tight text-orange-900 sm:text-xs">
                {rank}
              </span>
            </div>
            <p className="mt-2 text-xs font-medium tabular-nums tracking-tight text-slate-500 sm:text-[13px]">
              {basisYear}년 {basisMonth}월
            </p>
            <p className="mt-0.5 text-[11px] tabular-nums text-slate-400 sm:text-xs">
              {start_date} ~ {end_date}
            </p>
          </div>

          <div className="text-sm font-semibold text-orange-800 mb-2">기간 내 실적</div>
          <div className="rounded-lg border border-gray-200 overflow-hidden mb-5">
            <div className="grid grid-cols-2 px-4 py-3 border-b border-gray-100">
              <div className="text-sm text-gray-600">개인 실적 구좌</div>
              <div className="text-sm text-right font-semibold tabular-nums">{ss.direct_unit_count.toLocaleString('ko-KR')} 구좌</div>
            </div>
            <div className="grid grid-cols-2 px-4 py-3 border-b border-gray-100">
              <div className="text-sm text-gray-600">산하 실적 구좌</div>
              <div className="text-sm text-right font-semibold tabular-nums">
                {downlineAttributedUnits.toLocaleString('ko-KR')} 구좌
              </div>
            </div>
          </div>

          {debug && typeof downlineRes !== 'number' ? (
            <div className="rounded-lg border border-gray-200 overflow-hidden mb-5">
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                <div className="text-sm font-semibold text-gray-800">산하 실적 집계 디버그</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  포함된 계약(및 제외된 계약 일부)을 확인합니다.
                </div>
                <div className="text-xs text-gray-600 mt-2">
                  포함 합계(개인 차감 전){' '}
                  <span className="font-semibold tabular-nums">
                    {downlineRes.included_units_before_personal.toLocaleString('ko-KR')}
                  </span>
                  구좌 · 개인(정산){' '}
                  <span className="font-semibold tabular-nums">
                    {downlineRes.personal_units_from_settlement.toLocaleString('ko-KR')}
                  </span>
                  구좌 · 최종 산하{' '}
                  <span className="font-semibold tabular-nums">
                    {downlineRes.downline_units.toLocaleString('ko-KR')}
                  </span>
                  구좌
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr className="text-left text-xs text-gray-600">
                      {['가입일', '계약', '구좌', '원본 담당자', '귀속 담당자', '가까운 하위 리더', '비고'].map((h) => (
                        <th key={h} className="px-3 py-2 font-semibold whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {downlineRes.debug_rows.slice(0, 300).map((r) => (
                      <tr key={r.contract_id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-700">
                          {r.join_date}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className="font-mono text-xs text-gray-800">
                            {r.contract_code ?? r.contract_id}
                          </span>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap tabular-nums text-right">
                          {Number(r.unit_count ?? 0).toLocaleString('ko-KR')}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-700">
                          {(r.raw_sales_member_name ?? r.raw_sales_member_id).replace(/^\[고객\]\s*/, '')}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-700">
                          {(r.origin_member_name ?? r.origin_member_id).replace(/^\[고객\]\s*/, '')}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-700">
                          {r.nearest_leader_id
                            ? (r.nearest_leader_name ?? r.nearest_leader_id).replace(/^\[고객\]\s*/, '')
                            : '-'}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-xs">
                          {r.excluded_by_root_leader_effective_at ? (
                            <span className="text-amber-700">리더 전 계약 제외</span>
                          ) : r.excluded_by_leader_after_promotion ? (
                            <span className="text-amber-700">하위 리더 승격 이후 제외</span>
                          ) : (
                            <span className="text-emerald-700">포함</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {downlineRes.debug_rows.length > 300 ? (
                <div className="px-4 py-2 text-xs text-gray-500">
                  {downlineRes.debug_rows.length.toLocaleString('ko-KR')}건 중 300건만 표시했습니다.
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="text-sm font-semibold text-orange-800 mb-2">지급 내역</div>
          <div className="rounded-lg border border-gray-200 overflow-hidden mb-5">
            <div className="grid grid-cols-2 px-4 py-3 border-b border-gray-100">
              <div className="text-sm text-gray-600">개인 수당</div>
              <div className="text-sm text-right tabular-nums">{formatWon(ss.base_commission ?? 0)}</div>
            </div>
            <div className="grid grid-cols-2 px-4 py-3 border-b border-gray-100">
              <div className="text-sm text-gray-600">오버라이드</div>
              <div className="text-sm text-right tabular-nums">{formatWon(ss.rollup_commission ?? 0)}</div>
            </div>
            <div className="grid grid-cols-2 px-4 py-3">
              <div className="text-sm text-gray-600">보너스</div>
              <div className="text-sm text-right tabular-nums">{formatWon(ss.incentive_amount ?? 0)}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
              <div className="text-xs text-orange-800 mb-1">총 지급액</div>
              <div className="text-xl font-semibold text-orange-950 tabular-nums">
                {formatWon(ss.total_amount ?? 0)}
              </div>
            </div>
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
              <div className="text-xs text-orange-800 mb-1">총 합계 구좌</div>
              <div className="text-xl font-semibold text-orange-950 tabular-nums">
                {statementTotalUnits.toLocaleString('ko-KR')} 구좌
              </div>
            </div>
          </div>

          {(() => {
            // 화면 표시용 계산만 (정산 계산 로직/금액에 영향 없음).
            // 원 단위 절사 기준: Math.floor.
            const totalAmount = Number(ss.total_amount ?? 0);
            const deductionAmount = Math.floor(totalAmount * 0.033);
            const netPaymentAmount = totalAmount - deductionAmount;
            return (
              <div className="mt-3 space-y-2">
                <div className="rounded-lg border border-gray-200 overflow-hidden">
                  <div className="grid grid-cols-2 px-4 py-3">
                    <div className="text-sm text-gray-600">공제액 (3.3%)</div>
                    <div className="text-sm text-right tabular-nums text-gray-800">
                      −{formatWon(deductionAmount)}
                    </div>
                  </div>
                </div>
                <div className="bg-orange-500 rounded-xl p-5 shadow-sm ring-1 ring-orange-600/10">
                  <div className="text-xs font-semibold text-orange-50/90 mb-1">실지급액</div>
                  <div className="text-3xl font-extrabold tracking-tight text-white tabular-nums">
                    {formatWon(netPaymentAmount)}
                  </div>
                  <div className="mt-1 text-[11px] text-orange-50/80">
                    총 지급액 {formatWon(totalAmount)} − 공제액 {formatWon(deductionAmount)}
                  </div>
                </div>
              </div>
            );
          })()}

          <div className="mt-6">
            <Link
              className="inline-flex items-center px-3 py-2 text-sm rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              href={`/organization?year_month=${yearMonth}`}
            >
              내 조직도로 돌아가기
            </Link>
          </div>
        </div>
      </div>

      {!isUnmapped && (
        <>
          {/* ── 직접 정산 계약 목록 ──────────────────────────────────────────── */}
          <section className="mt-6">
            <h3 className="text-base font-semibold text-gray-800 mb-2">직접 정산 계약 목록</h3>
            <p className="text-xs text-gray-500 mb-2">
          
            </p>
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      {['고객명', '가입일', '물품명', '표시상태', '구좌', '원 담당자', '수당'].map((h) => (
                        <th
                          key={h}
                          className="px-3 py-2 text-left text-xs font-semibold text-gray-600 whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {directRowsGrouped.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-6 py-8 text-center text-sm text-gray-500">
                          표시할 계약이 없습니다.
                        </td>
                      </tr>
                    )}
                    {directRowsGrouped.map((r) => {
                      const rawName =
                        memberNameByIdForDirect.get(r.raw_sales_member_id) ?? r.raw_sales_member_id;
                      return (
                        <tr key={r.key} className="hover:bg-gray-50">
                          <td className="px-3 py-2 whitespace-nowrap">{r.customer_name}</td>
                          <td className="px-3 py-2 tabular-nums text-gray-600 whitespace-nowrap">
                            {r.join_ymd || '-'}
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-700 whitespace-nowrap">
                            {r.item_name ?? '-'}
                          </td>
                          <td className="px-3 py-2">{r.display_status}</td>
                          <td className="px-3 py-2 tabular-nums text-right">
                            {r.unit_count.toLocaleString('ko-KR')}
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
                            {rawName}
                          </td>
                          <td className="px-3 py-2 tabular-nums text-right font-semibold">
                            ₩{r.amount.toLocaleString('ko-KR')}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {directRowsGrouped.length > 0 && (
                    <tfoot className="bg-gray-50 border-t border-gray-200">
                      <tr>
                        <td colSpan={4} className="px-3 py-2 text-right text-xs text-gray-500">
                          합계
                        </td>
                        <td className="px-3 py-2 tabular-nums text-right">
                          {directRowsTotalUnits.toLocaleString('ko-KR')}
                        </td>
                        <td className="px-3 py-2" />
                        <td className="px-3 py-2 tabular-nums text-right font-semibold">
                          ₩{directRowsTotalAmount.toLocaleString('ko-KR')}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </section>

          {/* ── 롤업수당 상세 ───────────────────────────────────────────────── */}
          <section className="mt-6 mb-6">
            <div className="mb-2 flex items-end justify-between gap-3">
              <h3 className="text-base font-semibold text-gray-800">롤업수당 상세</h3>
              <div className="text-xs text-gray-500">
                롤업수당 합계{' '}
                <span className="font-semibold text-gray-700">
                  ₩{rollupCommissionVal.toLocaleString('ko-KR')}
                </span>
              </div>
            </div>

            {rollupGroupedRows.length > 0 ? (
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        {[
                          '고객명',
                          '가입일',
                          '상품명',
                          '계약 상태',
                          '산하 멤버',
                          '실제 계약 담당자',
                          '구좌',
                          '구좌당 롤업',
                          '롤업 소계',
                        ].map((h) => (
                          <th
                            key={h}
                            className="px-3 py-2 text-left text-xs font-semibold text-gray-600 whitespace-nowrap"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {rollupGroupedRows.map((r) => {
                        const perUnitAvg = r.unit_count > 0 ? r.subtotal / r.unit_count : 0;
                        return (
                          <tr key={r.key} className="hover:bg-gray-50">
                            <td className="px-3 py-2 whitespace-nowrap">{r.customer_name}</td>
                            <td className="px-3 py-2 tabular-nums text-gray-600 whitespace-nowrap">
                              {r.join_ymd || '-'}
                            </td>
                            <td className="px-3 py-2 text-xs text-gray-700 whitespace-nowrap">
                              {r.item_name ?? '-'}
                            </td>
                            <td className="px-3 py-2 text-xs whitespace-nowrap">
                              {r.display_status}
                            </td>
                            <td className="px-3 py-2 text-xs text-gray-700 whitespace-nowrap">
                              {r.from_member_name}
                              <span className="ml-1 text-[11px] text-gray-400">
                                ({r.from_rank ?? '-'})
                              </span>
                            </td>
                            <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">
                              {r.effective_sales_member_name}
                            </td>
                            <td className="px-3 py-2 tabular-nums text-right">
                              {r.unit_count.toLocaleString('ko-KR')}
                            </td>
                            <td className="px-3 py-2 tabular-nums text-right text-gray-700">
                              ₩{Math.round(perUnitAvg).toLocaleString('ko-KR')}
                            </td>
                            <td className="px-3 py-2 tabular-nums text-right font-semibold">
                              ₩{r.subtotal.toLocaleString('ko-KR')}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-gray-50 border-t border-gray-200">
                      <tr>
                        <td colSpan={6} className="px-3 py-2 text-right text-xs text-gray-500">
                          합계
                        </td>
                        <td className="px-3 py-2 tabular-nums text-right">
                          {rollupGroupedRows
                            .reduce((s, x) => s + x.unit_count, 0)
                            .toLocaleString('ko-KR')}
                        </td>
                        <td className="px-3 py-2" />
                        <td className="px-3 py-2 tabular-nums text-right font-semibold">
                          ₩{rollupContractItemsTotal.toLocaleString('ko-KR')}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            ) : rollupItemsForFallback.length > 0 ? (
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-4 py-3 text-xs text-amber-700 bg-amber-50 border-b border-amber-100">
                  이 월의 정산은 계약 단위 근거가 저장되기 전 데이터입니다. 멤버 단위 요약만 표시합니다.
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        {['산하 멤버', '직급', '구좌', '구좌당 롤업(평균)', '롤업 소계'].map((h) => (
                          <th
                            key={h}
                            className="px-3 py-2 text-left text-xs font-semibold text-gray-600 whitespace-nowrap"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {rollupItemsForFallback.map((r, idx) => {
                        const nm =
                          memberNameByIdForRollup.get(r.from_member_id) ??
                          r.from_member_name ??
                          r.from_member_id;
                        return (
                          <tr key={`${r.from_member_id}__${idx}`} className="hover:bg-gray-50">
                            <td className="px-3 py-2 text-xs text-gray-700">{nm}</td>
                            <td className="px-3 py-2 text-xs text-gray-500">{r.from_rank}</td>
                            <td className="px-3 py-2 tabular-nums text-right">
                              {Number(r.unit_count ?? 0).toLocaleString('ko-KR')}
                            </td>
                            <td className="px-3 py-2 tabular-nums text-right text-gray-700">
                              ₩{Math.round(Number(r.rollup_amount_per_unit ?? 0)).toLocaleString('ko-KR')}
                            </td>
                            <td className="px-3 py-2 tabular-nums text-right font-semibold">
                              ₩{Number(r.subtotal ?? 0).toLocaleString('ko-KR')}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-lg border border-gray-200 px-4 py-6 text-center text-sm text-gray-500">
                이번 달 롤업수당 내역이 없습니다.
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

