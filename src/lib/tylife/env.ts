/** TY Life 세션 쿠키 (레거시 `TYLIFE_SESSION_COOKIE` 별칭 지원) */

function normalizeTyLifeCookie(raw: string): string {
  let s = raw.trim();
  if (s.toLowerCase().startsWith('cookie:')) {
    s = s.slice('cookie:'.length).trim();
  }
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s.replace(/\r?\n/g, '').trim();
}

export function getTyLifeBaseUrl(): string | undefined {
  const raw = process.env.TYLIFE_BASE_URL?.trim();
  if (!raw) return undefined;
  return raw.replace(/\/+$/, '');
}

export function hasTyLifeCredentials(): boolean {
  return Boolean((process.env.TYLIFE_ID ?? '').trim() && (process.env.TYLIFE_PW ?? '').trim());
}

export function getTyLifeCookie(): string | undefined {
  const fromPrimary = process.env.TYLIFE_COOKIE;
  const fromLegacy = process.env.TYLIFE_SESSION_COOKIE;
  const raw = fromPrimary?.trim() ? fromPrimary : fromLegacy;
  if (!raw?.trim()) return undefined;
  return normalizeTyLifeCookie(raw);
}

export function assertTyLifeCookie(): string {
  const cookie = getTyLifeCookie();
  if (!cookie) {
    throw new Error(
      'TYLIFE_COOKIE(또는 TYLIFE_SESSION_COOKIE) 환경변수가 설정되지 않았습니다.',
    );
  }
  return cookie;
}

/** 디버그용 — 쿠키 값 자체는 노출하지 않음 */
export function describeTyLifeCookie(): {
  configured: boolean;
  length: number;
  names: string[];
  hasSession: boolean;
  hasConnectSid: boolean;
} {
  const cookie = getTyLifeCookie();
  if (!cookie) {
    return {
      configured: false,
      length: 0,
      names: [],
      hasSession: false,
      hasConnectSid: false,
    };
  }
  const names = cookie
    .split(';')
    .map((part) => part.trim().split('=')[0] ?? '')
    .filter(Boolean);
  return {
    configured: true,
    length: cookie.length,
    names,
    hasSession: names.includes('SESSION'),
    hasConnectSid: names.includes('connect.sid'),
  };
}
