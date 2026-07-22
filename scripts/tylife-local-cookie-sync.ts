import { loadEnvConfig } from '@next/env';
import { mkdir, readlink, rm, symlink } from 'node:fs/promises';
import path from 'node:path';

loadEnvConfig(process.cwd());

const LOCK_PATH = path.join(process.cwd(), '.playwright', 'tylife-local-cookie-sync.lock');

function requiredEnv(name: string): string {
  const value = (process.env[name] ?? '').trim();
  if (!value) throw new Error(`${name} 환경변수가 필요합니다.`);
  return value;
}

async function processIsRunning(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

async function acquireLock(): Promise<boolean> {
  await mkdir(path.dirname(LOCK_PATH), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // PID를 symlink 대상에 담으면 잠금 생성과 소유자 기록이 원자적으로 처리된다.
      await symlink(String(process.pid), LOCK_PATH);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const existingPid = Number.parseInt(await readlink(LOCK_PATH).catch(() => ''), 10);
      if (Number.isInteger(existingPid) && existingPid > 0 && (await processIsRunning(existingPid))) {
        console.log(`[tylife-local-cookie] 이미 동기화가 실행 중입니다 (pid=${existingPid}).`);
        return false;
      }
      await rm(LOCK_PATH, { force: true });
    }
  }
  throw new Error('동기화 잠금 파일을 생성할 수 없습니다.');
}

async function main(): Promise<void> {
  if (!(await acquireLock())) return;

  try {
    requiredEnv('NEXT_PUBLIC_SUPABASE_URL');
    requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
    requiredEnv('TYLIFE_BASE_URL');

    // 동기화 전에 퍼시스턴트 브라우저 프로필에서 세션 쿠키를 자동 갱신한다.
    // 세션이 살아있으면 Turnstile 없이 조용히 새 쿠키를 뽑아 .env.local과 process.env를 갱신하고,
    // 만료됐거나 프로필이 사용 중이면 실패해도 기존 TYLIFE_COOKIE로 그대로 진행한다.
    try {
      const { refreshTyLifeCookie } = await import('./tylife-refresh-cookie');
      const refreshed = await refreshTyLifeCookie({ interactive: false });
      if (refreshed) {
        console.log('[tylife-local-cookie] 세션 쿠키를 자동 갱신했습니다.');
      } else {
        console.warn(
          '[tylife-local-cookie] 쿠키 자동 갱신 실패 — 기존 TYLIFE_COOKIE로 진행합니다. ' +
            '(세션 만료 시 `npm run tylife:login` 실행)',
        );
      }
    } catch (error) {
      console.warn(
        '[tylife-local-cookie] 쿠키 자동 갱신 중 오류 — 기존 쿠키로 진행합니다:',
        error instanceof Error ? error.message : String(error),
      );
    }

    requiredEnv('TYLIFE_COOKIE');
    requiredEnv('TYLIFE_USER_AGENT');

    // 일반 Chrome에서 발급받은 쿠키를 반드시 사용한다.
    // ID/PW가 남아 있으면 client가 Turnstile 없는 서버 로그인을 우선하므로 비운다.
    process.env.TYLIFE_ID = '';
    process.env.TYLIFE_PW = '';
    process.env.TYLIFE_SESSION_COOKIE = '';

    const rowPerPage = Number.parseInt(process.env.TYLIFE_SYNC_PAGE_SIZE ?? '50', 10);
    const maxPageRaw = Number.parseInt(process.env.TYLIFE_LOCAL_SYNC_MAX_PAGE ?? '', 10);
    const { runSync } = await import('../src/lib/tylife/sync-service');

    console.log('[tylife-local-cookie] 일반 Chrome 세션으로 동기화를 시작합니다.');
    const result = await runSync({
      triggeredBy: 'local-chrome-cookie',
      rowPerPage: Number.isFinite(rowPerPage) && rowPerPage > 0 ? rowPerPage : 50,
      maxPage: Number.isFinite(maxPageRaw) && maxPageRaw > 0 ? maxPageRaw : undefined,
    });
    console.log('[tylife-local-cookie] 동기화 완료', result);
  } finally {
    await rm(LOCK_PATH, { force: true }).catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(
    '[tylife-local-cookie] 실패:',
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
