import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { isAdminAuthed } from '@/lib/admin-auth';
import { normalizeName } from '@/lib/account-issue/normalize';
import { preIssueUnmappedAccount } from '@/lib/account-issue/issue';

/**
 * 사전 계정 발급(pre-issue) API
 *
 * /admin/account-issue 에서 검색 결과가 없거나, 아직 사람 데이터(organization_members/customers)
 * 가 만들어지지 않은 사람에 대해 미리 계정을 만들 때 사용한다.
 *
 * 핵심 발급 로직은 lib/account-issue/issue.ts 의 preIssueUnmappedAccount 함수로 추출되어
 * Google Sheet 동기화 등에서도 동일하게 재사용된다.
 */

type Body = {
  name: string;
  phone?: string | null;
  login_code: string;
  password: string;
  is_active: boolean;
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
  const result = await preIssueUnmappedAccount(db, {
    name: body.name,
    phone: body.phone ?? null,
    loginCode: body.login_code,
    password: body.password,
    isActive: !!body.is_active,
    auditReason: 'CREATED',
  });

  if (!result.ok) {
    const status =
      result.code === 'DUPLICATE_LOGIN_CODE' || result.code === 'AUTH_CREATE_FAILED'
        ? 409
        : result.code === 'INVALID_INPUT'
          ? 400
          : 500;
    return NextResponse.json({ success: false, error: result.message }, { status });
  }

  // 정규화 키가 정확히 일치하는 후보가 이미 동기화돼 있을 수도 있으니
  // 즉시 자동 매핑 평가를 1회 시도해 본다(전체 스캔이라도 일반적 부담은 작음).
  // 어차피 다음 동기화 때 다시 평가되므로 실패해도 무시.
  try {
    const nameKey = normalizeName(body.name ?? '');
    if (nameKey) {
      const { runPreIssuedAccountAutoMapping } = await import('@/lib/account-issue/auto-mapping');
      await runPreIssuedAccountAutoMapping(db);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[pre-issue] 즉시 자동 매핑 시도 실패(생성은 정상):', e);
  }

  return NextResponse.json({
    success: true,
    data: { user_id: result.user_id, mapping_status: 'PENDING' },
  });
}
