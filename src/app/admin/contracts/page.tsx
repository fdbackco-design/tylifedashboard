import type { Metadata } from 'next';
import Link from 'next/link';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import type { ContractStatus } from '@/lib/types';
import { getContractDisplayProductName } from '@/lib/utils/contract-display-product';
import { getContractDisplayStatus } from '@/lib/utils/contract-display-status';

export const metadata: Metadata = { title: '계약 관리' };
export const dynamic = 'force-dynamic';

const STATUS_LABELS: Record<ContractStatus, string> = {
  준비: '준비',
  대기: '대기',
  상담중: '상담중',
  가입: '가입',
  해피콜완료: '해피콜완료',
  배송준비: '배송준비',
  배송완료: '배송완료',
  정산완료: '정산완료',
  취소: '취소',
  해약: '해약',
};

const STATUS_COLORS: Record<ContractStatus, string> = {
  준비: 'bg-gray-100 text-gray-700',
  대기: 'bg-yellow-100 text-yellow-700',
  상담중: 'bg-blue-100 text-blue-700',
  가입: 'bg-green-100 text-green-700',
  해피콜완료: 'bg-cyan-100 text-cyan-700',
  배송준비: 'bg-purple-100 text-purple-700',
  배송완료: 'bg-teal-100 text-teal-700',
  정산완료: 'bg-green-100 text-green-700',
  취소: 'bg-red-100 text-red-700',
  해약: 'bg-red-200 text-red-800',
};

/** 목록 상단 상태 필터에 노출할 값만 (나머지는 URL/직접 조회는 가능) */
const STATUS_FILTER_OPTIONS = ['준비', '대기', '가입', '해약'] as const satisfies readonly ContractStatus[];

const PAGE_SIZE = 50;

interface PageProps {
  searchParams: Promise<{
    page?: string;
    status?: string;
    year_month?: string;
    q?: string;
  }>;
}

