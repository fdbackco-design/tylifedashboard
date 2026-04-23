import type { Metadata } from 'next';
import Link from 'next/link';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { getSettlementWindowForYearMonth } from '@/lib/settlement/settlement-window';
import { getContractDisplayStatus } from '@/lib/utils/contract-display-status';
import { isOrgDisplayHiddenMemberName } from '@/lib/organization/org-display-hidden';
import type { RankType } from '@/lib/types';

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
        <Link className="text-sm text-blue-600 underline mt-2 inline-block" href="/settlement">
          정산 현황으로
        </Link>
      </div>
    );
  }

  const db = createAdminSupabaseClient();
  const { start_date, end_date } = getSettlementWindowForYearMonth(yearMonth);
  const endExclusive = nextDay(end_date);

  const [memberRes, membersRes, edgesRes, contractRowsRes] = await Promise.all([
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
        'id, contract_code, join_date, status, unit_count, item_name, sales_member_id, customer_id, sales_link_status, is_cancelled, rental_request_no, invoice_no, memo, customers(name)',
      )
      .gte('join_date', start_date)
      .lt('join_date', endExclusive),
  ]);

  const member = memberRes.data as any;
  if (!member) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-600">멤버를 찾을 수 없습니다.</p>
        <Link className="text-sm text-blue-600 underline mt-2 inline-block" href={`/settlement?year_month=${yearMonth}`}>
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
        <Link className="text-sm text-blue-600 underline mt-2 inline-block" href={`/settlement?year_month=${yearMonth}`}>
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

  const isJoinEligible = (c: {
    status: string;
    rental_request_no: string | null;
    invoice_no: string | null;
  }): boolean => {
    if (String(c.status ?? '').trim() === '가입') return true;
    if (String(c.status ?? '').trim() === '해약') return false;
    const rr = String(c.rental_request_no ?? '').trim();
    const inv = String(c.invoice_no ?? '').trim();
    return rr !== '' && inv !== '';
  };

  const rows = ((contractRowsRes.data ?? []) as any[])
    // v_contract_settlement_base와 동일한 "가입 인정 기준"으로 필터
    .filter((c) => (c.is_cancelled ?? false) === false)
    .filter((c) => String(c.status ?? '').trim() !== '취소')
    .filter((c) => (c.sales_member_id ?? null) != null)
    .filter((c) => String(c.sales_link_status ?? 'linked') === 'linked')
    .filter((c) =>
      isJoinEligible({
        status: String(c.status ?? ''),
        rental_request_no: (c.rental_request_no ?? null) as string | null,
        invoice_no: (c.invoice_no ?? null) as string | null,
      }),
    )
    .map((c) => {
      const origin = attributedSalesMemberId({
        customer_id: (c.customer_id ?? null) as string | null,
        sales_member_id: c.sales_member_id as string,
      });
      const joinYmd = String(c.join_date ?? '').slice(0, 10);
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
        raw_sales_member_id: c.sales_member_id as string,
      };
    })
    .filter((x) => subtreeIds.has(x.origin))
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

  return (
    <div className="p-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="text-xs text-gray-500">
            <Link className="text-blue-600 hover:underline" href={`/settlement?year_month=${yearMonth}`}>
              정산 현황
            </Link>
            <span className="mx-1">/</span>
            <span>산하 내역</span>
          </div>
          <h2 className="text-2xl font-bold text-gray-800 mt-2">
            {displayName} · {yearMonth}
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            기준 {start_date}~{end_date} · 정산 대상(가입 인정) 계약 중, 조직 트리 기준 산하에 귀속된 계약만 표시합니다.
          </p>
          <p className="text-xs text-gray-400 mt-1">
            총 {groupedRows.length.toLocaleString()}행
            <span className="ml-1">({rows.length.toLocaleString()}건)</span>
          </p>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['계약코드', '고객명', '가입일', '물품명', '표시상태', '구좌', '귀속(산하)', '원 담당자'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {groupedRows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-10 text-center text-sm text-gray-500">
                    표시할 계약이 없습니다.
                  </td>
                </tr>
              )}
              {groupedRows.map((r) => (
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
                  <td className="px-4 py-3 tabular-nums text-right">{Number(r.unit_count ?? 0).toLocaleString()}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {(membersRaw.find((m: any) => m.id === r.origin)?.name ?? r.origin) as string}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {(membersRaw.find((m: any) => m.id === r.raw_sales_member_id)?.name ?? r.raw_sales_member_id) as string}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
