import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { isAdminAuthed } from '@/lib/admin-auth';
import { loadSubscriptionsForSend, sendWebPushToSubscriptions } from '@/lib/push/send';
import type { PushSendBody } from '@/lib/push/types';

/**
 * 관리자 푸시 발송 API.
 * 본문(body)에 고객 실명·주민번호·계약 상세 등 민감 정보를 넣지 마세요.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: PushSendBody;
  try {
    body = (await req.json()) as PushSendBody;
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const title = String(body.title ?? '').trim();
  const pushBody = String(body.body ?? '').trim();
  const url = String(body.url ?? '/organization').trim() || '/organization';
  const targetUserId = body.targetUserId ? String(body.targetUserId).trim() : undefined;

  if (!title) {
    return NextResponse.json({ success: false, error: '제목을 입력해주세요.' }, { status: 400 });
  }
  if (!pushBody) {
    return NextResponse.json({ success: false, error: '내용을 입력해주세요.' }, { status: 400 });
  }

  const db = createAdminSupabaseClient();

  if (targetUserId) {
    const { data: profile } = await db.from('user_profiles').select('id').eq('id', targetUserId).maybeSingle();
    if (!profile) {
      return NextResponse.json({ success: false, error: '대상 사용자를 찾을 수 없습니다.' }, { status: 404 });
    }
  }

  let subscriptions;
  try {
    subscriptions = await loadSubscriptionsForSend(db, targetUserId);
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  if (!subscriptions.length) {
    return NextResponse.json({
      success: true,
      data: { sent: 0, failed: 0, removed: 0, errors: [], message: '발송 대상 구독이 없습니다.' },
    });
  }

  try {
    const result = await sendWebPushToSubscriptions(db, {
      subscriptions,
      title,
      body: pushBody,
      url,
    });
    return NextResponse.json({ success: true, data: result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('VAPID')) {
      return NextResponse.json({ success: false, error: 'VAPID 키가 설정되지 않았습니다.' }, { status: 500 });
    }
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
