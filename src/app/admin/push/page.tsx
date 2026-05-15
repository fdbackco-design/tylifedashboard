import type { Metadata } from 'next';
import AdminPushClient from './AdminPushClient';

export const metadata: Metadata = { title: '푸시 발송' };
export const dynamic = 'force-dynamic';

export default function AdminPushPage() {
  return (
    <div className="p-4 sm:p-6 max-w-3xl">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900">푸시 알림 발송</h2>
        <p className="text-sm text-slate-500 mt-1">
          Web Push(VAPID)로 PWA·TWA 앱 구독자에게 알림을 보냅니다. 네이티브 FCM이 아닙니다.
        </p>
      </div>
      <AdminPushClient />
    </div>
  );
}