export default async function ContractsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page ?? '1', 10));
  const statusFilter = params.status as ContractStatus | undefined;
  const yearMonth = params.year_month;
  const q = (params.q ?? '').trim();

  const db = createAdminSupabaseClient();

  let query = db
    .from('contracts')
    .select(
      `
      id,
      sequence_no,
      contract_code,
      join_date,
      product_type,
      item_name,
      source_snapshot_json,
      rental_request_no,
      invoice_no,
      memo,
      unit_count,
      join_method,
      status,
      is_cancelled,
      affiliation_name,
      sales_link_status,
      raw_sales_member_name,
      customers(name),
      sales_member:organization_members!contracts_sales_member_id_fkey(name)
      `,
      // exact count는 느릴 수 있어, 목록 UX용으로 estimated 사용
      { count: 'estimated' },
    )
    .order('sequence_no', { ascending: false, nullsFirst: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (statusFilter) query = query.eq('status', statusFilter);
  if (yearMonth) {
    const nextMonth =
      yearMonth.endsWith('-12')
        ? `${parseInt(yearMonth.slice(0, 4)) + 1}-01`
        : `${yearMonth.slice(0, 4)}-${String(parseInt(yearMonth.slice(5)) + 1).padStart(2, '0')}`;
    query = query.gte('join_date', `${yearMonth}-01`).lt('join_date', `${nextMonth}-01`);
  }
  if (q) {
    // 고객명/담당자명(확정)/미확인 담당자명까지 통합 검색
    // Supabase의 join 컬럼 필터는 형태에 따라 동작이 불안정할 수 있어,
    // (customers / organization_members)에서 id 후보를 먼저 구한 뒤 contracts에서 in/or로 필터링한다.
    const like = `%${q}%`;
    const [customerIdsRes, memberIdsRes] = await Promise.all([
      db.from('customers').select('id').ilike('name', like).limit(500),
      db.from('organization_members').select('id').ilike('name', like).limit(500),
    ]);

    const customerIds = (customerIdsRes.data ?? []).map((r: any) => r.id as string);
    const memberIds = (memberIdsRes.data ?? []).map((r: any) => r.id as string);

    const orParts: string[] = [`raw_sales_member_name.ilike.${like}`];
    if (customerIds.length > 0) orParts.push(`customer_id.in.(${customerIds.join(',')})`);
    if (memberIds.length > 0) orParts.push(`sales_member_id.in.(${memberIds.join(',')})`);

    query = query.or(orParts.join(','));
  }

  const { data: contracts, count } = await query;
  const totalPages = Math.ceil((count ?? 0) / PAGE_SIZE);

  type Row = NonNullable<typeof contracts>[number];
  type AggregatedRow = {
    key: string;
    /** 대표 계약 id (상세 링크용) */
    id: string;
    sequence_no: number | null;
    join_date: string;
    affiliation_name: string | null;
    product_type: string | null;
    item_name: string | null;
    source_snapshot_json: Record<string, string | null> | null;
    unit_count: number;
    join_method: string;
    status: ContractStatus;
    rental_request_no?: string | null;
    invoice_no?: string | null;
    memo?: string | null;
    is_cancelled: boolean;
    sales_link_status?: string;
    raw_sales_member_name?: string | null;
    customers: unknown;
    sales_member: unknown;
    /** 묶인 계약 수 */
    contract_count: number;
  };

  const aggregated: AggregatedRow[] = (() => {
    const rows = (contracts ?? []) as Row[];
    const map = new Map<string, AggregatedRow>();

    const salesMemberKey = (c: Row): string => {
      if ((c as { sales_link_status?: string }).sales_link_status === 'pending_mapping') {
        return `pending:${(c as { raw_sales_member_name?: string | null }).raw_sales_member_name ?? ''}`;
      }
      const member = (c as { sales_member?: { name?: string } | null }).sales_member;
      return member?.name ?? '-';
    };

    const displayStatusOf = (c: Row): string =>
      getContractDisplayStatus({
        status: (c as { status: ContractStatus }).status,
        rental_request_no: ((c as { rental_request_no?: string | null }).rental_request_no ?? null) as
          | string
          | null,
        invoice_no: ((c as { invoice_no?: string | null }).invoice_no ?? null) as string | null,
        memo: ((c as { memo?: string | null }).memo ?? null) as string | null,
        product_type: ((c as { product_type?: string | null }).product_type ?? null) as string | null,
        item_name: ((c as { item_name?: string | null }).item_name ?? null) as string | null,
        source_snapshot_json: ((c as { source_snapshot_json?: Record<string, string | null> | null })
          .source_snapshot_json ?? null) as Record<string, string | null> | null,
      });

    const snapshotOf = (c: Row): Record<string, string | null> | null =>
      ((c as { source_snapshot_json?: Record<string, string | null> | null }).source_snapshot_json ??
        null) as Record<string, string | null> | null;

    for (const c of rows) {
      const customer = (c as { customers?: { name?: string } | null }).customers;
      const customerName = customer?.name ?? '-';
      const joinDate = (c as { join_date?: string }).join_date ?? '';
      const displayStatus = displayStatusOf(c);
      const key = `${customerName}__${joinDate}__${salesMemberKey(c)}__${displayStatus}`;

      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          key,
          id: (c as { id: string }).id,
          sequence_no: ((c as { sequence_no?: number | null }).sequence_no ?? null) as number | null,
          join_date: joinDate,
          affiliation_name: ((c as { affiliation_name?: string | null }).affiliation_name ?? null) as
            | string
            | null,
          product_type: ((c as { product_type?: string | null }).product_type ?? null) as string | null,
          item_name: ((c as { item_name?: string | null }).item_name ?? null) as string | null,
          source_snapshot_json: snapshotOf(c),
          rental_request_no: ((c as { rental_request_no?: string | null }).rental_request_no ?? null) as
            | string
            | null,
          invoice_no: ((c as { invoice_no?: string | null }).invoice_no ?? null) as string | null,
          memo: ((c as { memo?: string | null }).memo ?? null) as string | null,
          unit_count: ((c as { unit_count?: number }).unit_count ?? 0) as number,
          join_method: (c as { join_method: string }).join_method,
          status: displayStatus as ContractStatus,
          is_cancelled: (c as { is_cancelled: boolean }).is_cancelled,
          sales_link_status: (c as { sales_link_status?: string }).sales_link_status,
          raw_sales_member_name: (c as { raw_sales_member_name?: string | null }).raw_sales_member_name,
          customers: (c as { customers: unknown }).customers,
          sales_member: (c as { sales_member: unknown }).sales_member,
          contract_count: 1,
        });
        continue;
      }

      existing.contract_count += 1;
      existing.unit_count += ((c as { unit_count?: number }).unit_count ?? 0) as number;
      if (!existing.item_name) {
        existing.item_name = ((c as { item_name?: string | null }).item_name ?? null) as string | null;
      }
      if (!existing.product_type || existing.product_type === '일반') {
        const nextType = ((c as { product_type?: string | null }).product_type ?? null) as string | null;
        if (nextType && nextType !== '일반') {
          existing.product_type = nextType;
        }
      }
      if (!existing.source_snapshot_json?.['상품명']) {
        const snap = snapshotOf(c);
        if (snap?.['상품명']) {
          existing.source_snapshot_json = snap;
        }
      }
      if (!existing.rental_request_no) {
        existing.rental_request_no = ((c as { rental_request_no?: string | null }).rental_request_no ?? null) as
          | string
          | null;
      }
      if (!existing.invoice_no) {
        existing.invoice_no = ((c as { invoice_no?: string | null }).invoice_no ?? null) as string | null;
      }
      if (!existing.memo) {
        existing.memo = ((c as { memo?: string | null }).memo ?? null) as string | null;
      }
    }

    return [...map.values()];
  })();

  const querySuffix = (overrides: Record<string, string | null | undefined>) => {
    const sp = new URLSearchParams();
    const next = {
      page: overrides.page ?? String(page),
      status:
        overrides.status === null
          ? undefined
          : (overrides.status ?? (statusFilter ? String(statusFilter) : undefined)),
      year_month: overrides.year_month ?? yearMonth ?? undefined,
      q: overrides.q ?? (q || undefined),
    } as const;
    for (const [k, v] of Object.entries(next)) {
      if (v) sp.set(k, v);
    }
    const s = sp.toString();
    return s ? `?${s}` : '';
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">계약 관리</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            총 {(count ?? 0).toLocaleString()}건 · 현재 페이지 표시 {aggregated.length.toLocaleString()}건
          </p>
        </div>
        <div className="shrink-0">
          <a
            href="/api/admin/contracts/export"
            className="inline-flex items-center px-3 py-2 text-sm rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
          >
            엑셀 다운로드
          </a>
        </div>
      </div>

      {/* 검색 */}
      <form className="mb-4 space-y-2" action="/admin/contracts" method="GET">
        {statusFilter && <input type="hidden" name="status" value={statusFilter} />}
        {yearMonth && <input type="hidden" name="year_month" value={yearMonth} />}
        <div className="flex items-center gap-2">
          <input
            name="q"
            defaultValue={q}
            placeholder="고객명 또는 담당사원 검색"
            className="w-0 min-w-[9rem] flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md bg-white sm:w-96 sm:min-w-0 sm:flex-none sm:max-w-md"
          />
          <button
            type="submit"
            className="shrink-0 whitespace-nowrap px-3 py-2 text-sm rounded-md border border-slate-800 bg-slate-800 text-white hover:bg-slate-700"
          >
            검색
          </button>
        </div>
        {q && (
          <Link
            href={`/admin/contracts${querySuffix({ q: undefined, page: '1' })}`}
            className="inline-flex shrink-0 whitespace-nowrap px-3 py-2 text-sm rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
          >
            초기화
          </Link>
        )}
      </form>

      {/* 필터 (TODO: 클라이언트 필터 컴포넌트로 분리) */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <Link
          href={`/admin/contracts${querySuffix({ status: null, page: '1' })}`}
          className={`px-3 py-1.5 rounded text-sm border ${!statusFilter ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'}`}
        >
          전체
        </Link>
        {STATUS_FILTER_OPTIONS.map((s) => (
          <Link
            key={s}
            href={`/admin/contracts${querySuffix({ status: s, page: '1' })}`}
            className={`px-3 py-1.5 rounded text-sm border ${statusFilter === s ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'}`}
          >
            {STATUS_LABELS[s]}
          </Link>
        ))}
      </div>

      {/* 계약 테이블 */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {[
                  '순번',
                  '가입일',
                  '고객명',
                  '담당사원',
                  '상품명',
                  '물품명',
                  '구좌수',
                  '가입방법',
                  '상태',
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
              {aggregated.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-gray-400">
                    계약 데이터가 없습니다.
                  </td>
                </tr>
              )}
              {aggregated.map((c) => {
                const customer = c.customers as { name: string } | null;
                const member = c.sales_member as { name: string } | null;
                const displayStatus = getContractDisplayStatus(c);

                return (
                  <tr
                    key={c.key}
                    className="hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-4 py-3 text-gray-500 tabular-nums">
                      {c.sequence_no ?? '-'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {c.join_date}
                    </td>
                    <td className="px-4 py-3 font-medium">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <Link
                          href={`/admin/contracts/${c.id}`}
                          className="text-blue-600 hover:underline break-keep"
                        >
                          {customer?.name ?? '-'}
                        </Link>
                        {c.contract_count > 1 && (
                          <span className="text-xs text-gray-400 whitespace-nowrap">
                            ({c.contract_count}건)
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {(c as { sales_link_status?: string }).sales_link_status ===
                      'pending_mapping' ? (
                        <span className="text-amber-700">
                          {c.raw_sales_member_name ?? '-'}{' '}
                          <span className="text-xs font-normal">(미확인)</span>
                        </span>
                      ) : (
                        (member?.name ?? '-')
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                      {getContractDisplayProductName({
                        product_type: c.product_type,
                        item_name: c.item_name,
                        source_snapshot_json: c.source_snapshot_json,
                      })}
                    </td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                      {c.item_name ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">
                      {c.unit_count.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                      {c.join_method}
                    </td>
                    <td className="min-w-[7rem] whitespace-nowrap px-4 py-3">
                      <span
                        className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${
                          displayStatus === '렌탈 미충족'
                            ? 'bg-orange-100 text-orange-800'
                            : (STATUS_COLORS[displayStatus as ContractStatus] ?? '')
                        }`}
                      >
                        {displayStatus === '렌탈 미충족'
                          ? '렌탈 미충족'
                          : (STATUS_LABELS[displayStatus as ContractStatus] ?? displayStatus)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 페이지네이션 */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
            <p className="text-sm text-gray-500">
              {page} / {totalPages} 페이지
            </p>
            <div className="flex gap-2">
              {page > 1 && (
                <Link
                  href={`/admin/contracts${querySuffix({ page: String(page - 1) })}`}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
                >
                  이전
                </Link>
              )}
              {page < totalPages && (
                <Link
                  href={`/admin/contracts${querySuffix({ page: String(page + 1) })}`}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
                >
                  다음
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
