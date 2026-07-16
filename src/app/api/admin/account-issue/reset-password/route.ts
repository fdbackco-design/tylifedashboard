/**
 * POST /api/admin/account-issue/reset-password
 * body: { login_id: string }  // 8자리 또는 26984730@tylifedashboard.local
 *
 * 비밀번호를 login_code 와 동일한 8자리로 초기화하고 must_change_password=true 설정.
 * 이메일 recover 가 불가능한 @tylifedashboard.local 계정용.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthed } from '@/lib/admin-auth';
import { resetMemberPasswordToLoginCode } from '@/lib/account-issue/reset-password';
import { createAdminSupabaseClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: { login_id?: string } = {};
  try {
    body = (await req.json()) as { login_id?: string };
  } catch {
    return NextResponse.json({ success: false, error: 'invalid json' }, { status: 400 });
  }

  const loginId = String(body.login_id ?? '').trim();
  if (!loginId) {
    return NextResponse.json({ success: false, error: 'login_id 가 필요합니다.' }, { status: 400 });
  }

  const db = createAdminSupabaseClient();
  const result = await resetMemberPasswordToLoginCode(db, loginId);

  if (!result.ok) {
    const status =
      result.code === 'INVALID_INPUT' ? 400 : result.code === 'NOT_FOUND' ? 404 : 500;
    return NextResponse.json({ success: false, error: result.message, code: result.code }, { status });
  }

  return NextResponse.json({
    success: true,
    data: {
      user_id: result.user_id,
      login_code: result.login_code,
      display_name: result.display_name,
      email: result.email,
      /** 초기화된 비밀번호는 login_code 와 동일 (화면에만 안내, 로그 저장 안 함) */
      password_hint: result.login_code,
      must_change_password: true,
    },
  });
}
