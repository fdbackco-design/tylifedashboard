/**
 * POST /api/admin/manager-change-requests/receive
 * 관리자: 담당자 변경 신청 "접수완료" 처리 (단건/일괄)
 *
 * Body: { ids: string[] }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { isAdminAuthed } from '@/lib/admin-auth';
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
    return NextResponse.json({ error: '접수완료 처리할 항목을 선택하세요.' }, { status: 400 });
  }

  void (await getAdminUserId(req)); // 현재는 추적 컬럼이 없어 no-op
  const db = createAdminSupabaseClient();

  const { data: rows, error: selErr } = await db
    .from('manager_change_requests')
    .select('id, status')
    .in('id', ids);
  if (selErr) return NextResponse.json({ error: selErr.message }, { status: 500 });

  const pendingIds = ((rows ?? []) as Array<{ id: string; status: string }>)
    .filter((r) => r.status === 'PENDING')
    .map((r) => r.id);

  if (pendingIds.length === 0) {
    return NextResponse.json({ error: '접수완료 처리할 신청중 항목이 없습니다.' }, { status: 400 });
  }

  const { error: upErr } = await db
    .from('manager_change_requests')
    .update({
      status: 'RECEIVED',
    })
    .in('id', pendingIds)
    .eq('status', 'PENDING');
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  return NextResponse.json({
    receivedIds: pendingIds,
    skippedAlreadyNonPending: ids.filter((id) => !pendingIds.includes(id)),
  });
}

