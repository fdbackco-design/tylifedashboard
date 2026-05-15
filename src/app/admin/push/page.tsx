import type { Metadata } from 'next';
import AdminPushClient from './AdminPushClient';

export const metadata: Metadata = { title: '푸시 발송' };
export const dynamic = 'force-dynamic';

export default function AdminPushPage() {
  return (
    <div className="p-4 sm:p-6 max-w-3xl">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900">푸시 알림 발송</h2>
      </div>
      <AdminPushClient />
    </div>
  );
}
