import type { Metadata } from 'next';
import Link from 'next/link';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import type { ContractStatus } from '@/lib/types';
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
      item_name,
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
    const like = `%${q}%`;
    query = query.or(
      [
        `customers.name.ilike.${like}`,
        `sales_member.name.ilike.${like}`,
        `raw_sales_member_name.ilike.${like}`,
      ].join(','),
    );
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
    item_name: string | null;
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

    // 상태 우선순위(같은 고객/가입일에 여러 상태가 섞이면 “가장 진행된” 상태 표시)
    const statusRank: Record<ContractStatus, number> = {
      준비: 1,
      대기: 2,
      상담중: 3,
      가입: 4,
      해피콜완료: 5,
      배송준비: 6,
      배송완료: 7,
      정산완료: 8,
      취소: 0,
      해약: 0,
    };

    for (const c of rows) {
      const customer = (c as { customers?: { name?: string } | null }).customers;
      const customerName = customer?.name ?? '-';
      const joinDate = (c as { join_date?: string }).join_date ?? '';
      const key = `${customerName}__${joinDate}`;

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
          item_name: ((c as { item_name?: string | null }).item_name ?? null) as string | null,
          rental_request_no: ((c as { rental_request_no?: string | null }).rental_request_no ?? null) as
            | string
            | null,
          invoice_no: ((c as { invoice_no?: string | null }).invoice_no ?? null) as string | null,
          memo: ((c as { memo?: string | null }).memo ?? null) as string | null,
          unit_count: ((c as { unit_count?: number }).unit_count ?? 0) as number,
          join_method: (c as { join_method: string }).join_method,
          status: getContractDisplayStatus({
            status: (c as { status: ContractStatus }).status,
            rental_request_no: ((c as { rental_request_no?: string | null }).rental_request_no ?? null) as
              | string
              | null,
            invoice_no: ((c as { invoice_no?: string | null }).invoice_no ?? null) as string | null,
            memo: ((c as { memo?: string | null }).memo ?? null) as string | null,
          }) as ContractStatus,
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

      const s = getContractDisplayStatus({
        status: (c as { status: ContractStatus }).status,
        rental_request_no: ((c as { rental_request_no?: string | null }).rental_request_no ?? null) as
          | string
          | null,
        invoice_no: ((c as { invoice_no?: string | null }).invoice_no ?? null) as string | null,
        memo: ((c as { memo?: string | null }).memo ?? null) as string | null,
      }) as ContractStatus;
      if ((statusRank[s] ?? 0) > (statusRank[existing.status] ?? 0)) {
        existing.status = s;
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
      </div>

      {/* 검색 */}
      <form className="mb-4 flex gap-2 flex-wrap" action="/contracts" method="GET">
        {statusFilter && <input type="hidden" name="status" value={statusFilter} />}
        {yearMonth && <input type="hidden" name="year_month" value={yearMonth} />}
        <input
          name="q"
          defaultValue={q}
          placeholder="고객명 또는 담당사원 검색"
          className="w-full sm:w-96 px-3 py-2 text-sm border border-gray-300 rounded-md bg-white"
        />
        <button
          type="submit"
          className="px-3 py-2 text-sm rounded-md border border-slate-800 bg-slate-800 text-white hover:bg-slate-700"
        >
          검색
        </button>
        {q && (
          <Link
            href={`/contracts${querySuffix({ q: undefined, page: '1' })}`}
            className="px-3 py-2 text-sm rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
          >
            초기화
          </Link>
        )}
      </form>

      {/* 필터 (TODO: 클라이언트 필터 컴포넌트로 분리) */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <Link
          href={`/contracts${querySuffix({ status: null, page: '1' })}`}
          className={`px-3 py-1.5 rounded text-sm border ${!statusFilter ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'}`}
        >
          전체
        </Link>
        {STATUS_FILTER_OPTIONS.map((s) => (
          <Link
            key={s}
            href={`/contracts${querySuffix({ status: s, page: '1' })}`}
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
                  '소속',
                  '담당사원',
                  '물품명',
                  '구좌수',
                  '가입방법',
                  '상태',
                  '취소반품',
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
                  <td colSpan={10} className="px-4 py-8 text-center text-gray-400">
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
                      <Link
                        href={`/contracts/${c.id}`}
                        className="text-blue-600 hover:underline"
                      >
                        {customer?.name ?? '-'}
                      </Link>
                      {c.contract_count > 1 && (
                        <span className="ml-2 text-xs text-gray-400">
                          ({c.contract_count}건)
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                      {c.affiliation_name ?? '-'}
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
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                      {c.item_name ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">
                      {c.unit_count.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                      {c.join_method}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
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
                    <td className="px-4 py-3 text-center">
                      {c.is_cancelled ? (
                        <span className="text-red-600 font-bold">Y</span>
                      ) : (
                        <span className="text-gray-300">-</span>
                      )}
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
                  href={`/contracts${querySuffix({ page: String(page - 1) })}`}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
                >
                  이전
                </Link>
              )}
              {page < totalPages && (
                <Link
                  href={`/contracts${querySuffix({ page: String(page + 1) })}`}
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
