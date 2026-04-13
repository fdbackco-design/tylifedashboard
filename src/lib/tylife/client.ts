/**
 * TY Life 외부 시스템 API 클라이언트.
 * 서버 전용 — 브라우저에서 직접 호출 금지.
 * 세션 쿠키는 TYLIFE_SESSION_COOKIE 환경변수로만 관리.
 */

import type { TyLifeListRequest, TyLifeListResponse } from '../types/sync';

const TYLIFE_BASE_URL = process.env.TYLIFE_BASE_URL;
const TYLIFE_SESSION_COOKIE = process.env.TYLIFE_SESSION_COOKIE;
const RATE_LIMIT_MS = parseInt(
  process.env.TYLIFE_SYNC_RATE_LIMIT_MS ?? '500',
  10,
);
const MAX_RETRIES = parseInt(process.env.TYLIFE_SYNC_MAX_RETRIES ?? '3', 10);

function assertServerEnv(): void {
  if (!TYLIFE_BASE_URL) {
    throw new Error('TYLIFE_BASE_URL 환경변수가 설정되지 않았습니다.');
  }
  if (!TYLIFE_SESSION_COOKIE) {
    throw new Error(
      'TYLIFE_SESSION_COOKIE 환경변수가 설정되지 않았습니다.',
    );
  }
}

/** 지수 백오프 대기 */
async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** 리스트 API 헤더 (POST /contract/list) */
function buildListHeaders(): HeadersInit {
  return {
    'Content-Type': 'application/json; charset=UTF-8',
    Accept: '*/*',
    Origin: TYLIFE_BASE_URL!,
    Referer: `${TYLIFE_BASE_URL}/contract/`,
    'X-Requested-With': 'XMLHttpRequest',
    Cookie: TYLIFE_SESSION_COOKIE!,
  };
}

/** 상세 페이지 헤더 (GET /contract/{id}) */
function buildDetailHeaders(): HeadersInit {
  return {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    'Upgrade-Insecure-Requests': '1',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Referer: `${TYLIFE_BASE_URL}/contract/`,
    Cookie: TYLIFE_SESSION_COOKIE!,
  };
}

/**
 * fetch + 재시도 래퍼.
 * 실패 시 지수 백오프(500ms, 1s, 2s...)로 MAX_RETRIES 회 재시도.
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  attempt = 1,
): Promise<Response> {
  try {
    const res = await fetch(url, options);

    if (res.status === 401 || res.status === 403) {
      // 세션 만료 → 재시도해도 의미 없음
      throw new Error(
        `TY Life 세션 만료 또는 접근 거부 (${res.status}). 쿠키를 갱신하세요.`,
      );
    }

    if (!res.ok && attempt <= MAX_RETRIES) {
      const backoff = RATE_LIMIT_MS * Math.pow(2, attempt - 1);
      console.warn(
        `[tylife/client] HTTP ${res.status} — ${attempt}/${MAX_RETRIES}회 재시도 (${backoff}ms 대기)`,
      );
      await delay(backoff);
      return fetchWithRetry(url, options, attempt + 1);
    }

    return res;
  } catch (err) {
    if (attempt <= MAX_RETRIES && !(err instanceof Error && err.message.includes('세션'))) {
      const backoff = RATE_LIMIT_MS * Math.pow(2, attempt - 1);
      console.warn(`[tylife/client] 네트워크 오류 — ${attempt}/${MAX_RETRIES}회 재시도 (${backoff}ms 대기)`);
      await delay(backoff);
      return fetchWithRetry(url, options, attempt + 1);
    }
    throw err;
  }
}

// ─────────────────────────────────────────────
// 계약 목록 API
// ─────────────────────────────────────────────

/**
 * POST /contract/list
 * 페이지 단위 계약 목록 수집.
 */
export async function fetchContractList(
  page: number,
  rowPerPage = 50,
): Promise<TyLifeListResponse> {
  assertServerEnv();

  // TY Life API는 pageInfo 래퍼 구조 사용
  const body = { pageInfo: { page: String(page), row_per_page: rowPerPage } };

  const res = await fetchWithRetry(`${TYLIFE_BASE_URL}/contract/list`, {
    method: 'POST',
    headers: buildListHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(
      `[tylife/client] fetchContractList 실패: ${res.status} ${res.statusText}`,
    );
  }

  const data = (await res.json()) as TyLifeListResponse;

  // rate limit 준수
  await delay(RATE_LIMIT_MS);

  return data;
}

/**
 * 전체 페이지 순회하며 계약 목록 수집.
 * 콜백으로 페이지별 진행 상황 전달.
 */
export async function fetchAllContractPages(
  rowPerPage = 50,
  onPage?: (page: number, total: number) => void,
): Promise<TyLifeListResponse['data']> {
  assertServerEnv();

  const all: TyLifeListResponse['data'] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const res = await fetchContractList(page, rowPerPage);
    all.push(...res.data);

    if (onPage) onPage(page, res.total);

    const totalPages = Math.ceil(res.total / rowPerPage);
    hasMore = page < totalPages;
    page++;
  }

  return all;
}

// ─────────────────────────────────────────────
// 계약 상세 HTML
// ─────────────────────────────────────────────

/**
 * GET /contract/{id}
 * 상세 HTML 원문 반환.
 */
export async function fetchContractDetailHtml(id: string): Promise<string> {
  assertServerEnv();

  const res = await fetchWithRetry(
    `${TYLIFE_BASE_URL}/contract/${encodeURIComponent(id)}`,
    {
      method: 'GET',
      headers: buildDetailHeaders(),
    },
  );

  if (!res.ok) {
    throw new Error(
      `[tylife/client] fetchContractDetailHtml(${id}) 실패: ${res.status} ${res.statusText}`,
    );
  }

  const html = await res.text();

  // rate limit 준수
  await delay(RATE_LIMIT_MS);

  return html;
}
