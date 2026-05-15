import { NOTICE_CATEGORIES, NOTICE_MAX_FILE_BYTES, NOTICE_MAX_PINNED } from './constants';
import type { NoticeCategory } from './constants';

export function parseNoticeCategory(v: unknown): NoticeCategory | null {
  const s = String(v ?? '').trim();
  return (NOTICE_CATEGORIES as readonly string[]).includes(s) ? (s as NoticeCategory) : null;
}

export function parseOptionalDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  const s = String(v).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

export function isAllowedUploadMime(mime: string): boolean {
  const m = mime.toLowerCase();
  if (m === 'application/pdf') return true;
  if (m.startsWith('image/')) return true;
  if (m === 'text/plain') return true;
  if (m.includes('word') || m.includes('excel') || m.includes('spreadsheet') || m.includes('document'))
    return true;
  if (m.startsWith('application/vnd.')) return true;
  return false;
}

export async function assertPinnedLimit(
  db: { from: (t: string) => any },
  opts: { isPinned: boolean; excludeId?: string },
): Promise<string | null> {
  if (!opts.isPinned) return null;
  let q = db.from('notices').select('id', { count: 'exact', head: true }).eq('is_pinned', true);
  if (opts.excludeId) q = q.neq('id', opts.excludeId);
  const { count, error } = await q;
  if (error) return error.message;
  if ((count ?? 0) >= NOTICE_MAX_PINNED) {
    return `상단 고정은 최대 ${NOTICE_MAX_PINNED}건까지 가능합니다.`;
  }
  return null;
}

export { NOTICE_MAX_FILE_BYTES };
