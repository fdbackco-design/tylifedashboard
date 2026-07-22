import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { upsertEnvVars } from './tylife-cookie-file';

loadEnvConfig(process.cwd());

function requireBaseUrl(): string {
  const raw = (process.env.TYLIFE_BASE_URL ?? '').trim();
  if (!raw) throw new Error('TYLIFE_BASE_URL 환경변수가 필요합니다.');
  return raw.replace(/\/+$/, '');
}

function profileDir(): string {
  return (
    (process.env.TYLIFE_PLAYWRIGHT_PROFILE_DIR ?? '').trim() ||
    path.join(process.cwd(), '.playwright', 'tylife-profile')
  );
}

function channel(): string {
  return (process.env.TYLIFE_PLAYWRIGHT_CHANNEL ?? '').trim() || 'chrome';
}

/**
 * 브라우저 세션이 살아있는지 `/contract/list`로 확인한다.
 * (Turnstile은 /auth 로그인 폼에만 붙으므로, 유효 세션이면 챌린지 없이 JSON을 받는다.)
 */
async function sessionIsValid(page: Page, base: string): Promise<boolean> {
  try {
    const result = await page.evaluate(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/contract/list`, {
        method: 'POST',
        credentials: 'include',
        redirect: 'follow',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ pageInfo: { page: '1', row_per_page: 1 } }),
      });
      return { url: response.url, text: await response.text() };
    }, base);

    const finalPath = new URL(result.url).pathname;
    if (finalPath === '/' || finalPath.startsWith('/auth')) return false;
    const parsed = JSON.parse(result.text) as { data?: { listHtml?: unknown } };
    return typeof parsed?.data?.listHtml === 'string';
  } catch {
    return false;
  }
}

export type HarvestedCookie = { cookieHeader: string; userAgent: string };

/**
 * 이미 로그인된 브라우저 컨텍스트에서 세션 쿠키(HttpOnly 포함)를 추출하여
 * `.env.local`의 TYLIFE_COOKIE / TYLIFE_USER_AGENT를 갱신하고, process.env에도 반영한다.
 */
export async function harvestAndSave(
  context: BrowserContext,
  page: Page,
  base: string,
): Promise<HarvestedCookie> {
  const userAgent = await page.evaluate(() => navigator.userAgent);

  // base URL로 전송될 쿠키만 가져온다(HttpOnly 포함). 다른 도메인 쿠키는 자동 제외된다.
  // 유효성은 특정 쿠키 이름이 아니라 호출부의 sessionIsValid(/contract/list)로 판단한다.
  const cookies = await context.cookies(base);
  if (cookies.length === 0) {
    throw new Error(`${base} 로 전송할 쿠키가 없습니다. 브라우저 로그인 상태를 확인하세요.`);
  }

  const cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');

  await upsertEnvVars({ TYLIFE_COOKIE: cookieHeader, TYLIFE_USER_AGENT: userAgent });
  process.env.TYLIFE_COOKIE = cookieHeader;
  process.env.TYLIFE_USER_AGENT = userAgent;

  return { cookieHeader, userAgent };
}

/**
 * 퍼시스턴트 프로필을 열어 신선한 세션 쿠키를 추출·저장한다.
 *
 * - interactive=false(기본): headless로 조용히 갱신. 세션이 만료됐으면 null 반환(기존 쿠키 유지).
 * - interactive=true(`--login`): 헤드풀 브라우저를 띄워 사람이 로그인·Turnstile을 완료할 때까지 대기.
 */
export async function refreshTyLifeCookie(
  options: { interactive?: boolean } = {},
): Promise<HarvestedCookie | null> {
  const base = requireBaseUrl();
  const interactive = options.interactive ?? false;

  const context = await chromium.launchPersistentContext(profileDir(), {
    channel: channel(),
    headless: !interactive,
    chromiumSandbox: true,
    viewport: { width: 1440, height: 960 },
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`${base}/contract/`, { waitUntil: 'domcontentloaded' });

    if (!(await sessionIsValid(page, base))) {
      if (!interactive) {
        console.error(
          '[tylife-cookie] 세션이 만료되었습니다. `npm run tylife:login`으로 브라우저 로그인을 다시 완료해 주세요.',
        );
        return null;
      }
      console.log('[tylife-cookie] 열린 브라우저에서 로그인과 Turnstile 인증을 완료해 주세요...');
      await page.waitForURL(
        (url) => url.pathname.startsWith('/contract') && !url.pathname.startsWith('/auth'),
        { timeout: 0 },
      );
      if (!(await sessionIsValid(page, base))) {
        throw new Error('로그인 후에도 세션 검증에 실패했습니다. 다시 시도해 주세요.');
      }
    }

    return await harvestAndSave(context, page, base);
  } finally {
    await context.close();
  }
}

async function main(): Promise<void> {
  const interactive = process.argv.includes('--login') || process.argv.includes('-i');
  const result = await refreshTyLifeCookie({ interactive });
  if (!result) {
    process.exitCode = 1;
    return;
  }
  console.log(
    `[tylife-cookie] .env.local의 TYLIFE_COOKIE를 갱신했습니다 (${result.cookieHeader.length}자).`,
  );
}

// 다른 스크립트에서 import할 때는 main()을 실행하지 않는다.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('[tylife-cookie] 실패:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
