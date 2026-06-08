import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { isAdminAuthed } from '@/lib/admin-auth';
import { isOrganizationViewerAuthed } from '@/lib/notices/member-auth';
import { NOTICE_STORAGE_BUCKET } from '@/lib/notices/constants';
import { isValidNoticeInlineStoragePath } from '@/lib/notices/storage';
import { fetchPublishedNoticesForMember } from '@/lib/notices/public-queries';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const isAdmin = await isAdminAuthed(req);
  // 공지사항 인라인 이미지는 member_id 가 없는 사전 발급(PENDING) 계정도 볼 수 있어야 한다.
  const isMember = isAdmin ? true : await isOrganizationViewerAuthed(req);
  if (!isAdmin && !isMember) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { id: noticeId } = await ctx.params;
  const storagePath = req.nextUrl.searchParams.get('path') ?? '';
  if (!isValidNoticeInlineStoragePath(noticeId, storagePath)) {
    return NextResponse.json({ success: false, error: 'Invalid path' }, { status: 400 });
  }

  const db = createAdminSupabaseClient();

  // 영업자는 게시된 공지에 한해서만 인라인 이미지 조회를 허용한다.
  if (!isAdmin) {
    const published = await fetchPublishedNoticesForMember(db);
    if (!published.some((n) => n.id === noticeId)) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }
  }

  const { data, error } = await db.storage.from(NOTICE_STORAGE_BUCKET).download(storagePath);
  if (error || !data) {
    return NextResponse.json({ success: false, error: error?.message ?? 'Not found' }, { status: 404 });
  }

  const buf = Buffer.from(await data.arrayBuffer());
  const ext = storagePath.split('.').pop()?.toLowerCase();
  const type =
    ext === 'png'
      ? 'image/png'
      : ext === 'webp'
        ? 'image/webp'
        : ext === 'gif'
          ? 'image/gif'
          : 'image/jpeg';

  return new NextResponse(buf, {
    headers: {
      'Content-Type': type,
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
