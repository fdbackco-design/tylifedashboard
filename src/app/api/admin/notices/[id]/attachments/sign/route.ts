import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { isAdminAuthed } from '@/lib/admin-auth';
import { NOTICE_STORAGE_BUCKET } from '@/lib/notices/constants';
import {
  isAllowedInlineImageMime,
  isAllowedUploadMime,
  NOTICE_MAX_FILE_BYTES,
} from '@/lib/notices/validation';
import {
  noticeAttachmentStoragePath,
  noticeInlineStoragePath,
} from '@/lib/notices/storage';

type Ctx = { params: Promise<{ id: string }> };

type SignBody = {
  file_name?: unknown;
  file_size?: unknown;
  mime_type?: unknown;
  /** 'attachment' (기본) 또는 'inline' (본문 이미지) */
  kind?: unknown;
};

/**
 * 첨부파일/본문 이미지 업로드용 Supabase Storage signed URL을 발급한다.
 * - Vercel Serverless의 4.5MB body 제한을 우회하기 위해 클라이언트가 Supabase에 직접 업로드한다.
 * - 발급 후 클라이언트는 메타데이터를 별도 엔드포인트로 등록한다.
 */
export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { id: noticeId } = await ctx.params;
  const body = (await req.json().catch(() => null)) as SignBody | null;
  if (!body) {
    return NextResponse.json({ success: false, error: '잘못된 요청입니다.' }, { status: 400 });
  }

  const fileName = String(body.file_name ?? '').trim();
  const fileSize = Number(body.file_size ?? 0);
  const mimeType = String(body.mime_type ?? '').trim() || 'application/octet-stream';
  const kind = body.kind === 'inline' ? 'inline' : 'attachment';

  if (!fileName) {
    return NextResponse.json({ success: false, error: '파일명이 필요합니다.' }, { status: 400 });
  }
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    return NextResponse.json({ success: false, error: '파일 크기가 유효하지 않습니다.' }, { status: 400 });
  }
  if (fileSize > NOTICE_MAX_FILE_BYTES) {
    return NextResponse.json(
      { success: false, error: '파일 크기는 10MB 이하여야 합니다.' },
      { status: 400 },
    );
  }
  if (kind === 'inline' && !isAllowedInlineImageMime(mimeType)) {
    return NextResponse.json({ success: false, error: '이미지 파일만 업로드할 수 있습니다.' }, { status: 400 });
  }
  if (kind === 'attachment' && !isAllowedUploadMime(mimeType)) {
    return NextResponse.json(
      { success: false, error: 'PDF, 이미지, 문서 파일만 업로드할 수 있습니다.' },
      { status: 400 },
    );
  }

  const db = createAdminSupabaseClient();
  const { data: notice } = await db.from('notices').select('id').eq('id', noticeId).maybeSingle();
  if (!notice) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }

  const storagePath =
    kind === 'inline'
      ? noticeInlineStoragePath(noticeId, fileName)
      : noticeAttachmentStoragePath(noticeId, fileName);

  const { data, error } = await db.storage
    .from(NOTICE_STORAGE_BUCKET)
    .createSignedUploadUrl(storagePath);

  if (error || !data) {
    return NextResponse.json(
      { success: false, error: error?.message ?? '업로드 URL 발급 실패' },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      bucket: NOTICE_STORAGE_BUCKET,
      storage_path: storagePath,
      token: data.token,
      signed_url: data.signedUrl,
    },
  });
}
