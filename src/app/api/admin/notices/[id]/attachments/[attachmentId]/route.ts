import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { isAdminAuthed } from '@/lib/admin-auth';
import { NOTICE_STORAGE_BUCKET } from '@/lib/notices/constants';

type Ctx = { params: Promise<{ id: string; attachmentId: string }> };

export async function DELETE(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { id: noticeId, attachmentId } = await ctx.params;
  const db = createAdminSupabaseClient();

  const { data: row } = await db
    .from('notice_attachments')
    .select('storage_path')
    .eq('id', attachmentId)
    .eq('notice_id', noticeId)
    .maybeSingle();

  if (!row) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

  const path = String((row as { storage_path: string }).storage_path);
  const { error } = await db.from('notice_attachments').delete().eq('id', attachmentId);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  await db.storage.from(NOTICE_STORAGE_BUCKET).remove([path]);
  return NextResponse.json({ success: true });
}
