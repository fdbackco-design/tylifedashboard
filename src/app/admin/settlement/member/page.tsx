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
import type { SettlementCalculationDetail } from '@/lib/types/settlement';

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

  const [memberRes, membersRes, edgesRes, contractRowsRes, settlementsRes, rootSettlementRes] =
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
  for (const m of membersRaw as any[]) {
    nameById.set(m.id as string, String(m.name ?? '').replace(/^\[고객\]\s*/, ''));
  }

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
            기준 {start_date}~{end_date} · 정산용 담당자 = settlement_sales_member_id ?? sales_member_id 기준으로 분류합니다.
          </p>
        </div>
      </div>

      {/* 합계 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        <SummaryCard label="직접구좌 수" value={`${directRows.length.toLocaleString('ko-KR')}건 / ${directUnitSum.toLocaleString('ko-KR')}구좌`} />
        <SummaryCard label="직접구좌 정산금 합계" value={formatWon(directWonSum)} accent="emerald" />
        <SummaryCard label="산하구좌 수" value={`${downlineRows.length.toLocaleString('ko-KR')}건 / ${downlineUnitSum.toLocaleString('ko-KR')}구좌`} />
        <SummaryCard label="산하구좌 반영 금액 (rollup)" value={formatWon(rootRollupWon)} accent="amber" hint={`산하 직접수당 합: ${formatWon(downlineMemberDirectWonSum)}`} />
        <SummaryCard label="전체 정산금 합계" value={formatWon(rootTotalWon)} accent="indigo" hint={rootMs ? `기본 ${formatWon(rootMs.base_commission ?? 0)} + 산하 ${formatWon(rootRollupWon)} + 보너스 ${formatWon(rootIncentiveWon)}` : '월정산 결과 없음'} />
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
          본인({displayName})에게 반영되는 금액은 위 합계 카드의 "산하구좌 반영 금액 (rollup)" 으로 표시됩니다.
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
