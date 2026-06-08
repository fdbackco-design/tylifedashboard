import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { isAdminAuthed } from '@/lib/admin-auth';
import { normalizeName, normalizePhone } from '@/lib/account-issue/normalize';

/**
 * 사전 계정 발급(pre-issue) API
 *
 * /admin/account-issue 에서 검색 결과가 없거나, 아직 사람 데이터(organization_members/customers)
 * 가 만들어지지 않은 사람에 대해 미리 계정을 만들 때 사용한다.
 *
 * 생성 규칙:
 *   - role            = 'member'
 *   - member_id       = null (CHECK 제약은 mapping_status=PENDING 일 때 NULL 허용)
 *   - customer_id     = null
 *   - mapping_status  = 'PENDING'
 *   - pre_issued_name / pre_issued_phone = 입력값 저장 (정규화는 매칭 시점에 수행)
 *   - display_name    = 입력 이름
 *   - phone           = 입력 전화번호
 *   - matched_at / matched_by = null
 *
 * 이후 TY 동기화에서 자동 매핑이 시도되며, 안전한 케이스에서만 MATCHED 로 전환된다.
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

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const phoneRaw = typeof body.phone === 'string' ? body.phone.trim() : '';
  const phoneDigits = normalizePhone(phoneRaw);
  const { login_code, password, is_active } = body;

  if (!name) {
    return NextResponse.json({ success: false, error: '이름은 필수입니다.' }, { status: 400 });
  }
  if (!login_code || !password) {
    return NextResponse.json({ success: false, error: '로그인 ID/비밀번호는 필수입니다.' }, { status: 400 });
  }

  const EMAIL_DOMAIN = 'tylifedashboard.local';
  const extractDigits8 = (v: string): string | null => {
    const local = v.includes('@') ? v.split('@')[0] : v;
    return /^\d{8}$/.test(local) ? local : null;
  };

  const digits = extractDigits8(login_code);
  if (!digits) {
    return NextResponse.json({ success: false, error: '로그인 ID는 8자리 숫자여야 합니다.' }, { status: 400 });
  }
  const passwordDigits = extractDigits8(password);
  if (!passwordDigits || passwordDigits !== digits) {
    return NextResponse.json(
      { success: false, error: '초기 비밀번호는 로그인 ID와 동일한 8자리 숫자여야 합니다.' },
      { status: 400 },
    );
  }

  const authEmail = `${digits}@${EMAIL_DOMAIN}`;
  const db = createAdminSupabaseClient();

  try {
    // 1) login_code 중복 검사 (기존 사용자 보호)
    const { data: dup, error: dupErr } = await db
      .from('user_profiles')
      .select('id')
      .eq('login_code', digits)
      .limit(1)
      .maybeSingle();
    if (dupErr) throw new Error(`login_code 중복 검사 실패: ${dupErr.message}`);
    if (dup?.id) {
      return NextResponse.json(
        { success: false, error: '이미 동일한 로그인 ID 가 존재합니다.' },
        { status: 409 },
      );
    }

    // 2) Supabase Auth 사용자 생성
    const created = await db.auth.admin.createUser({
      email: authEmail,
      password: digits,
      email_confirm: true,
      user_metadata: { pre_issued: true, pre_issued_name: name },
    });
    if (created.error) {
      const msg = created.error.message ?? 'createUser failed';
      return NextResponse.json({ success: false, error: msg }, { status: 409 });
    }
    const userId = created.data.user?.id;
    if (!userId) throw new Error('auth user id missing');

    // 3) user_profiles 사전 발급 행 INSERT (PENDING)
    const profile = {
      id: userId,
      customer_id: null,
      member_id: null,
      login_code: digits,
      display_name: name,
      phone: phoneRaw ? phoneRaw : null,
      role: 'member',
      is_active: !!is_active,
      must_change_password: true,
      // 매핑 추적용 필드
      mapping_status: 'PENDING',
      pre_issued_name: name,
      pre_issued_phone: phoneDigits || null,
      matched_at: null,
      matched_by: null,
      mapping_reason: null,
    };

    const ins = await db.from('user_profiles').insert(profile);
    if (ins.error) {
      // user_profiles 인서트 실패 시 auth 사용자 정리 (best-effort)
      try {
        await db.auth.admin.deleteUser(userId);
      } catch {
        // ignore
      }
      throw new Error(ins.error.message);
    }

    // 4) 감사 로그
    await db.from('account_mapping_logs').insert({
      action: 'PRE_ISSUED_ACCOUNT_CREATED',
      user_profile_id: userId,
      member_id: null,
      pre_issued_name: name,
      pre_issued_phone: phoneDigits || null,
      mapping_status: 'PENDING',
      matched_by: null,
      candidate_type: null,
      reason: 'CREATED',
      admin_id: null,
    });

    // 5) 정규화 키가 정확히 일치하는 후보가 이미 동기화돼 있을 수도 있으니
    //    이 사용자만 즉시 자동 매핑 평가를 시도해 본다(전체 스캔 부담 회피).
    //    어차피 다음 동기화 때 다시 평가되므로 실패해도 무시.
    try {
      const nameKey = normalizeName(name);
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
      data: {
        user_id: userId,
        mapping_status: 'PENDING',
      },
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
