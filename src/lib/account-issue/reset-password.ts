/**
 * 관리자: 비밀번호를 휴대폰 010 제외 뒤 8자리로 초기화한다.
 * - @tylifedashboard.local 가짜 메일이라 email recover 불가 → Auth Admin API 사용
 * - 비밀번호 원문은 로그/감사에 저장하지 않음
 */

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { extractAccountLoginCode, loginCodeLookupCandidates, passwordFromPhoneLast8 } from './login-code';

const EMAIL_DOMAIN = 'tylifedashboard.local';

export type ResetPasswordResult =
  | {
      ok: true;
      user_id: string;
      login_code: string;
      display_name: string | null;
      email: string;
      password_hint: string;
    }
  | {
      ok: false;
      code: 'INVALID_INPUT' | 'NOT_FOUND' | 'AUTH_UPDATE_FAILED' | 'PROFILE_UPDATE_FAILED';
      message: string;
    };

export { extractAccountLoginCode, loginCodeLookupCandidates } from './login-code';

type ProfileRow = {
  id: string;
  login_code: string | null;
  display_name: string | null;
  phone: string | null;
  is_active: boolean | null;
};

export async function resetMemberPasswordToLoginCode(
  adminDb: SupabaseClient,
  loginIdRaw: string,
): Promise<ResetPasswordResult> {
  const requestedCode = extractAccountLoginCode(loginIdRaw);
  if (!requestedCode) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: '로그인 ID는 8자리 숫자 또는 fed+8자리여야 합니다.',
    };
  }

  const candidates = loginCodeLookupCandidates(requestedCode);
  const { data: rows, error: pErr } = await adminDb
    .from('user_profiles')
    .select('id, login_code, display_name, phone, is_active')
    .in('login_code', candidates);

  if (pErr) {
    return { ok: false, code: 'NOT_FOUND', message: `계정 조회 실패: ${pErr.message}` };
  }

  const profiles = ((rows ?? []) as ProfileRow[]).filter((row) => row.id);
  const exact = profiles.find((row) => String(row.login_code ?? '') === requestedCode) ?? null;
  const profile = exact ?? (profiles.length === 1 ? profiles[0]! : null);
  if (!profile?.id) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message:
        profiles.length > 1
          ? `login_code=${requestedCode} 와 fed 계정이 함께 있어 구분할 수 없습니다. 전체 로그인 ID를 입력해 주세요.`
          : `login_code=${requestedCode} 계정을 찾을 수 없습니다.`,
    };
  }

  const loginCode = String(profile.login_code ?? requestedCode);
  const userId = String(profile.id);
  const displayName = profile.display_name ?? null;
  const email = `${loginCode}@${EMAIL_DOMAIN}`;
  const resetPassword = passwordFromPhoneLast8(loginCode, profile.phone);
  if (!resetPassword) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: '비밀번호로 쓸 휴대폰 뒤 8자리를 확인할 수 없습니다.',
    };
  }

  const { error: authErr } = await adminDb.auth.admin.updateUserById(userId, {
    password: resetPassword,
  });
  if (authErr) {
    return {
      ok: false,
      code: 'AUTH_UPDATE_FAILED',
      message: authErr.message || 'Auth 비밀번호 초기화 실패',
    };
  }

  const { error: upErr } = await adminDb
    .from('user_profiles')
    .update({ must_change_password: true, updated_at: new Date().toISOString() })
    .eq('id', userId);
  if (upErr) {
    return {
      ok: false,
      code: 'PROFILE_UPDATE_FAILED',
      message: `비밀번호는 변경됐지만 must_change_password 갱신 실패: ${upErr.message}`,
    };
  }

  try {
    await adminDb.from('account_mapping_logs').insert({
      action: 'ADMIN_PASSWORD_RESET',
      user_profile_id: userId,
      member_id: null,
      pre_issued_name: displayName,
      pre_issued_phone: null,
      mapping_status: null,
      matched_by: null,
      candidate_type: null,
      reason: 'ADMIN_PASSWORD_RESET_TO_LOGIN_CODE',
      admin_id: null,
      metadata: {
        login_code: loginCode,
        // 비밀번호 원문은 기록하지 않음
        password_policy: 'PHONE_LAST8',
      },
    });
  } catch {
    // 감사 로그 실패는 본 작업 실패로 보지 않음
  }

  return {
    ok: true,
    user_id: userId,
    login_code: loginCode,
    display_name: displayName,
    email,
    password_hint: resetPassword,
  };
}
