import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

// 세션 상태 이벤트를 타임스탬프와 함께 기록하는 append-only 로그.
// 기존 launchd 로그(tylife-launchd.log)에는 시각이 없어 "세션이 언제/몇 시간 만에 죽는지"를
// 알 수 없었다. 이 파일로 LOGIN → VALID … → EXPIRED 흐름을 시각과 함께 남겨 절대 만료
// 수명(로그인 시각 ~ 첫 EXPIRED 시각)을 정밀 측정한다.
//
// 형식(탭 구분):  "2026-07-23 10:04:41 KST\t<STATUS>\t<detail>"
//   STATUS = LOGIN | VALID | EXPIRED

const LOG_PATH = path.join(process.cwd(), '.playwright', 'tylife-session-probe.log');

/** 현재 시각을 Asia/Seoul "YYYY-MM-DD HH:mm:ss" 로 반환. */
export function nowKst(): string {
  // sv-SE 로케일은 "2026-07-23 10:04:41" 형태(24시간, 0-padded)를 준다.
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date());
}

/**
 * 세션 상태 이벤트를 타임스탬프와 함께 append 한다.
 * 로깅 실패가 동기화 본체를 막지 않도록 오류는 조용히 무시한다.
 */
export async function appendSessionEvent(status: string, detail = ''): Promise<void> {
  try {
    await mkdir(path.dirname(LOG_PATH), { recursive: true });
    const line = `${nowKst()} KST\t${status}${detail ? `\t${detail}` : ''}\n`;
    await appendFile(LOG_PATH, line, 'utf8');
  } catch {
    /* ignore logging failures */
  }
}

export { LOG_PATH as SESSION_PROBE_LOG_PATH };
