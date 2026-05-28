import { NOTICE_STORAGE_BUCKET } from './constants';

export function noticeInlineStoragePath(noticeId: string, fileName: string): string {
  const safeName = fileName.replace(/[^\w.\-가-힣]/g, '_').slice(0, 180);
  return `${noticeId}/inline/${Date.now()}_${safeName}`;
}

export function noticeInlineMediaUrl(noticeId: string, storagePath: string): string {
  return `/api/notices/${noticeId}/media?path=${encodeURIComponent(storagePath)}`;
}

export function isValidNoticeInlineStoragePath(noticeId: string, storagePath: string): boolean {
  const prefix = `${noticeId}/inline/`;
  return storagePath.startsWith(prefix) && !storagePath.includes('..');
}

/** 본문 HTML에 허용할 최소 태그만 유지 */
export function sanitizeNoticeHtml(html: string): string {
  const trimmed = html.trim();
  if (!trimmed) return '';
  return trimmed
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

export async function removeNoticeInlineStorage(
  db: { storage: { from: (b: string) => { list: (p: string) => Promise<{ data: { name: string }[] | null }>; remove: (p: string[]) => Promise<unknown> } } },
  noticeId: string,
): Promise<void> {
  const prefix = `${noticeId}/inline`;
  const { data: items } = await db.storage.from(NOTICE_STORAGE_BUCKET).list(prefix);
  const paths = (items ?? []).map((f) => `${prefix}/${f.name}`);
  if (paths.length > 0) {
    await db.storage.from(NOTICE_STORAGE_BUCKET).remove(paths);
  }
}
