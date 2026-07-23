import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import { chromium, type Page } from 'playwright';

loadEnvConfig(process.cwd());

function requiredEnv(name: string): string {
  const value = (process.env[name] ?? '').trim();
  if (!value) throw new Error(`${name} 환경변수가 필요합니다.`);
  return value;
}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function browserFetch(
  page: Page,
  request: { url: string; method: 'GET' | 'POST'; body?: string },
): Promise<{ status: number; url: string; contentType: string; text: string }> {
  return page.evaluate(async (input) => {
    const response = await fetch(input.url, {
      method: input.method,
      credentials: 'include',
      redirect: 'follow',
      headers:
        input.method === 'POST'
          ? {
              'Content-Type': 'application/json; charset=UTF-8',
              Accept: 'application/json, text/javascript, */*; q=0.01',
              'X-Requested-With': 'XMLHttpRequest',
            }
          : {
              Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
      body: input.method === 'POST' ? input.body : undefined,
    });
    return {
      status: response.status,
      url: response.url,
      contentType: response.headers.get('content-type') ?? 'text/plain; charset=utf-8',
      text: await response.text(),
    };
  }, request);
}

async function verifyBrowserSession(page: Page, remoteBaseUrl: string): Promise<void> {
  const probe = await browserFetch(page, {
    url: `${remoteBaseUrl}/contract/list`,
    method: 'POST',
    body: JSON.stringify({ pageInfo: { page: '1', row_per_page: 1 } }),
  });
  const finalPath = new URL(probe.url).pathname;
  if (finalPath === '/' || finalPath.startsWith('/auth')) {
    throw new Error('브라우저 세션이 TY Life 로그인 화면으로 이동했습니다. 브라우저에서 다시 로그인해 주세요.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(probe.text);
  } catch {
    throw new Error(`TY Life 목록 응답이 JSON이 아닙니다 (HTTP ${probe.status}, URL ${probe.url}).`);
  }
  const listHtml = (parsed as { data?: { listHtml?: unknown } })?.data?.listHtml;
  if (typeof listHtml !== 'string') {
    throw new Error('TY Life 목록 응답에서 data.listHtml을 찾지 못했습니다.');
  }
}

async function startLocalBridge(page: Page, remoteBaseUrl: string) {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
      const isList = req.method === 'POST' && requestUrl.pathname === '/contract/list';
      const isDetail = req.method === 'GET' && /^\/contract\/[^/]+$/.test(requestUrl.pathname);
      if (!isList && !isDetail) {
        res.statusCode = 404;
        res.end('not found');
        return;
      }

      const body = isList ? await readRequestBody(req) : undefined;
      const result = await browserFetch(page, {
        url: `${remoteBaseUrl}${requestUrl.pathname}`,
        method: isList ? 'POST' : 'GET',
        body,
      });
      const finalPath = new URL(result.url).pathname;
      if (finalPath === '/' || finalPath.startsWith('/auth')) {
        res.statusCode = 401;
        res.end('TY Life browser session expired');
        return;
      }
      res.statusCode = result.status;
      res.setHeader('content-type', result.contentType);
      res.end(result.text);
    } catch (error) {
      res.statusCode = 500;
      res.end(error instanceof Error ? error.message : String(error));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('로컬 브리지 포트를 확인할 수 없습니다.');

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

async function main(): Promise<void> {
  requiredEnv('NEXT_PUBLIC_SUPABASE_URL');
  requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  const remoteBaseUrl = requiredEnv('TYLIFE_BASE_URL').replace(/\/+$/, '');
  const profileDir =
    (process.env.TYLIFE_PLAYWRIGHT_PROFILE_DIR ?? '').trim() ||
    path.join(process.cwd(), '.playwright', 'tylife-profile');

  console.log(`[tylife-local] 브라우저 프로필: ${profileDir}`);
  const { tyLifeLaunchOptions } = await import('./tylife-refresh-cookie');
  const context = await chromium.launchPersistentContext(profileDir, {
    // macOS의 실제 Chrome 샌드박스를 사용하고, Turnstile이 자동화를 감지하지 못하도록
    // 자동화 은폐 플래그를 함께 적용한다(tyLifeLaunchOptions).
    ...tyLifeLaunchOptions(false),
  });
  const page = context.pages()[0] ?? (await context.newPage());
  let bridge: Awaited<ReturnType<typeof startLocalBridge>> | null = null;

  try {
    await page.goto(`${remoteBaseUrl}/contract/`, { waitUntil: 'domcontentloaded' });
    if (new URL(page.url()).pathname.startsWith('/auth')) {
      console.log('[tylife-local] 열린 브라우저에서 로그인과 Turnstile 인증을 완료해 주세요.');
      await page.waitForURL(
        (url) => {
          const pathname = url.pathname;
          return pathname.startsWith('/contract') && !pathname.startsWith('/auth');
        },
        { timeout: 0 },
      );
    }

    await verifyBrowserSession(page, remoteBaseUrl);
    console.log('[tylife-local] 브라우저 세션 확인 완료');

    // 헤드풀 로그인으로 확보한 세션 쿠키를 .env.local에 저장해 두면,
    // launchd 무인 동기화(sync:tylife-local-cookie)도 같은 쿠키로 이어서 동작한다.
    try {
      const { harvestAndSave } = await import('./tylife-refresh-cookie');
      const saved = await harvestAndSave(context, page, remoteBaseUrl);
      console.log(`[tylife-local] 세션 쿠키를 .env.local에 저장했습니다 (${saved.cookieHeader.length}자).`);
    } catch (error) {
      console.warn(
        '[tylife-local] 쿠키 저장 실패 — 브리지 동기화는 계속 진행합니다:',
        error instanceof Error ? error.message : String(error),
      );
    }

    bridge = await startLocalBridge(page, remoteBaseUrl);
    process.env.TYLIFE_BASE_URL = bridge.baseUrl;
    process.env.TYLIFE_COOKIE = 'PLAYWRIGHT_LOCAL_BRIDGE=1';
    process.env.TYLIFE_SESSION_COOKIE = '';
    process.env.TYLIFE_ID = '';
    process.env.TYLIFE_PW = '';
    process.env.TYLIFE_USER_AGENT = await page.evaluate(() => navigator.userAgent);

    const rowPerPage = Number.parseInt(process.env.TYLIFE_SYNC_PAGE_SIZE ?? '50', 10);
    const maxPageRaw = Number.parseInt(process.env.TYLIFE_LOCAL_SYNC_MAX_PAGE ?? '', 10);
    const { runSync } = await import('../src/lib/tylife/sync-service');
    const result = await runSync({
      triggeredBy: 'playwright-local',
      rowPerPage: Number.isFinite(rowPerPage) && rowPerPage > 0 ? rowPerPage : 50,
      maxPage: Number.isFinite(maxPageRaw) && maxPageRaw > 0 ? maxPageRaw : undefined,
    });
    console.log('[tylife-local] 동기화 완료', result);
  } finally {
    if (bridge) await bridge.close().catch(() => undefined);
    await context.close();
  }
}

main().catch((error) => {
  console.error('[tylife-local] 실패:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
