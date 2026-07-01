/** TY Life 세션 쿠키 (레거시 `TYLIFE_SESSION_COOKIE` 별칭 지원) */
export function getTyLifeCookie(): string | undefined {
  const fromPrimary = process.env.TYLIFE_COOKIE?.trim();
  if (fromPrimary) return fromPrimary;
  const fromLegacy = process.env.TYLIFE_SESSION_COOKIE?.trim();
  if (fromLegacy) return fromLegacy;
  return undefined;
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
