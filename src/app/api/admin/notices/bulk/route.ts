import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { isAdminAuthed } from '@/lib/admin-auth';
import { NOTICE_STORAGE_BUCKET } from '@/lib/notices/constants';

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: { action?: string; ids?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const action = String(body.action ?? '');
  const ids = Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === 'string' && id.length > 0) : [];
  if (!ids.length) {
    return NextResponse.json({ success: false, error: '선택된 항목이 없습니다.' }, { status: 400 });
  }

  const db = createAdminSupabaseClient();

  if (action === 'stop') {
    const { error } = await db.from('notices').update({ is_stopped: true }).in('id', ids);
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, updated: ids.length });
  }

  if (action === 'delete') {
    const { data: attachments } = await db.from('notice_attachments').select('storage_path').in('notice_id', ids);
    const paths = (attachments ?? []).map((a) => String((a as { storage_path: string }).storage_path));

    const { error } = await db.from('notices').delete().in('id', ids);
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

    if (paths.length > 0) {
      await db.storage.from(NOTICE_STORAGE_BUCKET).remove(paths);
    }
    return NextResponse.json({ success: true, deleted: ids.length });
  }

  return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
}
