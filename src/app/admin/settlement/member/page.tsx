import type { Metadata } from 'next';
import Link from 'next/link';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { getSettlementWindowForYearMonth } from '@/lib/settlement/settlement-window';
import { getContractDisplayStatus } from '@/lib/utils/contract-display-status';
import { isOrgDisplayHiddenMemberName } from '@/lib/organization/org-display-hidden';
import { isV2EligibleStatic } from '@/lib/settlement/settlement-eligibility-v2';
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
  const { start_date, end_date } = getSettlementWindowForYearMonth(yearMonth);
  const endExclusive = nextDay(end_date);

  const [memberRes, membersRes, edgesRes, contractRowsRes, settlementRes] = await Promise.all([
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
      .select(
        'id, contract_code, join_date, status, unit_count, item_name, sales_member_id, settlement_sales_member_id, customer_id, sales_link_status, is_cancelled, rental_request_no, invoice_no, memo, happy_call_at, happycall_result, customers(name)',
      )
      .gte('join_date', start_date)
      .lt('join_date', endExclusive),
    db
      .from('monthly_settlements')
      .select('rollup_commission, calculation_detail')
      .eq('year_month', yearMonth)
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

  const attributedSalesMemberId = (r: { customer_id: string | null; sales_member_id: string }): string => {
    const customer_id = r.customer_id ?? null;
    let sales_member_id = r.sales_member_id;
    if (customer_id) {
      const mapped = memberIdByCustomerId.get(customer_id);
      if (mapped) sales_member_id = mapped;
    }
    return sales_member_id;
  };

  const rows = ((contractRowsRes.data ?? []) as any[])
    // v_contract_settlement_base 와 동일한 "v2 정적 가입 인정 기준" 으로 필터
    // (취소/해약/계약취소 제외, sales_link_status='linked', happycall_result valid, invoice_no 존재)
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
      const origin = attributedSalesMemberId({
        customer_id: (c.customer_id ?? null) as string | null,
        sales_member_id: c.sales_member_id as string,
      });
      const joinYmd = String(c.join_date ?? '').slice(0, 10);
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
    .sort((a, b) => (b.join_date ?? '').localeCompare(a.join_date ?? ''));

  // 같은 고객명 + 같은 가입일 계약은 구좌 합산으로 한 줄로 묶는다.
  const groupedRows = (() => {
    const m = new Map<
      string,
      {
        contract_ids: string[];
        contract_codes: string[];
        customer_name: string;
        join_ymd: string;
        // 표시값은 첫 항목 기준(동일 가입일 그룹 내에는 보통 동일하나, 다를 수 있어도 UI 요구는 구좌 묶기)
        display_status: string;
        item_name: string | null;
        unit_count: number;
        origin: string;
        raw_sales_member_id: string;
        sort_join_date: string;
      }
    >();

    for (const r of rows) {
      const key = `${r.customer_name}__${r.join_ymd}`;
      const existing = m.get(key);
      if (!existing) {
        m.set(key, {
          contract_ids: [r.contract_id],
          contract_codes: [r.contract_code],
          customer_name: r.customer_name,
          join_ymd: r.join_ymd,
          display_status: r.display_status,
          item_name: r.item_name,
          unit_count: Number(r.unit_count ?? 0),
          origin: r.origin,
          raw_sales_member_id: r.raw_sales_member_id,
          sort_join_date: String(r.join_date ?? ''),
        });
        continue;
      }
      existing.contract_ids.push(r.contract_id);
      existing.contract_codes.push(r.contract_code);
      existing.unit_count += Number(r.unit_count ?? 0);
      // item_name이 비어있던 케이스만 보강
      if (!existing.item_name && r.item_name) existing.item_name = r.item_name;
    }

    return [...m.values()].sort((a, b) => (b.sort_join_date ?? '').localeCompare(a.sort_join_date ?? ''));
  })();

  const displayName = String(member.name ?? '').replace(/^\[고객\]\s*/, '');

  // ── 롤업수당 상세(계약 단위 근거) 준비 ─────────────────────────────────────
  // 1) calculation_detail.rollup_contract_items 가 있으면 우선 사용.
  // 2) 없으면 legacy 표시(멤버 단위 rollup_items 요약).
  const settlement = settlementRes.data as
    | { rollup_commission: number | null; calculation_detail: SettlementCalculationDetail | null }
    | null;
  const rollupCommission = Number(settlement?.rollup_commission ?? 0);
  const calcDetail = (settlement?.calculation_detail ?? null) as SettlementCalculationDetail | null;
  const rollupContractItemsRaw: RollupContractItem[] =
    Array.isArray(calcDetail?.rollup_contract_items) ? calcDetail!.rollup_contract_items! : [];
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
    item_name: string | null;
    display_status: string;
  };
  const rollupContractMetaById = new Map<string, RollupContractMeta>();
  if (rollupContractIds.length > 0) {
    const { data: metaRows } = await db
      .from('contracts')
      .select(
        'id, status, join_date, item_name, rental_request_no, invoice_no, memo, customers(name)',
      )
      .in('id', rollupContractIds);
    for (const c of (metaRows ?? []) as any[]) {
      rollupContractMetaById.set(c.id as string, {
        customer_name: ((c.customers as any)?.name as string | undefined) ?? '-',
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
    item_name: string | null;
    display_status: string;
    from_member_id: string;
    from_member_name: string;
    from_rank: RankType;
    effective_sales_member_id: string;
    effective_sales_member_name: string;
    unit_count: number;
    subtotal: number;
    // 표시용 정렬키
    sort_join_ymd: string;
  };
  const groupedRollupMap = new Map<string, GroupedRollupRow>();
  for (const r of rollupContractItemsRaw) {
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
    <div className="p-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="text-xs text-gray-500">
            <Link className="text-blue-600 hover:underline" href={`/admin/settlement?year_month=${yearMonth}`}>
              정산 현황
            </Link>
            <span className="mx-1">/</span>
            <span>산하 내역</span>
          </div>
          <h2 className="text-2xl font-bold text-gray-800 mt-2">
            {displayName} · {yearMonth}
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            기준 {start_date}~{end_date} · 이 멤버가 정산 담당자로 직접 정산받는 계약만 아래 표에 표시합니다. (산하 롤업 계약은 "롤업수당 상세" 섹션 참고)
          </p>
          <p className="text-xs text-gray-400 mt-1">
            총 {groupedRows.length.toLocaleString()}행
            <span className="ml-1">({rows.length.toLocaleString()}건)</span>
          </p>
        </div>
      </div>

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
                      '가입일',
                      '상품명',
                      '계약 상태',
                      '산하 멤버',
                      '산하 직급',
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
                  {groupedRollupRows.map((r) => {
                    const perUnitAvg = r.unit_count > 0 ? r.subtotal / r.unit_count : 0;
                    return (
                      <tr key={r.key} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-mono text-xs text-gray-700 whitespace-nowrap">
                          {r.contract_codes.join(', ')}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{r.customer_name}</td>
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
                    <td colSpan={8} className="px-3 py-2 text-right text-xs text-gray-500">
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
              직접 계약 + 정산 담단자 보정 계약
            </p>
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      {[
                        '계약코드',
                        '고객명',
                        '가입일',
                        '물품명',
                        '표시상태',
                        '구좌',
                        '귀속(산하)',
                        '원 담당자',
                        '수당',
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
                    {groupedRowsWithAmount.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-6 py-10 text-center text-sm text-gray-500">
                          표시할 계약이 없습니다.
                        </td>
                      </tr>
                    )}
                    {groupedRowsWithAmount.map((r) => (
                      <tr key={`${r.customer_name}__${r.join_ymd}`} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-mono text-xs text-gray-700">
                          {r.contract_codes.join(', ')}
                        </td>
                        <td className="px-4 py-3">{r.customer_name}</td>
                        <td className="px-4 py-3 tabular-nums text-gray-600">{r.join_ymd}</td>
                        <td className="px-4 py-3 text-xs text-gray-700 whitespace-nowrap">
                          {r.item_name ?? '-'}
                        </td>
                        <td className="px-4 py-3">{r.display_status}</td>
                        <td className="px-4 py-3 tabular-nums text-right">
                          {Number(r.unit_count ?? 0).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-600">
                          {(membersRaw.find((m: any) => m.id === r.origin)?.name ?? r.origin) as string}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">
                          {
                            (membersRaw.find((m: any) => m.id === r.raw_sales_member_id)?.name ??
                              r.raw_sales_member_id) as string
                          }
                        </td>
                        <td className="px-4 py-3 tabular-nums text-right font-semibold">
                          ₩{r.amount.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {groupedRowsWithAmount.length > 0 && (
                    <tfoot className="bg-gray-50 border-t border-gray-200">
                      <tr>
                        <td colSpan={5} className="px-4 py-3 text-right text-xs text-gray-500">
                          합계
                        </td>
                        <td className="px-4 py-3 tabular-nums text-right">
                          {totalUnits.toLocaleString()}
                        </td>
                        <td className="px-4 py-3" />
                        <td className="px-4 py-3" />
                        <td className="px-4 py-3 tabular-nums text-right font-semibold">
                          ₩{totalAmount.toLocaleString()}
                        </td>
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
