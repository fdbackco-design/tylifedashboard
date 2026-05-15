-- =========================================================
-- 공지사항 (notices) + 첨부파일 (notice_attachments)
-- 관리자 /admin/notice 전용
-- =========================================================

CREATE TABLE IF NOT EXISTS public.notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL CHECK (category IN ('일반', '중요', '웨비나', '승급')),
  title text NOT NULL,
  content text NOT NULL DEFAULT '',
  is_pinned boolean NOT NULL DEFAULT false,
  send_push boolean NOT NULL DEFAULT false,
  is_draft boolean NOT NULL DEFAULT true,
  is_stopped boolean NOT NULL DEFAULT false,
  publish_start date,
  publish_end date,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notices_created_at ON public.notices (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notices_category ON public.notices (category);
CREATE INDEX IF NOT EXISTS idx_notices_is_pinned ON public.notices (is_pinned) WHERE is_pinned = true;

CREATE TABLE IF NOT EXISTS public.notice_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notice_id uuid NOT NULL REFERENCES public.notices(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  file_size bigint NOT NULL DEFAULT 0,
  mime_type text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notice_attachments_notice_id ON public.notice_attachments (notice_id);

ALTER TABLE public.notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notice_attachments ENABLE ROW LEVEL SECURITY;

-- service_role(API)만 쓰므로 anon 정책은 없음. 추후 앱 조회용 SELECT 정책 추가 가능.

DROP TRIGGER IF EXISTS set_updated_at_notices ON public.notices;
CREATE TRIGGER set_updated_at_notices
  BEFORE UPDATE ON public.notices
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();

-- Storage bucket (비공개 — signed URL 또는 API 프록시로 제공)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'notice-attachments',
  'notice-attachments',
  false,
  10485760,
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain'
  ]
)
ON CONFLICT (id) DO NOTHING;
