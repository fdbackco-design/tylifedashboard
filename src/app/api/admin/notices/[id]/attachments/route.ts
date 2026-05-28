import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { isAdminAuthed } from '@/lib/admin-auth';
import { NOTICE_STORAGE_BUCKET } from '@/lib/notices/constants';
import type { NoticeAttachmentRow } from '@/lib/notices/types';
import { isAllowedUploadMime, NOTICE_MAX_FILE_BYTES } from '@/lib/notices/validation';
import { isValidNoticeAttachmentStoragePath } from '@/lib/notices/storage';

type Ctx = { params: Promise<{ id: string }> };

type RegisterBody = {
  storage_path?: unknown;
  file_name?: unknown;
  file_size?: unknown;
  mime_type?: unknown;
};

/**
 * 첨부파일 메타데이터를 등록한다.
 *
 * 실제 파일 바이너리는 클라이언트가 사전 발급받은 signed URL을 통해 Supabase Storage에
 * 직접 업로드하고, 이 엔드포인트에는 메타데이터만 전송한다.
 * (Vercel Serverless의 ~4.5MB body 제한 우회)
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
  const fileName = String(body.file_name ?? '').trim();
  const fileSize = Number(body.file_size ?? 0);
  const mimeType = String(body.mime_type ?? '').trim() || 'application/octet-stream';

  if (!isValidNoticeAttachmentStoragePath(noticeId, storagePath)) {
    return NextResponse.json({ success: false, error: '잘못된 경로입니다.' }, { status: 400 });
  }
  if (!fileName) {
    return NextResponse.json({ success: false, error: '파일명이 필요합니다.' }, { status: 400 });
  }
  if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > NOTICE_MAX_FILE_BYTES) {
    return NextResponse.json({ success: false, error: '파일 크기가 유효하지 않습니다.' }, { status: 400 });
  }
  if (!isAllowedUploadMime(mimeType)) {
    return NextResponse.json(
      { success: false, error: 'PDF, 이미지, 문서 파일만 업로드할 수 있습니다.' },
      { status: 400 },
    );
  }

  // Storage에 실제 객체가 업로드되었는지 확인
  const folder = storagePath.includes('/') ? storagePath.slice(0, storagePath.lastIndexOf('/')) : '';
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
      { success: false, error: '업로드된 파일을 찾을 수 없습니다.' },
      { status: 400 },
    );
  }

  const { data, error } = await db
    .from('notice_attachments')
    .insert({
      notice_id: noticeId,
      storage_path: storagePath,
      file_name: fileName,
      file_size: fileSize,
      mime_type: mimeType,
    })
    .select('*')
    .single();

  if (error) {
    await db.storage.from(NOTICE_STORAGE_BUCKET).remove([storagePath]);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: data as NoticeAttachmentRow });
}
