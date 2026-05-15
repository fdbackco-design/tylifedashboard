export const NOTICE_CATEGORIES = ['일반', '중요', '웨비나', '승급'] as const;
export type NoticeCategory = (typeof NOTICE_CATEGORIES)[number];

export const NOTICE_MAX_PINNED = 3;
export const NOTICE_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const NOTICE_PAGE_SIZE = 10;

export const NOTICE_ALLOWED_MIME_PREFIXES = [
  'application/pdf',
  'image/',
  'application/msword',
  'application/vnd.',
  'text/plain',
] as const;

export const NOTICE_STORAGE_BUCKET = 'notice-attachments';
