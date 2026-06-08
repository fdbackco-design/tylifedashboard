import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { isAdminAuthed } from '@/lib/admin-auth';
import { issueMappedAccount } from '@/lib/account-issue/issue';

type Body = {
  /** 없거나 빈 문자열이면 null 저장(organization_members만 있는 조직원도 발급 가능) */
  customer_id?: string | null;
  member_id: string;
  login_code: string; // 8자리 숫자(요구사항)
  password: string;
  is_active: boolean;
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ success: false, error: 'invalid json' }, { status: 400 });
  }

  if (!body.member_id) {
    return NextResponse.json(
      {
        success: false,
        error:
          'member_id is required (자가가입 등 customer 와 동일인이라도 영업사원 노드 매핑이 필요합니다)',
      },
      { status: 400 },
    );
  }
  if (!body.login_code || !body.password) {
    return NextResponse.json({ success: false, error: 'login_code/password required' }, { status: 400 });
  }

  const db = createAdminSupabaseClient();
  const res = await issueMappedAccount(db, {
    memberId: body.member_id,
    customerId: body.customer_id ?? null,
    loginCode: body.login_code,
    password: body.password,
    isActive: !!body.is_active,
    matchedBy: 'ADMIN',
  });

  if (!res.ok) {
    const status = res.code === 'AUTH_CREATE_FAILED' || res.code === 'DUPLICATE_LOGIN_CODE' ? 409
      : res.code === 'INVALID_INPUT' ? 400
      : 500;
    return NextResponse.json({ success: false, error: res.message }, { status });
  }

  return NextResponse.json({ success: true, data: { user_id: res.user_id, existed: res.existed } });
}
