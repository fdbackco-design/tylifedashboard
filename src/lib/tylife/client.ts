/**
 * TY Life 외부 시스템 HTTP 클라이언트.
 * 서버 전용 — 브라우저에서 직접 호출 금지.
 *
 * 환경변수:
 *   TYLIFE_BASE_URL          - 기본 URL (예: https://n.ty-life.co.kr)
 *   TYLIFE_COOKIE            - 세션 쿠키 전체 문자열
 *   TYLIFE_RATE_LIMIT_MS     - 요청 간 대기 ms (기본 500)
 *   TYLIFE_MAX_RETRIES       - 재시도 횟수 (기본 3)
 */

import type { TyLifeListApiResponse } from '../types/sync';
import { assertTyLifeCookie, describeTyLifeCookie, getTyLifeBaseUrl } from './env';

const RATE_LIMIT_MS = parseInt(process.env.TYLIFE_RATE_LIMIT_MS ?? '200', 10);
const MAX_RETRIES = parseInt(process.env.TYLIFE_MAX_RETRIES ?? '3', 10);

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function tylifeBaseUrl(): string {
  const base = getTyLifeBaseUrl();
  if (!base) throw new Error('TYLIFE_BASE_URL 환경변수가 설정되지 않았습니다.');
  return base;
}

function assertEnv(): void {
  tylifeBaseUrl();
  assertTyLifeCookie();
}

function tyLifeCookie(): string {
  return assertTyLifeCookie();
}

function sessionExpiredMessage(extra?: string): string {
  const hint = extra ? ` (${extra})` : '';
  return `TY Life 세션이 유효하지 않습니다${hint}. 브라우저에서 n.ty-life.co.kr 로그인 후 Cookie 헤더 전체를 TYLIFE_COOKIE에 넣고, Vercel Production 환경에 저장한 뒤 재배포하세요.`;
}

async function parseTyLifeListJson(res: Response): Promise<TyLifeListApiResponse> {
  const text = await res.text();
  const trimmed = text.trimStart();
  if (
    trimmed.startsWith('<') ||
    trimmed.toLowerCase().startsWith('<!doctype') ||
    trimmed.toLowerCase().startsWith('<html')
  ) {
    throw new Error(sessionExpiredMessage(`HTTP ${res.status}, HTML 응답`));
  }
  try {
    return JSON.parse(text) as TyLifeListApiResponse;
  } catch {
    throw new Error(sessionExpiredMessage(`HTTP ${res.status}, JSON 파싱 실패`));
  }
}

export type TyLifeSessionProbe = {
  ok: boolean;
  baseUrl: string | null;
  cookie: ReturnType<typeof describeTyLifeCookie>;
  httpStatus: number;
  contentType: string | null;
  isJson: boolean;
  isHtml: boolean;
  redirectLocation: string | null;
  bodyPreview: string;
  hint: string;
};

