import type { Metadata } from 'next';
import NoticeFormClient from '../../NoticeFormClient';

export const metadata: Metadata = { title: '공지 수정' };
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

export default async function AdminNoticeEditPage(props: Props) {
  const { id } = await props.params;
  return (
    <div className="p-4 sm:p-6 max-w-4xl">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900">공지 수정</h2>
        <p className="text-sm text-slate-500 mt-1">공지 내용과 게시 설정을 변경합니다.</p>
      </div>
      <NoticeFormClient mode="edit" noticeId={id} />
    </div>
  );
}
