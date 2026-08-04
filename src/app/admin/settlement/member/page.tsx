import type { Metadata } from 'next';
import Link from 'next/link';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { getSettlementWindowDisplayForYearMonth } from '@/lib/settlement/settlement-window';
import { getContractDisplayStatus } from '@/lib/utils/contract-display-status';
import { isOrgDisplayHiddenMemberName } from '@/lib/organization/org-display-hidden';
import {
  evaluateContractEligibility,
  getHappycallWindowForYearMonth,
  happycallYmdSeoul,
} from '@/lib/settlement/settlement-eligibility-v2';

const MEMBER_PAGE_CONTRACT_SELECT =
  'id, contract_code, join_date, status, unit_count, item_name, product_type, source_snapshot_json, sales_member_id, settlement_sales_member_id, customer_id, sales_link_status, is_cancelled, rental_request_no, invoice_no, invoice_registered_at, settlement_deferred, deferred_to_month, memo, happy_call_at, happycall_result, customers(name)';
import type { RankType, SettlementCalculationDetail, RollupContractItem, RollupItem } from '@/lib/types';

export const metadata: Metadata = { title: '정산 현황 · 산하 내역' };
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

/**
 * Asia/Seoul 기준 'YYYY-MM-DD' 자정의 UTC ISO 문자열을 반환.
 * (예: '2026-06-26' → '2026-06-25T15:00:00.000Z')
 * happy_call_at (timestamptz) 범위 쿼리에 사용.
 */
