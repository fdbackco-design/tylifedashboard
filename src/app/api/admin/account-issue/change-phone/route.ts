/**
 * POST /api/admin/account-issue/change-phone
 * body: { user_id: string, new_phone: string }
 *
 * 전화번호 변경 시 login_code·초기 비밀번호·phone 을 함께 갱신한다.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthed } from '@/lib/admin-auth';
import { changeIssuedAccountPhone } from '@/lib/account-issue/change-phone';
import { createAdminSupabaseClient } from '@/lib/supabase/server';

type Body = {
  user_id?: string;
  new_phone?: string;
};

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

  const db = createAdminSupabaseClient();
  const result = await changeIssuedAccountPhone(db, {
    userId: String(body.user_id ?? ''),
    newPhone: String(body.new_phone ?? ''),
  });

  if (!result.ok) {
    const status =
      result.code === 'INVALID_INPUT'
        ? 400
        : result.code === 'NOT_FOUND'
          ? 404
          : result.code === 'DUPLICATE_LOGIN_CODE'
            ? 409
            : 500;
    return NextResponse.json({ success: false, error: result.message, code: result.code }, { status });
  }

  return NextResponse.json({
    success: true,
    data: {
      user_id: result.user_id,
      display_name: result.display_name,
      previous_phone: result.previous_phone,
      phone: result.phone,
      previous_login_id: result.previous_login_code,
      login_id: result.login_code,
      email: result.email,
      password_hint: result.password_hint,
    },
  });
}
