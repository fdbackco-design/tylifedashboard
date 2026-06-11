import type { Metadata } from 'next';
import NewCodeClient from './NewCodeClient';

export const metadata: Metadata = { title: '영업자 코드 발급' };
export const dynamic = 'force-dynamic';

export default function AdminNewCodePage() {
  return (
    <div className="p-4 sm:p-6 max-w-7xl">
      <div className="mb-5">
        <h2 className="text-2xl font-bold text-slate-900">영업자 코드 발급</h2>
        <p className="mt-1 text-sm text-slate-500">
          영업자가 신청한 코드 발급 내역을 조회하고, 선택 항목을 구글 시트로 동기화합니다.
        </p>
      </div>
      <NewCodeClient />
    </div>
  );
}
