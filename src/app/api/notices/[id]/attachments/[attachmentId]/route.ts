import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { isOrganizationViewerAuthed } from '@/lib/notices/member-auth';
import { NOTICE_STORAGE_BUCKET } from '@/lib/notices/constants';
import { fetchPublishedNoticesForMember } from '@/lib/notices/public-queries';

type Ctx = { params: Promise<{ id: string; attachmentId: string }> };

export async function GET(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  // 공지 첨부 다운로드는 member_id 가 없는 사전 발급(PENDING) 계정도 허용한다.
  if (!(await isOrganizationViewerAuthed(req))) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { id: noticeId, attachmentId } = await ctx.params;
  const db = createAdminSupabaseClient();

  const published = await fetchPublishedNoticesForMember(db);
  if (!published.some((n) => n.id === noticeId)) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }

  const { data: row } = await db
    .from('notice_attachments')
    .select('storage_path,file_name,mime_type')
    .eq('id', attachmentId)
    .eq('notice_id', noticeId)
    .maybeSingle();

  if (!row) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

  const storagePath = String((row as { storage_path: string }).storage_path);
  if (!storagePath.startsWith(`${noticeId}/`) || storagePath.includes('..')) {
    return NextResponse.json({ success: false, error: 'Invalid path' }, { status: 400 });
  }

  const { data, error } = await db.storage.from(NOTICE_STORAGE_BUCKET).download(storagePath);
  if (error || !data) {
    return NextResponse.json({ success: false, error: error?.message ?? 'Not found' }, { status: 404 });
  }

  const buf = Buffer.from(await data.arrayBuffer());
  const fileName = String((row as { file_name: string }).file_name);
  const mime = String((row as { mime_type: string | null }).mime_type ?? 'application/octet-stream');

  return new NextResponse(buf, {
    headers: {
      'Content-Type': mime,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Cache-Control': 'private, max-age=300',
    },
  });
}
