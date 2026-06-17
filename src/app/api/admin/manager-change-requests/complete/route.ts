/**
 * POST /api/admin/manager-change-requests/complete
 * 관리자: 담당자 변경 신청 완료 처리 (단건/일괄)
 *
 * Body: { ids: string[] }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { isAdminAuthed } from '@/lib/admin-auth';
import { notifyRequesterOfManagerChangeCompleted } from '@/lib/manager-change/notify';
import { createAdminSupabaseClient } from '@/lib/supabase/server';

async function getAdminUserId(req: NextRequest): Promise<string | null> {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll() {},
      },
    },
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: { ids?: string[] } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON body 필요' }, { status: 400 });
  }

  const ids = Array.isArray(body.ids) ? body.ids.map((id) => String(id).trim()).filter(Boolean) : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: '완료 처리할 항목을 선택하세요.' }, { status: 400 });
  }

  const adminUserId = await getAdminUserId(req);
  const db = createAdminSupabaseClient();
  const now = new Date().toISOString();

  const { data: rows, error: selErr } = await db
    .from('manager_change_requests')
    .select('id, status')
    .in('id', ids);
  if (selErr) return NextResponse.json({ error: selErr.message }, { status: 500 });

  const pendingIds = ((rows ?? []) as Array<{ id: string; status: string }>)
    .filter((r) => r.status === 'PENDING')
    .map((r) => r.id);

  if (pendingIds.length === 0) {
    return NextResponse.json({ error: '완료 처리할 신청중 항목이 없습니다.' }, { status: 400 });
  }

  const { error: upErr } = await db
    .from('manager_change_requests')
    .update({
      status: 'COMPLETED',
      completed_at: now,
      completed_by_admin_id: adminUserId,
    })
    .in('id', pendingIds)
    .eq('status', 'PENDING');
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const notifyResults: Array<{ id: string; sent?: number; skipped?: string }> = [];
  for (const id of pendingIds) {
    try {
      const res = await notifyRequesterOfManagerChangeCompleted(db, id);
      notifyResults.push({ id, ...('skipped' in res ? { skipped: res.skipped } : { sent: res.sent }) });
    } catch (e) {
      console.error('[manager-change-complete] notify failed', id, e instanceof Error ? e.message : String(e));
      notifyResults.push({ id, skipped: 'error' });
    }
  }

  return NextResponse.json({
    completedIds: pendingIds,
    skippedAlreadyCompleted: ids.filter((id) => !pendingIds.includes(id)),
    notifyResults,
  });
}