function kstYmdToUtcIso(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, -9, 0, 0)).toISOString();
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
  // 가입 정산월 윈도우(참고용 표시) — 필터에는 사용하지 않는다.
  // 표시 전용: 공휴일/주말 보정된 정산 구간 (데이터 필터/계산에는 영향 없음).
  const { start_date, end_date } = getSettlementWindowDisplayForYearMonth(yearMonth);
  // 해피콜 완료 일자 기준 정산월 윈도우(공휴일/주말 보정 반영) — 본 페이지의 표시 필터 기준.
  const hcWindow = getHappycallWindowForYearMonth(yearMonth);
  const hcFromIso = kstYmdToUtcIso(hcWindow.start_date); // KST 자정 (inclusive)
  const hcToIso = kstYmdToUtcIso(nextDay(hcWindow.end_date)); // KST 다음날 자정 (exclusive)

  const [memberRes, membersRes, edgesRes, contractRowsRes, deferredRowsRes, settlementRes, preIssuedRes] =
    await Promise.all([
    db
      .from('organization_members')
      .select('id, name, rank, external_id, phone, source_customer_id')
      .eq('id', memberId)
      .maybeSingle(),
    db
      .from('organization_members')
      .select('id, name, rank, external_id, phone, source_customer_id')
      .eq('is_active', true),
    db.from('organization_edges').select('parent_id, child_id'),
    db
      .from('contracts')
      .select(MEMBER_PAGE_CONTRACT_SELECT)
      .not('happy_call_at', 'is', null)
      .gte('happy_call_at', hcFromIso)
      .lt('happy_call_at', hcToIso),
    // 수동 이월(deferred_to_month) 계약은 해피콜 일자가 다른 정산월 윈도우에 있을 수 있다.
    db
      .from('contracts')
      .select(MEMBER_PAGE_CONTRACT_SELECT)
      .eq('settlement_deferred', true)
      .eq('deferred_to_month', yearMonth),
    db
      .from('monthly_settlements')
      .select('rollup_commission, calculation_detail')
      .eq('year_month', yearMonth)
      .eq('member_id', memberId)
      .maybeSingle(),
    db
      .from('pre_issued_code_member_settings')
      .select('id, member_id, parent_leader_member_id, reason, special_unit_price, special_unit_limit, effective_from, effective_to, status, note, updated_at')
      .eq('member_id', memberId)
      .maybeSingle(),
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

  // child -> parent (dedupedEdges와 동일한 단일 parent 가정)
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

  const settlement = settlementRes.data as
    | { rollup_commission: number | null; calculation_detail: SettlementCalculationDetail | null }
    | null;
  const calcDetailEarly = (settlement?.calculation_detail ?? null) as SettlementCalculationDetail | null;
  const directContractIdsFromSettlement = Array.isArray(calcDetailEarly?.direct_contracts)
    ? (calcDetailEarly!.direct_contracts as Array<{ contract_id: string }>).map((x) => x.contract_id)
    : [];

  const contractRowMap = new Map<string, any>();
  for (const c of [
    ...((contractRowsRes.data ?? []) as any[]),
    ...((deferredRowsRes.data ?? []) as any[]),
  ]) {
    contractRowMap.set(c.id as string, c);
  }
  const missingSettlementDirectIds = directContractIdsFromSettlement.filter(
    (id) => !contractRowMap.has(id),
  );
  if (missingSettlementDirectIds.length > 0) {
    const { data: extraRows } = await db
      .from('contracts')
      .select(MEMBER_PAGE_CONTRACT_SELECT)
      .in('id', missingSettlementDirectIds);
    for (const c of (extraRows ?? []) as any[]) {
      contractRowMap.set(c.id as string, c);
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

  const rows = [...contractRowMap.values()]
    // 월정산 엔진과 동일: evaluateContractEligibility(yearMonth) === ELIGIBLE
    // (수동 이월 deferred_to_month 포함, 해피콜 윈도우 밖 계약도 해당 월이면 표시)
    .filter(
      (c) =>
        evaluateContractEligibility(
          {
            id: String(c.id ?? ''),
            status: String(c.status ?? ''),
            is_cancelled: Boolean(c.is_cancelled ?? false),
            sales_member_id: (c.sales_member_id ?? null) as string | null,
            sales_link_status: (c.sales_link_status ?? null) as string | null,
            happy_call_at: c.happy_call_at ?? null,
            happycall_result: (c.happycall_result ?? null) as string | null,
            product_type: (c.product_type ?? null) as string | null,
            item_name: (c.item_name ?? null) as string | null,
            source_snapshot_json: (c.source_snapshot_json ?? null) as Record<
              string,
              string | null
            > | null,
            invoice_no: (c.invoice_no ?? null) as string | null,
            invoice_registered_at: c.invoice_registered_at ?? null,
            settlement_deferred: (c.settlement_deferred ?? false) as boolean | null,
            deferred_to_month: (c.deferred_to_month ?? null) as string | null,
          },
          yearMonth,
        ).result === 'ELIGIBLE',
    )
    .map((c) => {
      const origin = attributedSalesMemberId({
        customer_id: (c.customer_id ?? null) as string | null,
        sales_member_id: c.sales_member_id as string,
      });
      const joinYmd = String(c.join_date ?? '').slice(0, 10);
      const hcYmd = happycallYmdSeoul(c.happy_call_at);
      const settlementOverride = (c.settlement_sales_member_id ?? null) as string | null;
      const rawSales = c.sales_member_id as string;
      // effectiveSettlementMemberId:
      //   settlement_sales_member_id 가 있으면 그것을 정산 담당자로 사용,
      //   없으면 sales_member_id 사용 (요구사항 그대로).
      const effective_settlement_member_id: string | null =
        settlementOverride ?? (rawSales ?? null);
      return {
        contract_id: c.id as string,
        contract_code: c.contract_code as string,
        join_date: c.join_date as string | null,
        join_ymd: joinYmd,
        hc_ymd: hcYmd,
        happy_call_at: (c.happy_call_at ?? null) as string | null,
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
        raw_sales_member_id: rawSales,
        effective_settlement_member_id,
      };
    })
    // 표시 기준(요구):
    //   effectiveSettlementMemberId === selectedMemberId 인 계약만 표시.
    //   즉, "선택한 영업자가 직접 정산을 받는 계약"만 보여준다.
    //   (산하 멤버의 계약 / 롤업수당 발생 계약은 이 목록에서 제외하고,
    //    별도의 "롤업수당 상세" 섹션에서 rollup_contract_items 기반으로 보여준다.)
    .filter((x) => x.effective_settlement_member_id === memberId)
    // 정렬은 해피콜 완료 일자(정산월 기준 키) 내림차순
    .sort((a, b) => (b.hc_ymd ?? '').localeCompare(a.hc_ymd ?? ''));

  // 같은 고객명 + 같은 해피콜 완료일자 계약은 구좌 합산으로 한 줄로 묶는다.
  const groupedRows = (() => {
    const m = new Map<
      string,
      {
        contract_ids: string[];
        contract_codes: string[];
        customer_name: string;
        join_ymd: string;
        hc_ymd: string;
        // 표시값은 첫 항목 기준(동일 키 그룹 내에는 보통 동일하나, 다를 수 있어도 UI 요구는 구좌 묶기)
        display_status: string;
        item_name: string | null;
        unit_count: number;
        origin: string;
        raw_sales_member_id: string;
        sort_key: string;
      }
    >();

    for (const r of rows) {
      const key = `${r.customer_name}__${r.hc_ymd}`;
      const existing = m.get(key);
      if (!existing) {
        m.set(key, {
          contract_ids: [r.contract_id],
          contract_codes: [r.contract_code],
          customer_name: r.customer_name,
          join_ymd: r.join_ymd,
          hc_ymd: r.hc_ymd,
          display_status: r.display_status,
          item_name: r.item_name,
          unit_count: Number(r.unit_count ?? 0),
          origin: r.origin,
          raw_sales_member_id: r.raw_sales_member_id,
          sort_key: r.hc_ymd ?? '',
        });
        continue;
      }
      existing.contract_ids.push(r.contract_id);
      existing.contract_codes.push(r.contract_code);
      existing.unit_count += Number(r.unit_count ?? 0);
      // item_name이 비어있던 케이스만 보강
      if (!existing.item_name && r.item_name) existing.item_name = r.item_name;
    }

    return [...m.values()].sort((a, b) => (b.sort_key ?? '').localeCompare(a.sort_key ?? ''));
  })();

  const displayName = String(member.name ?? '').replace(/^\[고객\]\s*/, '');

  // ── 롤업수당 상세(계약 단위 근거) 준비 ─────────────────────────────────────
  // 1) calculation_detail.rollup_contract_items 가 있으면 우선 사용.
  // 2) 없으면 legacy 표시(멤버 단위 rollup_items 요약).
  const rollupCommission = Number(settlement?.rollup_commission ?? 0);
  const calcDetail = calcDetailEarly;
  const rollupContractItemsRaw: RollupContractItem[] =
    Array.isArray(calcDetail?.rollup_contract_items) ? calcDetail!.rollup_contract_items! : [];
  const showCenterChiefRollupAudit =
    String(member.rank ?? '') === '센터장' ||
    rollupContractItemsRaw.some((r) => r.center_chief_rollup_segment);
  const rollupItems: RollupItem[] = Array.isArray(calcDetail?.rollup_items)
    ? (calcDetail!.rollup_items as RollupItem[])
    : [];

  // 표시용 계약 메타 join (rollup_contract_items 의 contract_id 가 윈도우 밖일 수 있으므로 별도 조회)
  const rollupContractIds = Array.from(
    new Set(rollupContractItemsRaw.map((r) => r.contract_id).filter(Boolean)),
  );
  type RollupContractMeta = {
    customer_name: string;
    join_ymd: string;
    hc_ymd: string;
    item_name: string | null;
    display_status: string;
  };
  const rollupContractMetaById = new Map<string, RollupContractMeta>();
  if (rollupContractIds.length > 0) {
    const { data: metaRows } = await db
      .from('contracts')
      .select(
        'id, status, join_date, happy_call_at, item_name, rental_request_no, invoice_no, memo, customers(name)',
      )
      .in('id', rollupContractIds);
    for (const c of (metaRows ?? []) as any[]) {
      rollupContractMetaById.set(c.id as string, {
        customer_name: ((c.customers as any)?.name as string | undefined) ?? '-',
        join_ymd: String(c.join_date ?? '').slice(0, 10),
        hc_ymd: happycallYmdSeoul(c.happy_call_at),
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

  // 정합성 검증: 합계 일치 여부 표시(소수점 평균 단가로 인한 1원 이내 오차는 허용)
  const rollupContractItemsTotal = rollupContractItemsRaw.reduce((s, x) => s + Number(x.subtotal ?? 0), 0);
  const rollupItemsTotal = rollupItems.reduce((s, x) => s + Number(x.subtotal ?? 0), 0);
  const rollupTotalsMatch =
    Math.abs(rollupContractItemsTotal - rollupCommission) <= 1 &&
    Math.abs(rollupItemsTotal - rollupCommission) <= 1;

  const memberNameById = new Map<string, string>(
    (membersRaw as any[]).map((m) => [m.id as string, String(m.name ?? '').replace(/^\[고객\]\s*/, '')]),
  );

  // 산하 계약 목록 표시용: 계약별로 이 멤버에게 발생한 정산 금액(직접 + 롤업) 합.
  // - direct_contracts: 그 계약이 멤버 본인에게 직접 발생시킨 수당
  // - rollup_contract_items: 그 계약이 멤버에게 롤업으로 발생시킨 수당
  // 정산 결과 자체(monthly_settlements 합계)를 변경하지 않고 표시만 한다.
  const directContractItems: { contract_id: string; subtotal: number }[] = Array.isArray(
    calcDetail?.direct_contracts,
  )
    ? (calcDetail!.direct_contracts as Array<{ contract_id: string; subtotal: number }>)
    : [];
  const amountByContractId = new Map<string, number>();
  for (const it of directContractItems) {
    const prev = amountByContractId.get(it.contract_id) ?? 0;
    amountByContractId.set(it.contract_id, prev + Number(it.subtotal ?? 0));
  }
  for (const it of rollupContractItemsRaw) {
    const prev = amountByContractId.get(it.contract_id) ?? 0;
    amountByContractId.set(it.contract_id, prev + Number(it.subtotal ?? 0));
  }

  // 그룹화: (고객명, 가입일, 상품명, 계약상태, 산하멤버) 가 동일한 계약은 한 줄로 묶어
  // 구좌수/롤업 소계를 합산하고, 구좌당 롤업은 가중평균(= sum(subtotal)/sum(units)) 으로 표시.
  // (계약 단위 합계 자체는 변경되지 않으므로 정합성 영향 없음)
  type GroupedRollupRow = {
    key: string;
    contract_codes: string[];
    customer_name: string;
    join_ymd: string;
    hc_ymd: string;
    item_name: string | null;
    display_status: string;
    from_member_id: string;
    from_member_name: string;
    from_rank: RankType;
    effective_sales_member_id: string;
    effective_sales_member_name: string;
    unit_count: number;
    subtotal: number;
    sort_join_ymd: string;
    center_chief_rollup_segment?: RollupContractItem['center_chief_rollup_segment'];
    center_chief_promotion_confirmed_ymd?: string | null;
    upper_rank_applied?: RankType;
    upper_direct_commission_per_unit?: number;
    lower_direct_commission_per_unit?: number;
    org_path_label?: string;
  };
  const groupedRollupMap = new Map<string, GroupedRollupRow>();
  for (const r of rollupContractItemsRaw) {
    const meta = rollupContractMetaById.get(r.contract_id);
    const customer_name = meta?.customer_name ?? '-';
    const join_ymd = meta?.join_ymd ?? '';
    const hc_ymd = meta?.hc_ymd ?? '';
    const item_name = meta?.item_name ?? null;
    const display_status = meta?.display_status ?? '-';
    const key = [
      customer_name,
      hc_ymd,
      join_ymd,
      item_name ?? '',
      display_status,
      r.from_member_id,
    ].join('||');
    const fromName =
      memberNameById.get(r.from_member_id) ?? r.from_member_name ?? r.from_member_id;
    const effName =
      memberNameById.get(r.effective_sales_member_id) ??
      r.effective_sales_member_name ??
      r.effective_sales_member_id;
    const units = Number(r.unit_count ?? 0);
    const sub = Number(r.subtotal ?? 0);
    const existing = groupedRollupMap.get(key);
    if (!existing) {
      groupedRollupMap.set(key, {
        key,
        contract_codes: [r.contract_code],
        customer_name,
        join_ymd,
        hc_ymd,
        item_name,
        display_status,
        from_member_id: r.from_member_id,
        from_member_name: fromName,
        from_rank: r.from_rank,
        effective_sales_member_id: r.effective_sales_member_id,
        effective_sales_member_name: effName,
        unit_count: units,
        subtotal: sub,
        sort_join_ymd: join_ymd,
        center_chief_rollup_segment: r.center_chief_rollup_segment,
        center_chief_promotion_confirmed_ymd: r.center_chief_promotion_confirmed_ymd,
        upper_rank_applied: r.upper_rank_applied,
        upper_direct_commission_per_unit: r.upper_direct_commission_per_unit,
        lower_direct_commission_per_unit: r.lower_direct_commission_per_unit,
        org_path_label: r.org_path_label,
      });
      continue;
    }
    existing.contract_codes.push(r.contract_code);
    existing.unit_count += units;
    existing.subtotal += sub;
    if (!existing.item_name && item_name) existing.item_name = item_name;
  }
  const groupedRollupRows = [...groupedRollupMap.values()].sort((a, b) => {
    if (a.sort_join_ymd !== b.sort_join_ymd) return b.sort_join_ymd.localeCompare(a.sort_join_ymd);
    return (a.from_member_name ?? '').localeCompare(b.from_member_name ?? '');
  });

  return (
    <div className="p-3 sm:p-6">
      <div className="mb-4 sm:mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs text-gray-500">
            <Link className="text-blue-600 hover:underline" href={`/admin/settlement?year_month=${yearMonth}`}>
              정산 현황
            </Link>
            <span className="mx-1">/</span>
            <span>산하 내역</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-gray-800 mt-2 break-keep">
            {displayName} · {yearMonth}
          </h2>
          <p className="text-xs sm:text-sm text-gray-500 mt-1 break-keep leading-relaxed">
            {yearMonth} 정산 대상 계약(해피콜 윈도우 {hcWindow.start_date}~{hcWindow.end_date} + 수동 이월 포함)을
            표시합니다.
            <span className="text-gray-400"> (가입 정산 윈도우 {start_date}~{end_date})</span>
          </p>
          <p className="text-xs text-gray-400 mt-1">
            총 {groupedRows.length.toLocaleString()}행
            <span className="ml-1">({rows.length.toLocaleString()}건)</span>
          </p>
        </div>
      </div>

      {(() => {
        const setting = (preIssuedRes.data ?? null) as any | null;
        if (!setting) return null;

        const ymEnd = (() => {
          const [y, m] = yearMonth.split('-').map(Number);
          const dt = new Date(Date.UTC(y, m, 0));
          return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
        })();
        const isActiveOnMonthEnd = (() => {
          const st = String(setting.status ?? 'active');
          if (st !== 'active') return false;
          const from = String(setting.effective_from ?? '').slice(0, 10);
          const to = setting.effective_to != null ? String(setting.effective_to).slice(0, 10) : null;
          if (!from || ymEnd < from) return false;
          if (to && ymEnd > to) return false;
          return true;
        })();

        const parentId = isActiveOnMonthEnd ? String(setting.parent_leader_member_id ?? '') : '';
        const parentName =
          parentId && membersRaw
            ? (membersRaw.find((m: any) => String(m.id) === parentId)?.name ?? parentId)
            : '-';

        const directItems = Array.isArray(calcDetail?.direct_contracts) ? (calcDetail!.direct_contracts as any[]) : [];
        const specialAppliedUnits = directItems.reduce((s, x) => s + Number(x.pre_issued_special_units ?? 0), 0);
        const normalConvertedUnits = directItems.reduce((s, x) => s + Number(x.pre_issued_normal_units ?? 0), 0);
        const specialAmount = directItems.reduce((s, x) => s + Number(x.pre_issued_special_amount ?? 0), 0);
        const normalAmount = directItems.reduce((s, x) => s + Number(x.pre_issued_normal_amount ?? 0), 0);
        const directActualUnits = directItems.reduce((s, x) => s + Number(x.unit_count ?? 0), 0);
        const limit = Number(setting.special_unit_limit ?? 0);
        const remaining = Math.max(0, limit - specialAppliedUnits);
        const st = String(setting.status ?? 'active');
        const runtimeStatus =
          st === 'paused'
            ? '중지'
            : st === 'ended'
              ? '종료'
              : remaining === 0 && limit > 0
                ? '특례 소진'
                : '적용중';

        const promoEligible = calcDetail?.leader_promotion?.subtree_promotion_eligible_units_as_of_end ?? null;
        const rankLabel = String(member?.rank ?? '-');

        const nextUnitPriceHint =
          remaining > 0
            ? `특례 ${Number(setting.special_unit_price ?? 0).toLocaleString()}원/구좌`
            : `${rankLabel} 일반 단가 적용`;

        return (
          <section className="mb-6 rounded-lg border border-orange-200 bg-white shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-orange-50 border-b border-orange-100">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-orange-900">코드 선발급 특례 · 월말 기준 요약</h3>
                  <p className="text-[11px] text-orange-800 mt-1">
                    월말({ymEnd}) 기준 활성 설정이 해당 월 전체 오버라이드/롤업 경로에 적용됩니다.
                  </p>
                </div>
                <span className="inline-flex rounded-full bg-white px-2 py-1 text-xs font-semibold text-orange-800 border border-orange-200">
                  {runtimeStatus}
                </span>
              </div>
            </div>
            <div className="px-4 py-3 grid gap-2 sm:grid-cols-2 text-xs text-gray-700">
              <div>적용단가: <span className="font-semibold tabular-nums">₩{Number(setting.special_unit_price ?? 0).toLocaleString()}</span></div>
              <div>적용구좌: <span className="font-semibold tabular-nums">{limit.toLocaleString()}구좌</span></div>
              <div>특례 수당용 실제 직접판매 누적: <span className="font-semibold tabular-nums">{directActualUnits.toLocaleString()}구좌</span></div>
              <div>특례 적용 누계: <span className="font-semibold tabular-nums text-orange-800">{specialAppliedUnits.toLocaleString()}구좌</span></div>
              <div>남은 특례 구좌: <span className="font-semibold tabular-nums">{remaining.toLocaleString()}구좌</span></div>
              <div>승급용 인정구좌 누계(말일): <span className="font-semibold tabular-nums">{promoEligible != null ? Number(promoEligible).toLocaleString() : '-'}</span></div>
              <div>현재 직급: <span className="font-semibold">{rankLabel}</span></div>
              <div>월말 기준 상위리더: <span className="font-semibold">{isActiveOnMonthEnd ? String(parentName).replace(/^\\[고객\\]\\s*/, '') : '-'}</span></div>
              <div className="sm:col-span-2">
                특례 적용 수당: <span className="font-semibold tabular-nums">₩{Math.round(specialAmount).toLocaleString()}</span>
                <span className="mx-2 text-gray-300">|</span>
                일반 단가 수당: <span className="font-semibold tabular-nums">₩{Math.round(normalAmount).toLocaleString()}</span>
                <span className="mx-2 text-gray-300">|</span>
                일반 전환 구좌: <span className="font-semibold tabular-nums">{normalConvertedUnits.toLocaleString()}구좌</span>
              </div>
              <div className="sm:col-span-2 text-[11px] text-gray-600 leading-relaxed">
                특례 수당은 실제 직접판매 {limit.toLocaleString()}구좌에서 소진됩니다.
                승급 인정구좌는 더블업 포함 규칙으로 별도 계산됩니다.
                <br />
                다음 직접판매 계약 예상 단가: <span className="font-semibold">{nextUnitPriceHint}</span>
              </div>
            </div>
          </section>
        );
      })()}

      {calcDetail?.leader_promotion && (
        <section className="mb-6 bg-white rounded-lg border border-indigo-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-indigo-50 border-b border-indigo-100">
            <h3 className="text-sm font-semibold text-indigo-900">승급·더블업 감사</h3>
            <p className="text-xs text-indigo-700 mt-1">
              {calcDetail.leader_promotion.double_up_commission_note ??
                '승급은 인정구좌로 판정하고, 승급 이후 수당 단가는 리더·수량은 실제 구좌 기준입니다.'}
            </p>
          </div>
          <div className="px-4 py-3 grid gap-2 sm:grid-cols-2 text-xs text-gray-700">
            <div>
              실제 누적 구좌(말일):{' '}
              <span className="font-semibold tabular-nums">
                {calcDetail.leader_promotion.subtree_join_units_join_status_as_of_end.toLocaleString()}구좌
              </span>
            </div>
            <div>
              승급 인정 누적(더블업 반영):{' '}
              <span className="font-semibold tabular-nums text-indigo-800">
                {(calcDetail.leader_promotion.subtree_promotion_eligible_units_as_of_end ?? 0).toLocaleString()}구좌
              </span>
            </div>
            {calcDetail.leader_promotion.leader_promotion_threshold_contract_id && (
              <div className="sm:col-span-2">
                승급 기준 계약:{' '}
                <span className="font-mono text-gray-600">
                  {calcDetail.leader_promotion.leader_promotion_threshold_contract_id}
                </span>
                {calcDetail.leader_promotion.leader_promotion_first_join_date && (
                  <span className="ml-2 text-gray-500">
                    ({calcDetail.leader_promotion.leader_promotion_first_join_date})
                  </span>
                )}
              </div>
            )}
          </div>
          {Array.isArray(calcDetail.leader_promotion.promotion_commission_audit) &&
            calcDetail.leader_promotion.promotion_commission_audit.some((r) => r.doubleUpApplied) && (
              <div className="overflow-x-auto border-t border-gray-100">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      {[
                        '계약',
                        '해피콜',
                        '실제 구좌',
                        '더블업',
                        '배수',
                        '승급 인정',
                        '수당 구좌',
                        '보너스 구좌',
                      ].map((h) => (
                        <th key={h} className="px-3 py-2 text-left font-semibold text-gray-600 whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {calcDetail.leader_promotion.promotion_commission_audit
                      .filter((r) => r.doubleUpApplied)
                      .map((r) => (
                        <tr key={r.contractId}>
                          <td className="px-3 py-2 font-mono">{r.contractCode}</td>
                          <td className="px-3 py-2">{r.happyCallSuccessYmd ?? '-'}</td>
                          <td className="px-3 py-2 tabular-nums">{r.actualUnitCount ?? r.unitCount}</td>
                          <td className="px-3 py-2">{r.doubleUpApplied ? '적용' : '-'}</td>
                          <td className="px-3 py-2 tabular-nums">×{r.promotionMultiplier ?? 1}</td>
                          <td className="px-3 py-2 tabular-nums text-indigo-800">
                            {r.promotionEligibleUnitCount ?? r.unitCount}
                          </td>
                          <td className="px-3 py-2 tabular-nums">{r.commissionUnitCount ?? r.unitCount}</td>
                          <td className="px-3 py-2 tabular-nums">{r.bonusUnitCount ?? r.unitCount}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
        </section>
      )}

      {/* ── 롤업수당 상세 (계약 단위 근거) ────────────────────────────────────── */}
      <section className="mb-6">
        <div className="mb-2 flex items-end justify-between gap-3">
          <h3 className="text-base font-semibold text-gray-800">롤업수당 상세 (계약 단위)</h3>
          <div className="text-xs text-gray-500">
            롤업수당 합계{' '}
            <span className="font-semibold text-gray-700">
              ₩{rollupCommission.toLocaleString()}
            </span>
            {rollupContractItemsRaw.length > 0 && (
              <>
                {' '}
                · 계약단위 합계{' '}
                <span className={rollupTotalsMatch ? 'text-gray-700' : 'text-red-600 font-semibold'}>
                  ₩{rollupContractItemsTotal.toLocaleString()}
                </span>
                {!rollupTotalsMatch && (
                  <span className="ml-2 text-red-600">⚠ 합계 불일치</span>
                )}
              </>
            )}
          </div>
        </div>

        {rollupContractItemsRaw.length > 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    {[
                      '계약코드',
                      '고객명',
                      '해피콜 일시',
                      '가입일',
                      '상품명',
                      '계약 상태',
                      '산하 멤버',
                      '산하 직급',
                      '실제 계약 담당자',
                      ...(showCenterChiefRollupAudit
                        ? ['수당 구간', '승급 확정일', '상위 직급', '상위 단가', '하위 단가', '조직 경로']
                        : []),
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
                  {groupedRollupRows.map((r) => {
                    const perUnitAvg = r.unit_count > 0 ? r.subtotal / r.unit_count : 0;
                    return (
                      <tr key={r.key} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-mono text-xs text-gray-700 whitespace-nowrap">
                          {r.contract_codes.join(', ')}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{r.customer_name}</td>
                        <td className="px-3 py-2 tabular-nums text-gray-700 whitespace-nowrap font-medium">
                          {r.hc_ymd || '-'}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-gray-600 whitespace-nowrap">
                          {r.join_ymd || '-'}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-700 whitespace-nowrap">
                          {r.item_name ?? '-'}
                        </td>
                        <td className="px-3 py-2 text-xs whitespace-nowrap">{r.display_status}</td>
                        <td className="px-3 py-2 text-xs text-gray-700 whitespace-nowrap">
                          {r.from_member_name}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
                          {r.from_rank ?? '-'}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">
                          {r.effective_sales_member_name}
                        </td>
                        {showCenterChiefRollupAudit && (
                          <>
                            <td className="px-3 py-2 text-xs whitespace-nowrap">
                              {r.center_chief_rollup_segment === 'CENTER_AFTER_PROMOTION'
                                ? '승급 후'
                                : r.center_chief_rollup_segment === 'LEADER_BEFORE_CENTER'
                                  ? '승급 전/대기'
                                  : '-'}
                            </td>
                            <td className="px-3 py-2 tabular-nums text-xs whitespace-nowrap">
                              {r.center_chief_promotion_confirmed_ymd ?? '-'}
                            </td>
                            <td className="px-3 py-2 text-xs whitespace-nowrap">
                              {r.upper_rank_applied ?? '-'}
                            </td>
                            <td className="px-3 py-2 tabular-nums text-right text-xs">
                              {r.upper_direct_commission_per_unit != null
                                ? `₩${r.upper_direct_commission_per_unit.toLocaleString()}`
                                : '-'}
                            </td>
                            <td className="px-3 py-2 tabular-nums text-right text-xs">
                              {r.lower_direct_commission_per_unit != null
                                ? `₩${r.lower_direct_commission_per_unit.toLocaleString()}`
                                : '-'}
                            </td>
                            <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap max-w-[200px] truncate" title={r.org_path_label ?? ''}>
                              {r.org_path_label ?? '-'}
                            </td>
                          </>
                        )}
                        <td className="px-3 py-2 tabular-nums text-right">
                          {r.unit_count.toLocaleString()}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-right text-gray-700">
                          ₩{Math.round(perUnitAvg).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-right font-semibold">
                          ₩{r.subtotal.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-gray-50 border-t border-gray-200">
                  <tr>
                    <td
                      colSpan={9 + (showCenterChiefRollupAudit ? 6 : 0)}
                      className="px-3 py-2 text-right text-xs text-gray-500"
                    >
                      합계
                    </td>
                    <td className="px-3 py-2 tabular-nums text-right">
                      {groupedRollupRows.reduce((s, x) => s + x.unit_count, 0).toLocaleString()}
                    </td>
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2 tabular-nums text-right font-semibold">
                      ₩{rollupContractItemsTotal.toLocaleString()}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        ) : rollupItems.length > 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 text-xs text-amber-700 bg-amber-50 border-b border-amber-100">
              이 정산은 계약 단위 근거가 저장되기 전 데이터입니다. 멤버 단위 요약만 표시합니다.
              <span className="ml-1 text-gray-500">(정산 재계산 시 계약 단위 상세가 채워집니다)</span>
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
                  {rollupItems.map((r, idx) => {
                    const nm =
                      memberNameById.get(r.from_member_id) ?? r.from_member_name ?? r.from_member_id;
                    return (
                      <tr key={`${r.from_member_id}__${idx}`} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-xs text-gray-700">{nm}</td>
                        <td className="px-3 py-2 text-xs text-gray-500">{r.from_rank}</td>
                        <td className="px-3 py-2 tabular-nums text-right">
                          {Number(r.unit_count ?? 0).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-right text-gray-700">
                          ₩{Math.round(Number(r.rollup_amount_per_unit ?? 0)).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-right font-semibold">
                          ₩{Number(r.subtotal ?? 0).toLocaleString()}
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
            이 멤버의 해당 월 롤업수당 내역이 없습니다.
          </div>
        )}
      </section>

      {/* ── 직접 정산 계약 목록 ────────────────────────────────────────────── */}
      {(() => {
        // 표시용: 각 그룹의 (직접 + 롤업) 수당 합. 정산 합계 값은 변경하지 않는다.
        const groupedRowsWithAmount = groupedRows.map((r) => {
          const amount = r.contract_ids.reduce(
            (s, id) => s + (amountByContractId.get(id) ?? 0),
            0,
          );
          return { ...r, amount };
        });
        const totalUnits = groupedRowsWithAmount.reduce(
          (s, x) => s + Number(x.unit_count ?? 0),
          0,
        );
        const totalAmount = groupedRowsWithAmount.reduce((s, x) => s + x.amount, 0);
        return (
          <>
            <h3 className="text-base font-semibold text-gray-800 mb-2">직접 정산 계약 목록</h3>
            <p className="text-xs text-gray-500 mb-2">
              직접 계약 + 정산 담당자 보정 계약
            </p>
            {Array.isArray(calcDetail?.direct_contracts) &&
              (calcDetail!.direct_contracts as any[]).some((x) => x.pre_issued_special_applied) && (
                <div className="mb-3 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-800">
                  <span className="font-semibold">[코드 선발급 특례 적용]</span>{' '}
                  특례 단가는 개인 직접판매 수당에만 적용되며, 오버라이드·승급·보너스·더블업·썸머 집계는 기존 규칙을 유지합니다.
                </div>
              )}
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto [-webkit-overflow-scrolling:touch]">
                <table className="w-full min-w-[920px] text-xs sm:text-sm">
                  <colgroup>
                    <col className="w-[7.5rem]" />
                    <col className="w-[5rem]" />
                    <col className="w-[6.5rem]" />
                    <col className="w-[5.5rem]" />
                    <col className="min-w-[9rem]" />
                    <col className="w-[4.5rem]" />
                    <col className="w-[3rem]" />
                    <col className="w-[5.5rem]" />
                    <col className="w-[5.5rem]" />
                    <col className="w-[5.5rem]" />
                  </colgroup>
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      {[
                        '계약코드',
                        '고객명',
                        '해피콜 일시',
                        '가입일',
                        '물품명',
                        '표시상태',
                        '구좌',
                        '귀속(산하)',
                        '원 담당자',
                        '수당',
                        '특례(구좌)',
                        '일반전환(구좌)',
                        '특례수당',
                        '일반수당',
                        '월말 상위리더',
                        '부모 출처',
                      ].map((h) => (
                        <th
                          key={h}
                          className="px-2 sm:px-3 py-2 text-left text-[11px] sm:text-xs font-semibold text-gray-600 whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {groupedRowsWithAmount.length === 0 && (
                      <tr>
                        <td colSpan={16} className="px-4 py-10 text-center text-sm text-gray-500">
                          표시할 계약이 없습니다.
                        </td>
                      </tr>
                    )}
                    {groupedRowsWithAmount.map((r) => {
                      const originName =
                        (membersRaw.find((m: any) => m.id === r.origin)?.name ?? r.origin) as string;
                      const rawSalesName =
                        (membersRaw.find((m: any) => m.id === r.raw_sales_member_id)?.name ??
                          r.raw_sales_member_id) as string;
                      const directItems = Array.isArray(calcDetail?.direct_contracts)
                        ? (calcDetail!.direct_contracts as any[])
                        : [];
                      const ids = new Set<string>(r.contract_ids as string[]);
                      let specialUnits = 0;
                      let normalUnits = 0;
                      let specialAmount = 0;
                      let normalAmount = 0;
                      for (const it of directItems) {
                        if (!ids.has(String(it.contract_id))) continue;
                        specialUnits += Number(it.pre_issued_special_units ?? 0);
                        normalUnits += Number(it.pre_issued_normal_units ?? 0);
                        specialAmount += Number(it.pre_issued_special_amount ?? 0);
                        normalAmount += Number(it.pre_issued_normal_amount ?? 0);
                      }

                      const setting = (preIssuedRes.data ?? null) as any | null;
                      const ymEnd = (() => {
                        const [y, m] = yearMonth.split('-').map(Number);
                        const dt = new Date(Date.UTC(y, m, 0));
                        return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
                      })();
                      const isActiveOnMonthEnd = (() => {
                        if (!setting) return false;
                        const st = String(setting.status ?? 'active');
                        if (st !== 'active') return false;
                        const from = String(setting.effective_from ?? '').slice(0, 10);
                        const to = setting.effective_to != null ? String(setting.effective_to).slice(0, 10) : null;
                        if (!from || ymEnd < from) return false;
                        if (to && ymEnd > to) return false;
                        return true;
                      })();
                      const monthEndParentId = isActiveOnMonthEnd ? String(setting?.parent_leader_member_id ?? '') : '';
                      const monthEndParentName =
                        monthEndParentId
                          ? String(membersRaw.find((m: any) => String(m.id) === monthEndParentId)?.name ?? monthEndParentId).replace(/^\[고객\]\s*/, '')
                          : '-';
                      const parentSource =
                        isActiveOnMonthEnd
                          ? '코드 선발급 예외'
                          : (parentByChild.get(r.origin) ?? null)
                            ? '일반 조직도'
                            : '본사 직속';
                      return (
                        <tr key={`${r.customer_name}__${r.hc_ymd}`} className="hover:bg-gray-50 align-top">
                          <td className="px-2 sm:px-3 py-2">
                            <div className="flex flex-col gap-0.5">
                              {r.contract_codes.map((code) => (
                                <span
                                  key={code}
                                  className="font-mono text-[10px] sm:text-[11px] text-gray-700 whitespace-nowrap"
                                >
                                  {code}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="px-2 sm:px-3 py-2 font-medium text-gray-800 whitespace-nowrap break-keep">
                            {r.customer_name}
                          </td>
                          <td className="px-2 sm:px-3 py-2 tabular-nums text-gray-700 whitespace-nowrap font-medium">
                            {r.hc_ymd || '-'}
                          </td>
                          <td className="px-2 sm:px-3 py-2 tabular-nums text-gray-500 whitespace-nowrap">
                            {r.join_ymd}
                          </td>
                          <td className="px-2 sm:px-3 py-2 text-gray-700 leading-snug">
                            <span className="line-clamp-2 break-words">{r.item_name ?? '-'}</span>
                          </td>
                          <td className="px-2 sm:px-3 py-2 whitespace-nowrap">{r.display_status}</td>
                          <td className="px-2 sm:px-3 py-2 tabular-nums text-right whitespace-nowrap">
                            {Number(r.unit_count ?? 0).toLocaleString()}
                          </td>
                          <td className="px-2 sm:px-3 py-2 text-gray-600 whitespace-nowrap break-keep max-w-[5.5rem] truncate">
                            {originName}
                          </td>
                          <td className="px-2 sm:px-3 py-2 text-gray-500 whitespace-nowrap break-keep max-w-[5.5rem] truncate">
                            {rawSalesName}
                          </td>
                          <td className="px-2 sm:px-3 py-2 tabular-nums text-right font-semibold whitespace-nowrap">
                            ₩{r.amount.toLocaleString()}
                          </td>
                          <td className="px-2 sm:px-3 py-2 tabular-nums text-right text-orange-800 whitespace-nowrap">
                            {specialUnits > 0 ? specialUnits.toLocaleString() : '-'}
                          </td>
                          <td className="px-2 sm:px-3 py-2 tabular-nums text-right text-gray-700 whitespace-nowrap">
                            {normalUnits > 0 ? normalUnits.toLocaleString() : '-'}
                          </td>
                          <td className="px-2 sm:px-3 py-2 tabular-nums text-right text-orange-800 whitespace-nowrap">
                            {specialAmount > 0 ? `₩${Math.round(specialAmount).toLocaleString()}` : '-'}
                          </td>
                          <td className="px-2 sm:px-3 py-2 tabular-nums text-right text-gray-700 whitespace-nowrap">
                            {normalAmount > 0 ? `₩${Math.round(normalAmount).toLocaleString()}` : '-'}
                          </td>
                          <td className="px-2 sm:px-3 py-2 text-gray-700 whitespace-nowrap break-keep max-w-[6.5rem] truncate">
                            {monthEndParentName}
                          </td>
                          <td className="px-2 sm:px-3 py-2 text-gray-500 whitespace-nowrap">{parentSource}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {groupedRowsWithAmount.length > 0 && (
                    <tfoot className="bg-gray-50 border-t border-gray-200">
                      <tr>
                        <td colSpan={6} className="px-2 sm:px-3 py-2 text-right text-xs text-gray-500 whitespace-nowrap">
                          합계
                        </td>
                        <td className="px-2 sm:px-3 py-2 tabular-nums text-right whitespace-nowrap">
                          {totalUnits.toLocaleString()}
                        </td>
                        <td className="px-2 sm:px-3 py-2" />
                        <td className="px-2 sm:px-3 py-2" />
                        <td className="px-2 sm:px-3 py-2 tabular-nums text-right font-semibold whitespace-nowrap">
                          ₩{totalAmount.toLocaleString()}
                        </td>
                        <td className="px-2 sm:px-3 py-2" />
                        <td className="px-2 sm:px-3 py-2" />
                        <td className="px-2 sm:px-3 py-2" />
                        <td className="px-2 sm:px-3 py-2" />
                        <td className="px-2 sm:px-3 py-2" />
                        <td className="px-2 sm:px-3 py-2" />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </>
        );
      })()}
    </div>
  );
}
