import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { isAdminAuthed } from '@/lib/admin-auth';
import { NOTICE_STORAGE_BUCKET } from '@/lib/notices/constants';
import { removeNoticeInlineStorage } from '@/lib/notices/storage';
import { getNoticeDisplayStatus } from '@/lib/notices/status';
import type { NoticeAttachmentRow, NoticeListItem, NoticeRow } from '@/lib/notices/types';
import { assertPinnedLimit, parseNoticeCategory, parseOptionalDate } from '@/lib/notices/validation';

type Ctx = { params: Promise<{ id: string }> };

function mapDetail(row: NoticeRow, attachments: NoticeAttachmentRow[]): NoticeListItem & { attachments: NoticeAttachmentRow[] } {
  return {
    ...row,
    display_status: getNoticeDisplayStatus(row),
    attachment_count: attachments.length,
    attachments,
  };
}

export async function GET(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await ctx.params;
  const db = createAdminSupabaseClient();
  const { data, error } = await db.from('notices').select('*').eq('id', id).maybeSingle();
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

  const { data: attachments } = await db
    .from('notice_attachments')
    .select('*')
    .eq('notice_id', id)
    .order('created_at', { ascending: true });

  return NextResponse.json({
    success: true,
    data: mapDetail(data as NoticeRow, (attachments ?? []) as NoticeAttachmentRow[]),
  });
}

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await ctx.params;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const db = createAdminSupabaseClient();
  const { data: existing } = await db.from('notices').select('*').eq('id', id).maybeSingle();
  if (!existing) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

  const patch: Record<string, unknown> = {};
  if (body.category !== undefined) {
    const cat = parseNoticeCategory(body.category);
    if (!cat) return NextResponse.json({ success: false, error: '분류를 확인해주세요.' }, { status: 400 });
    patch.category = cat;
  }
  if (body.title !== undefined) {
    const title = String(body.title).trim();
    if (!title) return NextResponse.json({ success: false, error: '제목을 입력해주세요.' }, { status: 400 });
    patch.title = title;
  }
  if (body.content !== undefined) patch.content = String(body.content ?? '');
  if (body.is_pinned !== undefined) patch.is_pinned = Boolean(body.is_pinned);
  if (body.send_push !== undefined) patch.send_push = Boolean(body.send_push);
  if (body.is_draft !== undefined) patch.is_draft = Boolean(body.is_draft);
  if (body.is_stopped !== undefined) patch.is_stopped = Boolean(body.is_stopped);
  if (body.publish_start !== undefined) patch.publish_start = parseOptionalDate(body.publish_start);
  if (body.publish_end !== undefined) patch.publish_end = parseOptionalDate(body.publish_end);

  const nextPinned = patch.is_pinned !== undefined ? Boolean(patch.is_pinned) : Boolean((existing as NoticeRow).is_pinned);
  const pinErr = await assertPinnedLimit(db, { isPinned: nextPinned, excludeId: id });
  if (pinErr) return NextResponse.json({ success: false, error: pinErr }, { status: 400 });

  const { data, error } = await db.from('notices').update(patch).eq('id', id).select('*').single();
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  const { data: attachments } = await db.from('notice_attachments').select('*').eq('notice_id', id);
  return NextResponse.json({
    success: true,
    data: mapDetail(data as NoticeRow, (attachments ?? []) as NoticeAttachmentRow[]),
  });
}

export async function DELETE(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await ctx.params;
  const db = createAdminSupabaseClient();

  const { data: attachments } = await db.from('notice_attachments').select('storage_path').eq('notice_id', id);
  const paths = (attachments ?? []).map((a) => String((a as { storage_path: string }).storage_path));

  const { error } = await db.from('notices').delete().eq('id', id);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  if (paths.length > 0) {
    await db.storage.from(NOTICE_STORAGE_BUCKET).remove(paths);
  }

  await removeNoticeInlineStorage(db, id);

  return NextResponse.json({ success: true });
}
