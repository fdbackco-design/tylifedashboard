import type { NoticeDisplayStatus } from './types';

function getSeoulYmd(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function getNoticeDisplayStatus(row: {
  is_draft: boolean;
  is_stopped: boolean;
  publish_start: string | null;
  publish_end: string | null;
}): NoticeDisplayStatus {
  if (row.is_draft) return 'draft';
  if (row.is_stopped) return 'stopped';
  const today = getSeoulYmd();
  const start = row.publish_start?.slice(0, 10) ?? null;
  const end = row.publish_end?.slice(0, 10) ?? null;
  if (start && start > today) return 'scheduled';
  if (end && end < today) return 'stopped';
  return 'published';
}

export const NOTICE_STATUS_LABEL: Record<NoticeDisplayStatus, string> = {
  draft: '임시저장',
  scheduled: '예약',
  published: '게시중',
  stopped: '게시중지',
};

export function formatNoticeDateYmd(isoOrDate: string | null): string {
  if (!isoOrDate) return '';
  const ymd = isoOrDate.slice(0, 10);
  const [y, m, d] = ymd.split('-');
  if (!y || !m || !d) return ymd;
  return `${y}.${m}.${d}`;
}
