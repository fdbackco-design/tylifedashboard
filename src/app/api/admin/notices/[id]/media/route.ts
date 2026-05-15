import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { isAdminAuthed } from '@/lib/admin-auth';
import { NOTICE_STORAGE_BUCKET } from '@/lib/notices/constants';
import { isValidNoticeInlineStoragePath } from '@/lib/notices/storage';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { id: noticeId } = await ctx.params;
  const storagePath = req.nextUrl.searchParams.get('path') ?? '';
  if (!isValidNoticeInlineStoragePath(noticeId, storagePath)) {
    return NextResponse.json({ success: false, error: 'Invalid path' }, { status: 400 });
  }

  const db = createAdminSupabaseClient();
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
