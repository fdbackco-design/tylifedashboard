import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { getContractDisplayStatus } from '@/lib/utils/contract-display-status';

export const metadata: Metadata = { title: '계약 상세' };
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ContractDetailPage({ params }: PageProps) {
  const { id } = await params;
  const db = createAdminSupabaseClient();

  const { data: contract, error } = await db
    .from('contracts')
    .select(
      `
      *,
      customers:customers!contracts_customer_id_fkey(id, name, birth_date, gender, ssn_masked, phone),
      sales_member:organization_members!contracts_sales_member_id_fkey(id, name, rank, phone)
      `,
    )
    .eq('id', id)
    .single();

  if (error || !contract) notFound();

  const customer = (contract as any).customers as unknown as {
    id: string; name: string; birth_date: string;
    gender: string; ssn_masked: string; phone: string;
  } | null;

  const member = (contract as any).sales_member as unknown as {
    id: string; name: string; rank: string; phone: string | null;
  } | null;

  // 상태 이력 조회
  const { data: histories } = await db
    .from('contract_status_histories')
    .select('*')
    .eq('contract_id', id)
    .order('changed_at', { ascending: false });

  const displayStatus = getContractDisplayStatus({
    status: contract.status as string,
    rental_request_no: contract.rental_request_no as string | null,
    invoice_no: contract.invoice_no as string | null,
    memo: contract.memo as string | null,
  });

  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/contracts" className="text-sm text-gray-500 hover:text-gray-700">
          ← 계약 목록
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-sm text-gray-700 font-medium">
          {contract.contract_code as string}
        </span>
      </div>

      <div className="space-y-5">
        {/* 고객 정보 */}
        <section className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">고객 정보</h3>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <DetailRow label="고객명" value={customer?.name ?? '-'} />
            <DetailRow label="주민번호" value={customer?.ssn_masked ?? '-'} />
            <DetailRow label="생년월일" value={customer?.birth_date ?? '-'} />
            <DetailRow label="성별" value={customer?.gender === 'M' ? '남' : customer?.gender === 'F' ? '여' : '-'} />
            <DetailRow
              label="전화번호"
              value={customer?.phone ?? '-'}
            />
            <DetailRow
              label="실 이용 지정인"
              value={(contract.beneficiary_name as string | null) ?? '-'}
            />
            <DetailRow
              label="계약자와의 관계"
              value={(contract.relationship_to_contractor as string | null) ?? '-'}
            />
          </dl>
        </section>

        {/* 계약 정보 */}
        <section className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">계약 정보</h3>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <DetailRow label="계약 코드" value={contract.contract_code as string} />
            <DetailRow label="가입일" value={contract.join_date as string} />
            <DetailRow label="상품명" value={contract.product_type as string} />
            <DetailRow label="물품명" value={contract.item_name as string} />
            <DetailRow label="워치/핏" value={contract.watch_fit as string} />
            <DetailRow label="가입 구좌 수" value={`${contract.unit_count as number}구좌`} />
            <DetailRow label="가입 방법" value={contract.join_method as string} />
            <DetailRow
              label="렌탈신청번호"
              value={(contract.rental_request_no as string | null) ?? '-'}
            />
            <DetailRow
              label="메모"
              value={(contract.memo as string | null) ?? '-'}
            />
          </dl>
        </section>

        {/* 진행 상태 */}
        <section className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">진행 상태</h3>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <DetailRow label="현재 상태" value={displayStatus} highlight />
            <DetailRow
              label="해피콜 일시"
              value={
                contract.happy_call_at
                  ? new Date(contract.happy_call_at as string).toLocaleString('ko-KR')
                  : '-'
              }
            />
            <DetailRow
              label="취소/반품"
              value={(contract.is_cancelled as boolean) ? '예 (정산 제외)' : '아니오'}
            />
          </dl>
        </section>

        {/* 담당 조직 · 실적 경로(수집 시점 스탬핑) */}
        <section className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">담당 조직 · 실적 레그</h3>
          {(contract as { sales_link_status?: string }).sales_link_status === 'pending_mapping' && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-3">
              담당자 미확인 — 실적·정산에 반영되지 않습니다. 원본명:{' '}
              <strong>{(contract as { raw_sales_member_name?: string | null }).raw_sales_member_name ?? '-'}</strong>
              <Link href="/pending-sales" className="ml-2 text-blue-600 underline">
                미확인 큐에서 연결
              </Link>
            </p>
          )}
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <DetailRow label="담당 사원" value={member?.name ?? '-'} />
            <DetailRow label="직급" value={member?.rank ?? '-'} />
            <DetailRow
              label="연락처"
              value={member?.phone ?? '-'}
            />
            <DetailRow
              label="수집 시점 상위 경로"
              value={formatPerformancePath(
                (contract as { performance_path_json?: unknown }).performance_path_json,
              )}
            />
          </dl>
        </section>

        {/* 상태 변경 이력 */}
        <section className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">상태 변경 이력</h3>
          {(histories ?? []).length === 0 ? (
            <p className="text-sm text-gray-400">이력 없음</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                  <th className="pb-2 pr-4">변경 일시</th>
                  <th className="pb-2 pr-4">이전 상태</th>
                  <th className="pb-2 pr-4">변경 상태</th>
                  <th className="pb-2">처리자</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {(histories ?? []).map((h) => (
                  <tr key={h.id as string}>
                    <td className="py-2 pr-4 text-gray-600">
                      {new Date(h.changed_at as string).toLocaleString('ko-KR')}
                    </td>
                    <td className="py-2 pr-4 text-gray-400">{(h.from_status as string | null) ?? '-'}</td>
                    <td className="py-2 pr-4 font-medium">{h.to_status as string}</td>
                    <td className="py-2 text-gray-500">{h.changed_by as string}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}

function formatPerformancePath(raw: unknown): string {
  if (!raw || !Array.isArray(raw)) return '-';
  const parts = raw.map((seg: { name?: string }) => seg?.name).filter(Boolean);
  return parts.length > 0 ? parts.join(' → ') : '-';
}

function DetailRow({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <>
      <dt className="text-gray-500">{label}</dt>
      <dd className={highlight ? 'font-semibold text-gray-900' : 'text-gray-800'}>
        {value}
      </dd>
    </>
  );
}
