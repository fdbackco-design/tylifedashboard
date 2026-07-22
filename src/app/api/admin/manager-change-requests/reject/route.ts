/**
 * POST /api/admin/manager-change-requests/reject
 * 관리자: 담당자 변경 신청 반려 처리 (단건)
 *
 * Body: { id: string, reason: string }
 *
 * 후처리:
 *   - status = 'REJECTED'
 *   - rejection_reason = reason
 *   - rejected_at = now()
 *   - rejected_by_admin_id = 관리자 user id
 *
 * PENDING / RECEIVED 상태만 반려 가능하다.
 * 이미 COMPLETED / REJECTED 인 신청은 거부한다.
 * 반려 사유는 신청자(영업자) 화면에 그대로 표시된다.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { isAdminAuthed } from '@/lib/admin-auth';
import { notifyRequesterOfManagerChangeRejected } from '@/lib/manager-change/notify';
import { createAdminSupabaseClient } from '@/lib/supabase/server';

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const MAX_REASON_LEN = 1000;

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

  let body: { id?: unknown; reason?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON body 필요' }, { status: 400 });
  }

  const id = (typeof body.id === 'string' ? body.id : '').trim();
  if (!UUID.test(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const reason = (typeof body.reason === 'string' ? body.reason : '').trim();
  if (!reason) return NextResponse.json({ error: '반려 사유를 입력하세요.' }, { status: 400 });
  if (reason.length > MAX_REASON_LEN) {
    return NextResponse.json({ error: `사유는 ${MAX_REASON_LEN}자 이내로 입력하세요.` }, { status: 400 });
  }

  const adminUserId = await getAdminUserId(req);
  const db = createAdminSupabaseClient();

  const { data: cur, error: selErr } = await db
    .from('manager_change_requests')
    .select('id, status')
    .eq('id', id)
    .maybeSingle();
  if (selErr) return NextResponse.json({ error: selErr.message }, { status: 500 });
  if (!cur) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const status = (cur as { status: string }).status;
  if (status === 'REJECTED') {
    return NextResponse.json({ error: '이미 반려된 신청입니다.' }, { status: 409 });
  }
  if (status !== 'PENDING' && status !== 'RECEIVED') {
    return NextResponse.json({ error: '신청중/접수완료 상태만 반려할 수 있습니다.' }, { status: 409 });
  }

  const { data, error } = await db
    .from('manager_change_requests')
    .update({
      status: 'REJECTED',
      rejection_reason: reason,
      rejected_at: new Date().toISOString(),
      rejected_by_admin_id: adminUserId,
    })
    .eq('id', id)
    .in('status', ['PENDING', 'RECEIVED'])
    .select('id, status, rejection_reason, rejected_at')
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) {
    return NextResponse.json(
      { error: '대상 신청을 찾을 수 없거나 상태가 변경되었습니다.' },
      { status: 409 },
    );
  }

  // 반려 알림 발송 (rejected_notified_at IS NULL 일 때만 1회).
  // 푸시 발송 실패가 reject 응답 자체를 막지 않도록 격리한다.
  try {
    await notifyRequesterOfManagerChangeRejected(db, id);
  } catch (e) {
    console.error(
      '[manager-change-reject] notify failed',
      id,
      e instanceof Error ? e.message : String(e),
    );
  }

  return NextResponse.json({ item: data });
}
