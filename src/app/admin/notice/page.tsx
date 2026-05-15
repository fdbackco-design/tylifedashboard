import type { Metadata } from 'next';
import NoticeManagementClient from './NoticeManagementClient';

export const metadata: Metadata = { title: '공지사항' };
export const dynamic = 'force-dynamic';

export default function AdminNoticePage() {
  return (
    <div className="p-4 sm:p-6 max-w-6xl">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900">공지사항</h2>
        <p className="text-sm text-slate-500 mt-1">영업자 앱에 노출되는 공지를 등록·수정·게시합니다.</p>
      </div>
      <NoticeManagementClient />
    </div>
  );
}
