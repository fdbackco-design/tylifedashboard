import { getTyLifeBaseUrl } from './env';

export type TyLifeLoginResult = {
  cookieHeader: string;
  cookieNames: string[];
};

function requireBaseUrl(): string {
  const base = getTyLifeBaseUrl();
  if (!base) throw new Error('TYLIFE_BASE_URL 환경변수가 설정되지 않았습니다.');
  return base;
}

function requireCredentials(): { id: string; pw: string } {
  const id = (process.env.TYLIFE_ID ?? '').trim();
  const pw = (process.env.TYLIFE_PW ?? '').trim();
  if (!id || !pw) {
    throw new Error('TYLIFE_ID / TYLIFE_PW 환경변수가 설정되지 않았습니다.');
  }
  return { id, pw };
}

function extractCookiesFromSetCookie(setCookieHeaders: string[]): string[] {
  // set-cookie: "NAME=value; Path=/; HttpOnly; ..."
  // → "NAME=value"만 추출
  const pairs: string[] = [];
  for (const sc of setCookieHeaders) {
    const first = String(sc ?? '').split(';')[0]?.trim();
    if (!first) continue;
    // 같은 쿠키가 여러 번 내려오면 마지막 것을 우선하도록 뒤에서 덮어씀
    const name = first.split('=')[0]?.trim();
    if (!name) continue;
    const idx = pairs.findIndex((p) => p.startsWith(`${name}=`));
    if (idx >= 0) pairs[idx] = first;
    else pairs.push(first);
  }
  return pairs;
}

function getSetCookieHeaders(res: Response): string[] {
  // Next.js/undici 환경: Headers.getSetCookie()가 있는 경우가 많다.
  const anyHeaders = res.headers as unknown as { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === 'function') {
    return anyHeaders.getSetCookie();
  }
  // 표준 fetch: 단일 set-cookie만 get() 가능 (복수면 합쳐질 수 있음)
  const sc = res.headers.get('set-cookie');
  if (!sc) return [];
  // 안전상 쉼표 분리는 위험(Expires=Wed, ... 때문에). 일단 단일 헤더로 취급.
  return [sc];
}

/**
 * TY Life에 서버에서 직접 로그인하여 새 쿠키를 발급받는다.
 *
 * IMPORTANT:
 * - 로그인 엔드포인트/페이로드는 TY Life 구현에 따라 다를 수 있어 placeholder로 둔다.
 * - 아래 URL/바디를 실제 네트워크 탭에서 확인한 값으로 교체해야 한다.
 */
export async function loginToTYLife(): Promise<TyLifeLoginResult> {
  const base = requireBaseUrl();
  const { id, pw } = requireCredentials();

  // TY Life Network 탭 기준: POST https://n.ty-life.co.kr/auth (XHR, 200 JSON)
  const loginUrl = `${base}/auth`;

  // Network 탭에서 content-length가 짧고(예: 44), Content-Type이 JSON으로도 보이지만
  // 서버 구현에 따라 form-urlencoded일 수 있어, 우선 form 방식으로 맞춘다.
  // Network 탭 payload 기준 필드명
  const body = new URLSearchParams({ empId: id, empPswd: pw }).toString();

  const res = await fetch(loginUrl, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      accept: '*/*',
      origin: base,
      referer: `${base}/auth/`,
      // 브라우저와 유사한 UA가 필요한 경우를 대비해 환경변수로 오버라이드 가능
      'user-agent':
        (process.env.TYLIFE_USER_AGENT ?? '').trim() ||
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
      'x-requested-with': 'XMLHttpRequest',
    },
    body,
  });

  // 로그인 성공/실패 판정은 서비스마다 다르다.
  // 일단 set-cookie가 내려오지 않으면 실패로 본다.
  const setCookieHeaders = getSetCookieHeaders(res);
  const cookiePairs = extractCookiesFromSetCookie(setCookieHeaders);

  if (cookiePairs.length === 0) {
    const loc = res.headers.get('location');
    const preview = (await res.text().catch(() => '')).trimStart().slice(0, 200);
    throw new Error(
      `TY Life 로그인 실패: set-cookie가 없습니다 (HTTP ${res.status}${loc ? `, location=${loc}` : ''}). ` +
        `id/pw 또는 로그인 정책을 확인하세요. 응답 미리보기: ${preview}`,
    );
  }

  // 일부 서비스는 로그인 직후 리다이렉트를 타며 쿠키가 세팅되기도 한다.
  // redirect: 'manual' 이므로 302일 수 있지만, 쿠키만 받았으면 다음 호출에서 유효할 수 있다.
  const cookieHeader = cookiePairs.join('; ');
  const cookieNames = cookiePairs.map((p) => p.split('=')[0] ?? '').filter(Boolean);

  return { cookieHeader, cookieNames };
}

