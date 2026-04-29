import type { Metadata } from 'next';
import PendingSalesClient from './PendingSalesClient';

export const metadata: Metadata = { title: '담당 미확인 큐' };
export const dynamic = 'force-dynamic';

export default function PendingSalesPage() {
  return (
    <div className="p-6 max-w-3xl">
      <h2 className="text-2xl font-bold text-gray-800 mb-1">담당 미확인 큐</h2>
      <p className="text-sm text-gray-500 mb-6">
        동명이인 또는 조직도에 없는 이름으로 유입된 계약만 표시됩니다. 한 번 연결하면 이후 동기화는 자동으로
        반영됩니다.
      </p>
      <PendingSalesClient />
    </div>
  );
}
