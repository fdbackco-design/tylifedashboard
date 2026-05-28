import { NOTICE_STORAGE_BUCKET } from './constants';

function sanitizeStorageFileName(fileName: string): string {
  return fileName.replace(/[^\w.\-가-힣]/g, '_').slice(0, 180) || 'file';
}

export function noticeInlineStoragePath(noticeId: string, fileName: string): string {
  return `${noticeId}/inline/${Date.now()}_${sanitizeStorageFileName(fileName)}`;
}

export function noticeAttachmentStoragePath(noticeId: string, fileName: string): string {
  return `${noticeId}/${Date.now()}_${sanitizeStorageFileName(fileName)}`;
}

export function noticeInlineMediaUrl(noticeId: string, storagePath: string): string {
  return `/api/notices/${noticeId}/media?path=${encodeURIComponent(storagePath)}`;
}

export function isValidNoticeInlineStoragePath(noticeId: string, storagePath: string): boolean {
  const prefix = `${noticeId}/inline/`;
  return storagePath.startsWith(prefix) && !storagePath.includes('..');
}

export function isValidNoticeAttachmentStoragePath(noticeId: string, storagePath: string): boolean {
  const prefix = `${noticeId}/`;
  if (!storagePath.startsWith(prefix) || storagePath.includes('..')) return false;
  // 인라인 이미지 경로(`{id}/inline/...`)는 첨부파일이 아님
  return !storagePath.startsWith(`${noticeId}/inline/`);
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
