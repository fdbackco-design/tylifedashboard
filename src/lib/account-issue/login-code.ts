/**
 * 계정 로그인 ID 파싱. 클라이언트/서버 공용 (server-only 없음).
 * 기존 8자리 숫자와 신규 fed+8자리를 함께 지원한다.
 */

export function extractAccountLoginCode(raw: string): string | null {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  const local = value.includes('@') ? value.split('@')[0]! : value;
  if (/^\d{8}$/.test(local)) return local;
  if (/^fed\d{8}$/i.test(local)) return local.toLowerCase();
  return null;
}

/**
 * 비밀번호는 항상 휴대폰 010 제외 뒤 8자리.
 * fed 계정은 전화번호가 없으면 login_code 숫자 8자리를 쓴다.
 */
export function passwordFromPhoneLast8(loginCode: string, phone?: string | null): string | null {
  if (/^\d{8}$/.test(loginCode)) return loginCode;
  if (!/^fed\d{8}$/i.test(loginCode)) return null;
  const phoneDigits = String(phone ?? '').replace(/\D/g, '');
  if (phoneDigits.length >= 8) {
    const last8 = phoneDigits.slice(-8);
    if (/^\d{8}$/.test(last8)) return last8;
  }
  const fromLogin = loginCode.slice(3);
  return /^\d{8}$/.test(fromLogin) ? fromLogin : null;
}

/**
 * 8자리만 입력된 경우 fed+8자리 계정도 이어서 찾는다.
 * 정확한 입력(fed…)은 그 값만 조회한다.
 */
export function loginCodeLookupCandidates(loginCode: string): string[] {
  if (/^\d{8}$/.test(loginCode)) return [loginCode, `fed${loginCode}`];
  return [loginCode];
}
