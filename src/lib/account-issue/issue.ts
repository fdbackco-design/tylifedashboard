/**
 * 영업자/고객 사람 데이터에 매핑된 user_profiles 계정을 발급/갱신하는 핵심 로직.
 *
 * - HTTP API(/api/admin/account-issue/issue) 와 Google Sheet 동기화(sync-sheet) 양쪽에서 재사용한다.
 * - 8자리 숫자 login_code 규칙은 호출자가 보장한다(여기서도 한 번 더 검증).
 * - DB CHECK 제약과 일관되게, 발급된 행은 mapping_status='MATCHED' + matched_by 를 기록한다.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

const EMAIL_DOMAIN = 'tylifedashboard.local';

export type IssueMappedAccountResult =
  | { ok: true; user_id: string; existed: boolean }
  | { ok: false; code: 'AUTH_CREATE_FAILED' | 'PROFILE_INSERT_FAILED' | 'LOOKUP_FAILED' | 'INVALID_INPUT' | 'DUPLICATE_LOGIN_CODE'; message: string };

export function isValid8Digits(v: unknown): v is string {
  return typeof v === 'string' && /^\d{8}$/.test(v);
}

function extractLoginDigits(v: string): string | null {
  const local = v.includes('@') ? v.split('@')[0] : v;
  return /^\d{8}$/.test(local) ? local : null;
}

/**
 * 이미 같은 login_code 로 발급된 user_profiles 가 있는지 검사한다.
 * - 시트 동기화에서 "로그인 ID 중복" 판단 용도
 * - 발급 함수 본문에서도 안전망으로 한 번 더 사용
 */
export async function findUserProfileByLoginCode(
  adminDb: SupabaseClient,
  loginCode8: string,
): Promise<{ id: string; member_id: string | null } | null> {
  if (!isValid8Digits(loginCode8)) return null;
  const { data } = await adminDb
    .from('user_profiles')
    .select('id, member_id')
    .eq('login_code', loginCode8)
    .limit(1)
    .maybeSingle();
  return (data ?? null) as any;
}

/**
 * organization_members.id 에 매핑된 user_profiles 계정을 발급한다.
 * - 이미 같은 member_id 에 발급된 행이 있으면 그것을 갱신만 하고 existed=true 로 반환
 * - 새로 만들 때는 auth.users 생성 → user_profiles INSERT(mapping_status='MATCHED')
 *
 * 호출자는 password 원문이 로그/응답에 새지 않도록 주의해야 한다.
 */
export async function issueMappedAccount(
  adminDb: SupabaseClient,
  params: {
    memberId: string;
    customerId?: string | null;
    loginCode: string; // 8자리 숫자
    password: string;  // 8자리 숫자 (loginCode 와 동일)
    isActive?: boolean;
    matchedBy?: 'ADMIN' | 'AUTO_SYNC';
  },
): Promise<IssueMappedAccountResult> {
  const memberId = (params.memberId ?? '').trim();
  if (!memberId) {
    return { ok: false, code: 'INVALID_INPUT', message: 'member_id 필수' };
  }

  const digits = extractLoginDigits(params.loginCode ?? '');
  if (!digits) {
    return { ok: false, code: 'INVALID_INPUT', message: 'login_code 는 8자리 숫자여야 합니다.' };
  }
  const passwordDigits = extractLoginDigits(params.password ?? '');
  if (!passwordDigits || passwordDigits !== digits) {
    return { ok: false, code: 'INVALID_INPUT', message: '비밀번호는 login_code 와 동일한 8자리 숫자여야 합니다.' };
  }

  const customerId =
    typeof params.customerId === 'string' && params.customerId.trim().length > 0
      ? params.customerId.trim()
      : null;
  const isActive = params.isActive ?? true;
  const matchedBy = params.matchedBy ?? 'ADMIN';

  try {
    // 0) 이미 같은 member_id 로 발급된 계정이 있으면 활성 상태만 갱신
    const { data: existingProfile, error: lookErr } = await adminDb
      .from('user_profiles')
      .select('id, is_active')
      .eq('member_id', memberId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lookErr) {
      return { ok: false, code: 'LOOKUP_FAILED', message: lookErr.message };
    }
    if (existingProfile?.id) {
      await adminDb.from('user_profiles').update({ is_active: isActive }).eq('id', existingProfile.id);
      return { ok: true, user_id: existingProfile.id as string, existed: true };
    }

    // 0-b) 같은 login_code 행 중복 검사 (다른 member_id 로 이미 발급된 경우)
    const dup = await findUserProfileByLoginCode(adminDb, digits);
    if (dup?.id) {
      return { ok: false, code: 'DUPLICATE_LOGIN_CODE', message: '동일 로그인 ID 가 이미 존재합니다.' };
    }

    // 1) 보강용 row 와 auth user 생성을 병렬
    const memberPromise = adminDb
      .from('organization_members')
      .select('id, name, rank, phone')
      .eq('id', memberId)
      .maybeSingle();
    const customerPromise = customerId
      ? adminDb.from('customers').select('id, name, phone').eq('id', customerId).maybeSingle()
      : Promise.resolve({ data: null as null });

    const created = await adminDb.auth.admin.createUser({
      email: `${digits}@${EMAIL_DOMAIN}`,
      password: digits,
      email_confirm: true,
      user_metadata: { member_id: memberId },
    });
    if (created.error) {
      return { ok: false, code: 'AUTH_CREATE_FAILED', message: created.error.message ?? 'createUser failed' };
    }
    const userId = created.data.user?.id;
    if (!userId) {
      return { ok: false, code: 'AUTH_CREATE_FAILED', message: 'auth user id missing' };
    }

    const [memberRes, customerRes] = await Promise.all([memberPromise, customerPromise]);
    const member = (memberRes.data ?? null) as any;
    const customer = (customerRes.data ?? null) as any;

    const profile = {
      id: userId,
      customer_id: customerId,
      member_id: memberId,
      login_code: digits,
      display_name: member?.name ?? customer?.name ?? null,
      phone: member?.phone ?? customer?.phone ?? null,
      role: 'member',
      is_active: isActive,
      must_change_password: true,
      mapping_status: 'MATCHED',
      matched_at: new Date().toISOString(),
      matched_by: matchedBy,
      mapping_reason: matchedBy === 'AUTO_SYNC' ? 'SHEET_SYNC' : 'ADMIN_ISSUE',
    };

    const ins = await adminDb.from('user_profiles').insert(profile);
    if (ins.error) {
      // 실패 시 best-effort 정리
      try {
        await adminDb.auth.admin.deleteUser(userId);
      } catch {
        // ignore
      }
      return { ok: false, code: 'PROFILE_INSERT_FAILED', message: ins.error.message };
    }

    return { ok: true, user_id: userId, existed: false };
  } catch (e) {
    return {
      ok: false,
      code: 'LOOKUP_FAILED',
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
