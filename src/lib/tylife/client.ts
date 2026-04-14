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

const TYLIFE_BASE_URL = process.env.TYLIFE_BASE_URL;
const TYLIFE_COOKIE = process.env.TYLIFE_COOKIE;
const RATE_LIMIT_MS = parseInt(process.env.TYLIFE_RATE_LIMIT_MS ?? '200', 10);
const MAX_RETRIES = parseInt(process.env.TYLIFE_MAX_RETRIES ?? '3', 10);

function assertEnv(): void {
  if (!TYLIFE_BASE_URL) throw new Error('TYLIFE_BASE_URL 환경변수가 설정되지 않았습니다.');
  if (!TYLIFE_COOKIE) throw new Error('TYLIFE_COOKIE 환경변수가 설정되지 않았습니다.');
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/** POST /contract/list 헤더 */
function buildListHeaders(): HeadersInit {
  return {
    'Content-Type': 'application/json; charset=UTF-8',
    Accept: '*/*',
    Origin: TYLIFE_BASE_URL!,
    Referer: `${TYLIFE_BASE_URL}/contract/`,
    'X-Requested-With': 'XMLHttpRequest',
    Cookie: TYLIFE_COOKIE!,
  };
}

/** GET /contract/{id} 헤더 */
function buildDetailHeaders(): HeadersInit {
  return {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ko-KR,ko;q=0.9',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    'Upgrade-Insecure-Requests': '1',
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Referer: `${TYLIFE_BASE_URL}/contract/`,
    Cookie: TYLIFE_COOKIE!,
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
      throw new Error(
        `TY Life 세션 만료 또는 접근 거부 (${res.status}). TYLIFE_COOKIE를 갱신하세요.`,
      );
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

  const res = await fetchWithRetry(`${TYLIFE_BASE_URL}/contract/list`, {
    method: 'POST',
    headers: buildListHeaders(),
    body: JSON.stringify({
      pageInfo: { page: String(page), row_per_page: rowPerPage },
    }),
  });

  if (!res.ok) {
    throw new Error(`fetchContractList 실패: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as TyLifeListApiResponse;
  await sleep(RATE_LIMIT_MS);
  return data;
}

/**
 * GET /contract/{externalId} — 상세 HTML.
 * externalId: goDetail(N) 에서 추출한 숫자 문자열.
 */
export async function fetchContractDetailHtml(externalId: string): Promise<string> {
  assertEnv();

  const res = await fetchWithRetry(
    `${TYLIFE_BASE_URL}/contract/${encodeURIComponent(externalId)}`,
    { method: 'GET', headers: buildDetailHeaders() },
  );

  if (!res.ok) {
    throw new Error(`fetchContractDetailHtml(${externalId}) 실패: ${res.status} ${res.statusText}`);
  }

  const html = await res.text();
  await sleep(RATE_LIMIT_MS);
  return html;
}
