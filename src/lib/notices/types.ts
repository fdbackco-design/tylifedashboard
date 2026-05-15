import type { NoticeCategory } from './constants';

export type NoticeDisplayStatus = 'draft' | 'scheduled' | 'published' | 'stopped';

export type NoticeRow = {
  id: string;
  category: NoticeCategory;
  title: string;
  content: string;
  is_pinned: boolean;
  send_push: boolean;
  is_draft: boolean;
  is_stopped: boolean;
  publish_start: string | null;
  publish_end: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type NoticeAttachmentRow = {
  id: string;
  notice_id: string;
  storage_path: string;
  file_name: string;
  file_size: number;
  mime_type: string | null;
  created_at: string;
};

export type NoticeListItem = NoticeRow & {
  display_status: NoticeDisplayStatus;
  attachment_count: number;
};
