import type { Metadata } from 'next';
import ManagerChangeAdminClient from './ManagerChangeAdminClient';

export const metadata: Metadata = { title: '담당자 변경 신청' };
export const dynamic = 'force-dynamic';

export default function AdminManagerChangePage() {
  return (
    <div className="p-4 sm:p-6 max-w-7xl">
      <div className="mb-5">
        <h2 className="text-2xl font-bold text-slate-900">담당자 변경 신청</h2>
        <p className="mt-1 text-sm text-slate-500">
          영업자가 신청한 담당자 변경 내역을 확인하고 완료 처리합니다.
        </p>
      </div>
      <ManagerChangeAdminClient />
    </div>
  );
}
