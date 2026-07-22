import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function envFilePath(): string {
  return path.join(process.cwd(), '.env.local');
}

/**
 * `.env.local`의 지정한 키 값을 갱신한다(없으면 파일 끝에 추가).
 * 나머지 라인·주석·순서는 그대로 보존한다.
 *
 * 값은 따옴표 없이 기록한다(기존 TYLIFE_COOKIE/TYLIFE_USER_AGENT와 동일한 형식).
 * 쿠키 헤더/UA에는 개행이 없으므로 dotenv가 라인 끝까지 값으로 읽어 안전하다.
 */
export async function upsertEnvVars(updates: Record<string, string>): Promise<void> {
  const file = envFilePath();

  let content = '';
  try {
    content = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    content = '';
  }

  const remaining = new Map(Object.entries(updates));
  const lines = content.split(/\r?\n/);

  const rewritten = lines.map((line) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (!match) return line;
    const key = match[1];
    if (!remaining.has(key)) return line;
    const value = remaining.get(key)!;
    remaining.delete(key);
    return `${key}=${value}`;
  });

  let output = rewritten.join('\n').replace(/\n+$/, '');
  for (const [key, value] of remaining) {
    output += `${output.length ? '\n' : ''}${key}=${value}`;
  }
  output += '\n';

  await writeFile(file, output, { encoding: 'utf8', mode: 0o600 });
}
