import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { isAdminAuthed } from '@/lib/admin-auth';
import { NOTICE_STORAGE_BUCKET } from '@/lib/notices/constants';
import type { NoticeAttachmentRow } from '@/lib/notices/types';
import { isAllowedUploadMime, NOTICE_MAX_FILE_BYTES } from '@/lib/notices/validation';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { id: noticeId } = await ctx.params;
  const db = createAdminSupabaseClient();

  const { data: notice } = await db.from('notices').select('id').eq('id', noticeId).maybeSingle();
  if (!notice) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

  const form = await req.formData();
  const file = form.get('file');
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ success: false, error: '파일이 없습니다.' }, { status: 400 });
  }

  if (file.size > NOTICE_MAX_FILE_BYTES) {
    return NextResponse.json(
      { success: false, error: '파일 크기는 10MB 이하여야 합니다.' },
      { status: 400 },
    );
  }

  const mime = file.type || 'application/octet-stream';
  if (!isAllowedUploadMime(mime)) {
    return NextResponse.json(
      { success: false, error: 'PDF, 이미지, 문서 파일만 업로드할 수 있습니다.' },
      { status: 400 },
    );
  }

  const safeName = file.name.replace(/[^\w.\-가-힣]/g, '_').slice(0, 180);
  const storagePath = `${noticeId}/${Date.now()}_${safeName}`;
  const buf = Buffer.from(await file.arrayBuffer());

  const { error: upErr } = await db.storage.from(NOTICE_STORAGE_BUCKET).upload(storagePath, buf, {
    contentType: mime,
    upsert: false,
  });
  if (upErr) {
    return NextResponse.json({ success: false, error: upErr.message }, { status: 500 });
  }

  const { data, error } = await db
    .from('notice_attachments')
    .insert({
      notice_id: noticeId,
      storage_path: storagePath,
      file_name: file.name,
      file_size: file.size,
      mime_type: mime,
    })
    .select('*')
    .single();

  if (error) {
    await db.storage.from(NOTICE_STORAGE_BUCKET).remove([storagePath]);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: data as NoticeAttachmentRow });
}
