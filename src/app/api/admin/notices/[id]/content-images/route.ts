import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { isAdminAuthed } from '@/lib/admin-auth';
import { NOTICE_STORAGE_BUCKET } from '@/lib/notices/constants';
import {
  isValidNoticeInlineStoragePath,
  noticeInlineMediaUrl,
} from '@/lib/notices/storage';

type Ctx = { params: Promise<{ id: string }> };

type RegisterBody = {
  storage_path?: unknown;
};

/**
 * 본문 인라인 이미지 등록.
 *
 * 클라이언트가 사전 발급받은 signed URL로 Supabase Storage에 이미지를 직접 업로드한 뒤,
 * 이 엔드포인트에는 storage_path만 전송한다. 응답으로 본문에 삽입할 미디어 URL을 돌려준다.
 */
export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { id: noticeId } = await ctx.params;
  const db = createAdminSupabaseClient();

  const { data: notice } = await db.from('notices').select('id').eq('id', noticeId).maybeSingle();
  if (!notice) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

  const body = (await req.json().catch(() => null)) as RegisterBody | null;
  if (!body) {
    return NextResponse.json({ success: false, error: '잘못된 요청입니다.' }, { status: 400 });
  }

  const storagePath = String(body.storage_path ?? '').trim();
  if (!isValidNoticeInlineStoragePath(noticeId, storagePath)) {
    return NextResponse.json({ success: false, error: '잘못된 경로입니다.' }, { status: 400 });
  }

  const folder = storagePath.slice(0, storagePath.lastIndexOf('/'));
  const objectName = storagePath.slice(folder.length + 1);
  const { data: listed, error: listErr } = await db.storage
    .from(NOTICE_STORAGE_BUCKET)
    .list(folder, { limit: 1000, search: objectName });
  if (listErr) {
    return NextResponse.json({ success: false, error: listErr.message }, { status: 500 });
  }
  const exists = (listed ?? []).some((f) => f.name === objectName);
  if (!exists) {
    return NextResponse.json(
      { success: false, error: '업로드된 이미지를 찾을 수 없습니다.' },
      { status: 400 },
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      storage_path: storagePath,
      url: noticeInlineMediaUrl(noticeId, storagePath),
    },
  });
}
