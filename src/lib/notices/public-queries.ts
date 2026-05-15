import type { SupabaseClient } from '@supabase/supabase-js';
import type { NoticeCategory } from './constants';
import { getNoticeDisplayStatus, formatNoticeDateYmd } from './status';
import type { NoticeAttachmentRow, NoticeRow } from './types';
import { noticeContentSummary, rewriteNoticeContentForMember } from './content-utils';

export type PublishedNoticeListItem = {
  id: string;
  category: NoticeCategory;
  title: string;
  summary: string;
  created_at: string;
  display_date: string;
  is_pinned: boolean;
  is_new: boolean;
  is_important: boolean;
};

export type PublishedNoticeDetail = {
  id: string;
  category: NoticeCategory;
  title: string;
  content_html: string;
  created_at: string;
  display_date: string;
  view_count: number;
  attachments: NoticeAttachmentRow[];
  prev: { id: string; title: string } | null;
  next: { id: string; title: string } | null;
};

const NEW_DAYS = 7;

function isPublishedRow(row: NoticeRow): boolean {
  return getNoticeDisplayStatus(row) === 'published';
}

function isNewNotice(createdAt: string): boolean {
  const created = new Date(createdAt).getTime();
  const cutoff = Date.now() - NEW_DAYS * 24 * 60 * 60 * 1000;
  return created >= cutoff;
}

export function filterPublishedNotices(rows: NoticeRow[]): NoticeRow[] {
  return rows.filter(isPublishedRow);
}

export function mapPublishedListItem(row: NoticeRow): PublishedNoticeListItem {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    summary: noticeContentSummary(row.content),
    created_at: row.created_at,
    display_date: formatNoticeDateYmd(row.created_at),
    is_pinned: row.is_pinned,
    is_new: isNewNotice(row.created_at),
    is_important: row.category === '중요',
  };
}

export async function fetchPublishedNoticesForMember(db: SupabaseClient): Promise<NoticeRow[]> {
  const { data, error } = await db
    .from('notices')
    .select('*')
    .eq('is_draft', false)
    .eq('is_stopped', false)
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return filterPublishedNotices((data ?? []) as NoticeRow[]);
}

export async function fetchPublishedNoticeDetail(
  db: SupabaseClient,
  id: string,
  opts?: { incrementView?: boolean },
): Promise<PublishedNoticeDetail | null> {
  const all = await fetchPublishedNoticesForMember(db);
  const idx = all.findIndex((r) => r.id === id);
  if (idx < 0) return null;

  const row = all[idx]!;
  let viewCount = Number(row.view_count ?? 0);

  if (opts?.incrementView) {
    viewCount += 1;
    await db.from('notices').update({ view_count: viewCount }).eq('id', id);
  }

  const { data: attachments } = await db
    .from('notice_attachments')
    .select('*')
    .eq('notice_id', id)
    .order('created_at', { ascending: true });

  const older = idx + 1 < all.length ? all[idx + 1]! : null;
  const newer = idx > 0 ? all[idx - 1]! : null;

  return {
    id: row.id,
    category: row.category,
    title: row.title,
    content_html: rewriteNoticeContentForMember(row.content, row.id),
    created_at: row.created_at,
    display_date: formatNoticeDateYmd(row.created_at),
    view_count: viewCount,
    attachments: (attachments ?? []) as NoticeAttachmentRow[],
    prev: older ? { id: older.id, title: older.title } : null,
    next: newer ? { id: newer.id, title: newer.title } : null,
  };
}
