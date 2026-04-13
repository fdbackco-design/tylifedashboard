import type { Metadata } from 'next';
import Link from 'next/link';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import type { ContractStatus } from '@/lib/types';

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
  가입: 'bg-indigo-100 text-indigo-700',
  해피콜완료: 'bg-cyan-100 text-cyan-700',
  배송준비: 'bg-purple-100 text-purple-700',
  배송완료: 'bg-teal-100 text-teal-700',
  정산완료: 'bg-green-100 text-green-700',
  취소: 'bg-red-100 text-red-700',
  해약: 'bg-red-200 text-red-800',
};

const PAGE_SIZE = 50;

interface PageProps {
  searchParams: Promise<{
    page?: string;
    status?: string;
    year_month?: string;
  }>;
}

export default async function ContractsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page ?? '1', 10));
  const statusFilter = params.status as ContractStatus | undefined;
  const yearMonth = params.year_month;

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
      watch_fit,
      unit_count,
      status,
      is_cancelled,
      customers(name),
      organization_members(name)
      `,
      { count: 'exact' },
    )
    .order('sequence_no', { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (statusFilter) query = query.eq('status', statusFilter);
  if (yearMonth) {
    const nextMonth =
      yearMonth.endsWith('-12')
        ? `${parseInt(yearMonth.slice(0, 4)) + 1}-01`
        : `${yearMonth.slice(0, 4)}-${String(parseInt(yearMonth.slice(5)) + 1).padStart(2, '0')}`;
    query = query.gte('join_date', `${yearMonth}-01`).lt('join_date', `${nextMonth}-01`);
  }

  const { data: contracts, count } = await query;
  const totalPages = Math.ceil((count ?? 0) / PAGE_SIZE);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">계약 관리</h2>
          <p className="text-sm text-gray-500 mt-0.5">총 {(count ?? 0).toLocaleString()}건</p>
        </div>
      </div>

      {/* 필터 (TODO: 클라이언트 필터 컴포넌트로 분리) */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <Link
          href="/contracts"
          className={`px-3 py-1.5 rounded text-sm border ${!statusFilter ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'}`}
        >
          전체
        </Link>
        {(Object.keys(STATUS_LABELS) as ContractStatus[]).map((s) => (
          <Link
            key={s}
            href={`/contracts?status=${s}`}
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
                  '상품명',
                  '워치/핏',
                  '구좌수',
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
              {(contracts ?? []).length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-gray-400">
                    계약 데이터가 없습니다.
                  </td>
                </tr>
              )}
              {(contracts ?? []).map((c) => {
                const customer = c.customers as { name: string } | null;
                const member = c.organization_members as { name: string } | null;
                const status = c.status as ContractStatus;

                return (
                  <tr
                    key={c.id as string}
                    className="hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-4 py-3 text-gray-500 tabular-nums">
                      {c.sequence_no as number}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {c.join_date as string}
                    </td>
                    <td className="px-4 py-3 font-medium">
                      <Link
                        href={`/contracts/${c.id}`}
                        className="text-blue-600 hover:underline"
                      >
                        {customer?.name ?? '-'}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-600">-</td>
                    <td className="px-4 py-3 text-gray-700">
                      {member?.name ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                      {c.product_type as string}
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                      {c.watch_fit as string}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">
                      {(c.unit_count as number).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[status] ?? ''}`}
                      >
                        {STATUS_LABELS[status] ?? status}
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
                  href={`/contracts?page=${page - 1}${statusFilter ? `&status=${statusFilter}` : ''}`}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
                >
                  이전
                </Link>
              )}
              {page < totalPages && (
                <Link
                  href={`/contracts?page=${page + 1}${statusFilter ? `&status=${statusFilter}` : ''}`}
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
