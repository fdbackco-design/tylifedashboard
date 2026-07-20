import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthed } from '@/lib/admin-auth';
import { createAdminSupabaseClient } from '@/lib/supabase/server';

const EMAIL_DOMAIN = 'tylifedashboard.local';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Body = {
  user_id?: string;
  new_login_id?: string;
};

/**
 * Auth 이메일·비밀번호와 user_profiles.login_code를 같은 8자리 값으로 정정한다.
 * public profile 갱신 후 Auth 갱신이 실패하면 profile 값은 원복한다.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ success: false, error: 'invalid json' }, { status: 400 });
  }

  const userId = String(body.user_id ?? '').trim();
  const newLoginId = String(body.new_login_id ?? '').replace(/\D/g, '');
  if (!UUID_RE.test(userId)) {
    return NextResponse.json({ success: false, error: '올바른 사용자 UUID를 입력해 주세요.' }, { status: 400 });
  }
  if (!/^\d{8}$/.test(newLoginId)) {
    return NextResponse.json({ success: false, error: '새 로그인 ID는 8자리 숫자여야 합니다.' }, { status: 400 });
  }

  const db = createAdminSupabaseClient();
  const { data: profile, error: profileErr } = await db
    .from('user_profiles')
    .select('id, login_code, display_name')
    .eq('id', userId)
    .maybeSingle();
  if (profileErr) {
    return NextResponse.json({ success: false, error: `프로필 조회 실패: ${profileErr.message}` }, { status: 500 });
  }
  if (!profile?.id) {
    return NextResponse.json({ success: false, error: '해당 UUID의 user_profiles 계정을 찾을 수 없습니다.' }, { status: 404 });
  }

  const oldLoginId = String(profile.login_code ?? '').trim();
  const { data: duplicate, error: duplicateErr } = await db
    .from('user_profiles')
    .select('id')
    .eq('login_code', newLoginId)
    .neq('id', userId)
    .limit(1)
    .maybeSingle();
  if (duplicateErr) {
    return NextResponse.json({ success: false, error: `중복 확인 실패: ${duplicateErr.message}` }, { status: 500 });
  }
  if (duplicate?.id) {
    return NextResponse.json({ success: false, error: '새 로그인 ID를 사용하는 다른 계정이 있습니다.' }, { status: 409 });
  }

  const profileUpdate = await db
    .from('user_profiles')
    .update({
      login_code: newLoginId,
      must_change_password: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);
  if (profileUpdate.error) {
    return NextResponse.json(
      { success: false, error: `프로필 로그인 ID 변경 실패: ${profileUpdate.error.message}` },
      { status: 500 },
    );
  }

  const email = `${newLoginId}@${EMAIL_DOMAIN}`;
  const { error: authErr } = await db.auth.admin.updateUserById(userId, {
    email,
    password: newLoginId,
    email_confirm: true,
  });
  if (authErr) {
    await db
      .from('user_profiles')
      .update({ login_code: oldLoginId, updated_at: new Date().toISOString() })
      .eq('id', userId);
    return NextResponse.json(
      { success: false, error: `Auth 로그인 정보 변경 실패: ${authErr.message}` },
      { status: 500 },
    );
  }

  try {
    await db.from('account_mapping_logs').insert({
      action: 'ADMIN_LOGIN_ID_CHANGED',
      user_profile_id: userId,
      pre_issued_name: profile.display_name ?? null,
      reason: 'ADMIN_LOGIN_ID_AND_PASSWORD_SYNC',
      metadata: {
        previous_login_code: oldLoginId,
        new_login_code: newLoginId,
      },
    });
  } catch {
    // 감사 로그 실패는 로그인 정보 정정 실패로 보지 않는다.
  }

  return NextResponse.json({
    success: true,
    data: {
      user_id: userId,
      previous_login_id: oldLoginId,
      login_id: newLoginId,
      email,
      password_hint: newLoginId,
    },
  });
}
