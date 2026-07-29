/**
 * 관리자: 기존 계정은 login_code, fed 계정은 등록된 휴대폰 전체 숫자로 비밀번호 초기화.
 * - @tylifedashboard.local 가짜 메일이라 email recover 불가 → Auth Admin API 사용
 * - 비밀번호 원문은 로그/감사에 저장하지 않음
 */

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

const EMAIL_DOMAIN = 'tylifedashboard.local';

export type ResetPasswordResult =
  | {
      ok: true;
      user_id: string;
      login_code: string;
      display_name: string | null;
      email: string;
    }
  | {
      ok: false;
      code: 'INVALID_INPUT' | 'NOT_FOUND' | 'AUTH_UPDATE_FAILED' | 'PROFILE_UPDATE_FAILED';
      message: string;
    };

/** 8자리 숫자 또는 email local-part 에서 login_code 추출 */
export function extractLoginCode8(raw: string): string | null {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  const local = v.includes('@') ? v.split('@')[0]! : v;
  const digits = local.replace(/\D/g, '');
  if (/^\d{8}$/.test(digits)) return digits;
  if (/^\d{8}$/.test(local)) return local;
  return null;
}

export function extractAccountLoginCode(raw: string): string | null {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  const local = value.includes('@') ? value.split('@')[0]! : value;
  if (/^\d{8}$/.test(local)) return local;
  if (/^fed\d{8}$/i.test(local)) return local.toLowerCase();
  return null;
}

export async function resetMemberPasswordToLoginCode(
  adminDb: SupabaseClient,
  loginIdRaw: string,
): Promise<ResetPasswordResult> {
  const loginCode = extractAccountLoginCode(loginIdRaw);
  if (!loginCode) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: '로그인 ID는 8자리 숫자 또는 fed+8자리여야 합니다.',
    };
  }

  const { data: profile, error: pErr } = await adminDb
    .from('user_profiles')
    .select('id, login_code, display_name, phone, is_active')
    .eq('login_code', loginCode)
    .maybeSingle();

  if (pErr) {
    return { ok: false, code: 'NOT_FOUND', message: `계정 조회 실패: ${pErr.message}` };
  }
  if (!profile?.id) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: `login_code=${loginCode} 계정을 찾을 수 없습니다.`,
    };
  }

  const userId = String((profile as { id: string }).id);
  const displayName = ((profile as { display_name?: string | null }).display_name ?? null) as string | null;
  const email = `${loginCode}@${EMAIL_DOMAIN}`;
  const phonePassword = String((profile as { phone?: string | null }).phone ?? '').replace(/\D/g, '');
  const resetPassword = loginCode.startsWith('fed') ? phonePassword : loginCode;
  if (loginCode.startsWith('fed') && !/^\d{10,11}$/.test(resetPassword)) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'fed 계정의 등록된 휴대폰번호가 없어 비밀번호를 초기화할 수 없습니다.',
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
        password_policy: loginCode.startsWith('fed') ? 'FULL_PHONE_DIGITS' : 'LOGIN_CODE',
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
  };
}