/** 관리자 진단: 쿠키 값은 반환하지 않음 */
export async function probeTyLifeSession(): Promise<TyLifeSessionProbe> {
  const baseUrl = getTyLifeBaseUrl() ?? null;
  const cookie = describeTyLifeCookie();

  if (!baseUrl || !cookie.configured) {
    return {
      ok: false,
      baseUrl,
      cookie,
      httpStatus: 0,
      contentType: null,
      isJson: false,
      isHtml: false,
      redirectLocation: null,
      bodyPreview: '',
      hint: !baseUrl
        ? 'TYLIFE_BASE_URL을 설정하세요 (예: https://n.ty-life.co.kr).'
        : 'TYLIFE_COOKIE(또는 TYLIFE_SESSION_COOKIE)를 설정하세요.',
    };
  }

  const res = await fetch(`${baseUrl}/contract/list`, {
    method: 'POST',
    headers: buildListHeaders(),
    body: JSON.stringify({
      pageInfo: { page: '1', row_per_page: 10 },
    }),
    redirect: 'manual',
  });

  const redirectLocation = res.headers.get('location');
  if (res.status >= 300 && res.status < 400) {
    return {
      ok: false,
      baseUrl,
      cookie,
      httpStatus: res.status,
      contentType: res.headers.get('content-type'),
      isJson: false,
      isHtml: false,
      redirectLocation,
      bodyPreview: '',
      hint: `로그인 리다이렉트(${res.status})입니다. 쿠키가 만료되었거나 서버에 잘못 붙여넣었을 수 있습니다. Vercel Production에 저장 후 재배포했는지 확인하세요.`,
    };
  }

  const text = await res.text();
  const trimmed = text.trimStart();
  const isHtml =
    trimmed.startsWith('<') ||
    trimmed.toLowerCase().startsWith('<!doctype') ||
    trimmed.toLowerCase().startsWith('<html');
  let isJson = false;
  if (!isHtml && trimmed) {
    try {
      JSON.parse(text);
      isJson = true;
    } catch {
      isJson = false;
    }
  }

  const ok = res.ok && isJson;
  let hint = 'TY Life API 연결 정상입니다.';
  if (!cookie.hasSession) {
    hint = '쿠키에 SESSION 항목이 없습니다. Network 탭의 Cookie 헤더 전체를 복사했는지 확인하세요.';
  } else if (cookie.length < 200) {
    hint = '쿠키 길이가 비정상적으로 짧습니다. 잘린 값이 아닌지 확인하세요.';
  } else if (isHtml) {
    hint =
      'HTML 로그인 페이지가 반환되었습니다. 쿠키 갱신·재배포가 필요하거나 Preview 환경 변수만 바꾼 경우일 수 있습니다.';
  } else if (!res.ok) {
    hint = `HTTP ${res.status} 오류입니다.`;
  } else if (!isJson) {
    hint = '응답이 JSON이 아닙니다.';
  }

  return {
    ok,
    baseUrl,
    cookie,
    httpStatus: res.status,
    contentType: res.headers.get('content-type'),
    isJson,
    isHtml,
    redirectLocation,
    bodyPreview: trimmed.slice(0, 120),
    hint,
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/** POST /contract/list 헤더 */
function buildListHeaders(): HeadersInit {
  const base = tylifeBaseUrl();
  return {
    'Content-Type': 'application/json; charset=UTF-8',
    Accept: 'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    Origin: base,
    Referer: `${base}/contract/`,
    'User-Agent': BROWSER_USER_AGENT,
    'X-Requested-With': 'XMLHttpRequest',
    Cookie: tyLifeCookie(),
  };
}

/** GET /contract/{id} 헤더 */
function buildDetailHeaders(): HeadersInit {
  const base = tylifeBaseUrl();
  return {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ko-KR,ko;q=0.9',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    'Upgrade-Insecure-Requests': '1',
    'User-Agent': BROWSER_USER_AGENT,
    Referer: `${base}/contract/`,
    Cookie: tyLifeCookie(),
  };
}

/** fetch + 지수 백오프 재시도 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  attempt = 1,
): Promise<Response> {
  try {
    const res = await fetch(url, options);

    if (res.status === 401 || res.status === 403) {
      throw new Error(sessionExpiredMessage(String(res.status)));
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location') ?? '';
      throw new Error(sessionExpiredMessage(`redirect ${res.status} → ${loc}`));
    }

    if (!res.ok && attempt <= MAX_RETRIES) {
      const wait = RATE_LIMIT_MS * Math.pow(2, attempt - 1);
      console.warn(`[tylife] HTTP ${res.status} — ${attempt}/${MAX_RETRIES}회 재시도 (${wait}ms)`);
      await sleep(wait);
      return fetchWithRetry(url, options, attempt + 1);
    }

    return res;
  } catch (err) {
    const isSession = err instanceof Error && err.message.includes('세션');
    if (!isSession && attempt <= MAX_RETRIES) {
      const wait = RATE_LIMIT_MS * Math.pow(2, attempt - 1);
      await sleep(wait);
      return fetchWithRetry(url, options, attempt + 1);
    }
    throw err;
  }
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/**
 * POST /contract/list — 단일 페이지 응답.
 * 파싱은 html-parser.ts 에서 담당.
 */
export async function fetchContractList(
  page: number,
  rowPerPage = 50,
): Promise<TyLifeListApiResponse> {
  assertEnv();

  const base = tylifeBaseUrl();
  const res = await fetchWithRetry(`${base}/contract/list`, {
    method: 'POST',
    headers: buildListHeaders(),
    body: JSON.stringify({
      pageInfo: { page: String(page), row_per_page: rowPerPage },
    }),
    redirect: 'manual',
  });

  if (!res.ok) {
    throw new Error(`fetchContractList 실패: ${res.status} ${res.statusText}`);
  }

  const data = await parseTyLifeListJson(res);
  await sleep(RATE_LIMIT_MS);
  return data;
}

/**
 * GET /contract/{externalId} — 상세 HTML.
 * externalId: goDetail(N) 에서 추출한 숫자 문자열.
 */
export async function fetchContractDetailHtml(externalId: string): Promise<string> {
  assertEnv();

  const base = tylifeBaseUrl();
  const res = await fetchWithRetry(
    `${base}/contract/${encodeURIComponent(externalId)}`,
    { method: 'GET', headers: buildDetailHeaders(), redirect: 'manual' },
  );

  if (!res.ok) {
    throw new Error(`fetchContractDetailHtml(${externalId}) 실패: ${res.status} ${res.statusText}`);
  }

  const html = await res.text();
  await sleep(RATE_LIMIT_MS);
  return html;
}
