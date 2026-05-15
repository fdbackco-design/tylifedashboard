import type { Metadata } from 'next';
import NoticeFormClient from '../NoticeFormClient';

export const metadata: Metadata = { title: '공지 등록' };
export const dynamic = 'force-dynamic';

export default function AdminNoticeNewPage() {
  return (
    <div className="p-4 sm:p-6 max-w-4xl">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900">공지 등록</h2>
        <p className="text-sm text-slate-500 mt-1">새 공지를 작성하고 임시저장 또는 게시할 수 있습니다.</p>
      </div>
      <NoticeFormClient mode="create" />
    </div>
  );
}
