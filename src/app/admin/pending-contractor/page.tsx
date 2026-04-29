import type { Metadata } from 'next';
import PendingContractorClient from './PendingContractorClient';

export const metadata: Metadata = { title: '편입 매핑 대기' };
export const dynamic = 'force-dynamic';

export default function PendingContractorPage() {
  return (
    <div className="p-6">
      <div className="mb-5">
        <h2 className="text-2xl font-bold text-gray-800">편입 매핑 대기</h2>
        <p className="text-sm text-gray-500 mt-1">
          계약자(내부 영업사원 후보)가 동명이인이거나 식별이 불가능해 자동 편입이 보류된 계약들입니다.
        </p>
      </div>
      <PendingContractorClient />
    </div>
  );
}

