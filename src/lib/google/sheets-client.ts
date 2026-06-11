/**
 * Google Sheets v4 REST 최소 클라이언트.
 *
 * - 외부 의존성 없이 Node 내장 crypto 로 Service Account JWT 를 만들어 토큰 교환 후 호출한다.
 * - 사용 범위: spreadsheets.values.get / spreadsheets.values.update
 *
 * 환경변수:
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL  Service Account 이메일
 *   GOOGLE_PRIVATE_KEY            PEM 형식 개인키 (줄바꿈은 \n 으로 이스케이프된 값을 지원)
 */

import { createSign } from 'crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

/**
 * 단일 fetch 호출에 timeout 을 적용한다.
 * 외부 API 가 무한정 매달려서 serverless function 이 응답 없이 종료되는 케이스를 방지.
 */
async function fetchWithTimeout(
  input: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 20_000, ...rest } = init;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(input, { ...rest, signal: ac.signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      throw new Error(`외부 호출 timeout(${timeoutMs}ms)`);
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

function base64Url(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * Service Account 기반 OAuth2 access_token 을 발급받는다.
 * - 단순 in-memory 캐시(만료 60초 여유)
 */
let cachedToken: { token: string; expiresAtMs: number } | null = null;

export async function getServiceAccountAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAtMs - 60_000 > now) {
    return cachedToken.token;
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  if (!email) throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL 미설정');
  if (!rawKey) throw new Error('GOOGLE_PRIVATE_KEY 미설정');

  // .env 의 \\n 이스케이프와 큰따옴표 래핑을 모두 보정
  const privateKey = rawKey
    .replace(/^"+|"+$/g, '')
    .replace(/\\n/g, '\n');

  const iat = Math.floor(now / 1000);
  const exp = iat + 3600; // 최대 1시간

  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat,
    exp,
  };

  const headerB64 = base64Url(JSON.stringify(header));
  const payloadB64 = base64Url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKey);
  const jwt = `${signingInput}.${base64Url(signature)}`;

  const params = new URLSearchParams();
  params.set('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  params.set('assertion', jwt);

  const resp = await fetchWithTimeout(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
    timeoutMs: 15_000,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Google OAuth 토큰 발급 실패(${resp.status}): ${text.slice(0, 300)}`);
  }
  const json = (await resp.json()) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!json.access_token) {
    throw new Error(`Google OAuth 토큰 응답 오류: ${json.error_description || json.error || 'unknown'}`);
  }
  cachedToken = {
    token: json.access_token,
    expiresAtMs: now + (json.expires_in ?? 3600) * 1000,
  };
  return cachedToken.token;
}

/**
 * spreadsheets.values.get
 */
export async function sheetsValuesGet(
  spreadsheetId: string,
  range: string,
): Promise<string[][]> {
  const token = await getServiceAccountAccessToken();
  const url = `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS`;
  const resp = await fetchWithTimeout(url, {
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 20_000,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Sheets values.get 실패(${resp.status}): ${text.slice(0, 300)}`);
  }
  const json = (await resp.json()) as { values?: string[][] };
  return (json.values ?? []) as string[][];
}

export type SheetsUpdateResult = {
  updatedRange: string;
  updatedRows: number;
  updatedColumns: number;
  updatedCells: number;
};

/**
 * spreadsheets.values.update — 단일 셀/범위 갱신
 * 응답 메타(updatedRange/updatedRows/updatedCells)를 반환한다.
 */
export async function sheetsValuesUpdate(
  spreadsheetId: string,
  range: string,
  values: string[][],
): Promise<SheetsUpdateResult> {
  const token = await getServiceAccountAccessToken();
  const url =
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}` +
    `?valueInputOption=RAW&includeValuesInResponse=false`;
  const resp = await fetchWithTimeout(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ range, majorDimension: 'ROWS', values }),
    timeoutMs: 25_000,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Sheets values.update 실패(${resp.status}): ${text.slice(0, 300)}`);
  }
  const json = (await resp.json().catch(() => ({}))) as {
    updatedRange?: string;
    updatedRows?: number;
    updatedColumns?: number;
    updatedCells?: number;
  };
  return {
    updatedRange: json.updatedRange ?? '',
    updatedRows: json.updatedRows ?? 0,
    updatedColumns: json.updatedColumns ?? 0,
    updatedCells: json.updatedCells ?? 0,
  };
}

/** 편의: 단일 셀 갱신 */
export async function sheetsSetCell(
  spreadsheetId: string,
  cellA1: string,
  value: string,
): Promise<void> {
  await sheetsValuesUpdate(spreadsheetId, cellA1, [[value]]);
}
