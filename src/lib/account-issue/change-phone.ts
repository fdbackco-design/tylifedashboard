/**
 * 발급된 계정의 전화번호를 바꾸면 login_code·초기 비밀번호·phone 을 함께 동기화한다.
 * - 기존 8자리 계정: login_code = 뒤 8자리, password = 뒤 8자리
 * - fed 계정: login_code = fed+뒤 8자리, password = 휴대폰 전체 숫자
 */

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizePhone } from './normalize';

const EMAIL_DOMAIN = 'tylifedashboard.local';

export type ChangePhoneResult =
  | {
      ok: true;
      user_id: string;
      display_name: string | null;
      previous_phone: string | null;
      phone: string;
      previous_login_code: string;
      login_code: string;
      email: string;
      password_hint: string;
    }
  | {
      ok: false;
      code:
        | 'INVALID_INPUT'
        | 'NOT_FOUND'
        | 'DUPLICATE_LOGIN_CODE'
        | 'AUTH_UPDATE_FAILED'
        | 'PROFILE_UPDATE_FAILED';
      message: string;
    };

export type DerivedCredentials = {
  phoneDigits: string;
  loginCode: string;
  password: string;
  email: string;
};

/** 휴대폰 숫자(10~11자리)와 기존 login_code 스타일로 새 자격증명을 만든다. */
export function deriveCredentialsFromPhone(
  phoneRaw: string,
  currentLoginCode: string,
): DerivedCredentials | null {
  const phoneDigits = normalizePhone(phoneRaw);
  if (!/^0\d{9,10}$/.test(phoneDigits)) return null;

  const last8 = phoneDigits.slice(-8);
  const isFed = /^fed\d{8}$/i.test(String(currentLoginCode ?? '').trim());
  const loginCode = isFed ? `fed${last8}` : last8;
  const password = isFed ? phoneDigits : last8;
  return {
    phoneDigits,
    loginCode,
    password,
    email: `${loginCode}@${EMAIL_DOMAIN}`,
  };
}

export async function changeIssuedAccountPhone(
  adminDb: SupabaseClient,
  params: { userId: string; newPhone: string },
): Promise<ChangePhoneResult> {
  const userId = String(params.userId ?? '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    return { ok: false, code: 'INVALID_INPUT', message: '올바른 사용자 UUID를 입력해 주세요.' };
  }

  const { data: profile, error: profileErr } = await adminDb
    .from('user_profiles')
    .select('id, login_code, display_name, phone, member_id, pre_issued_phone')
    .eq('id', userId)
    .maybeSingle();
  if (profileErr) {
    return { ok: false, code: 'NOT_FOUND', message: `프로필 조회 실패: ${profileErr.message}` };
  }
  if (!profile?.id) {
    return { ok: false, code: 'NOT_FOUND', message: '해당 UUID의 user_profiles 계정을 찾을 수 없습니다.' };
  }

  const oldLoginCode = String((profile as { login_code?: string | null }).login_code ?? '').trim();
  const derived = deriveCredentialsFromPhone(params.newPhone, oldLoginCode);
  if (!derived) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: '휴대폰번호는 010으로 시작하는 10~11자리 숫자여야 합니다.',
    };
  }

  const oldPhone = ((profile as { phone?: string | null }).phone ?? null) as string | null;
  const memberId = ((profile as { member_id?: string | null }).member_id ?? null) as string | null;
  const displayName = ((profile as { display_name?: string | null }).display_name ?? null) as
    | string
    | null;
  const hadPreIssuedPhone = Boolean(
    normalizePhone((profile as { pre_issued_phone?: string | null }).pre_issued_phone),
  );

  if (derived.loginCode !== oldLoginCode) {
    const { data: duplicate, error: dupErr } = await adminDb
      .from('user_profiles')
      .select('id')
      .eq('login_code', derived.loginCode)
      .neq('id', userId)
      .limit(1)
      .maybeSingle();
    if (dupErr) {
      return { ok: false, code: 'PROFILE_UPDATE_FAILED', message: `중복 확인 실패: ${dupErr.message}` };
    }
    if (duplicate?.id) {
      return {
        ok: false,
        code: 'DUPLICATE_LOGIN_CODE',
        message: '새 로그인 ID를 사용하는 다른 계정이 있습니다.',
      };
    }
  }

  const profilePatch: Record<string, unknown> = {
    phone: derived.phoneDigits,
    login_code: derived.loginCode,
    must_change_password: true,
    updated_at: new Date().toISOString(),
  };
  if (hadPreIssuedPhone) {
    profilePatch.pre_issued_phone = derived.phoneDigits;
  }

  const profileUpdate = await adminDb.from('user_profiles').update(profilePatch).eq('id', userId);
  if (profileUpdate.error) {
    return {
      ok: false,
      code: 'PROFILE_UPDATE_FAILED',
      message: `프로필 전화번호 변경 실패: ${profileUpdate.error.message}`,
    };
  }

  const { error: authErr } = await adminDb.auth.admin.updateUserById(userId, {
    email: derived.email,
    password: derived.password,
    email_confirm: true,
  });
  if (authErr) {
    await adminDb
      .from('user_profiles')
      .update({
        phone: oldPhone,
        login_code: oldLoginCode,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);
    return {
      ok: false,
      code: 'AUTH_UPDATE_FAILED',
      message: `Auth 로그인 정보 변경 실패: ${authErr.message}`,
    };
  }

  if (memberId) {
    try {
      await adminDb.from('organization_members').update({ phone: derived.phoneDigits }).eq('id', memberId);
    } catch {
      // 멤버 phone 동기화 실패는 계정 자격증명 변경 실패로 보지 않는다.
    }
  }

  try {
    await adminDb.from('account_mapping_logs').insert({
      action: 'ADMIN_PHONE_CHANGED',
      user_profile_id: userId,
      member_id: memberId,
      pre_issued_name: displayName,
      pre_issued_phone: derived.phoneDigits,
      reason: 'ADMIN_PHONE_LOGIN_PASSWORD_SYNC',
      metadata: {
        previous_phone: oldPhone,
        new_phone: derived.phoneDigits,
        previous_login_code: oldLoginCode,
        new_login_code: derived.loginCode,
        password_policy: derived.loginCode.startsWith('fed') ? 'FULL_PHONE_DIGITS' : 'LOGIN_CODE',
      },
    });
  } catch {
    // 감사 로그 실패는 본 작업 실패로 보지 않는다.
  }

  return {
    ok: true,
    user_id: userId,
    display_name: displayName,
    previous_phone: oldPhone,
    phone: derived.phoneDigits,
    previous_login_code: oldLoginCode,
    login_code: derived.loginCode,
    email: derived.email,
    password_hint: derived.password,
  };
}
