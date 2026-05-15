ALTER TABLE public.notices
  ADD COLUMN IF NOT EXISTS view_count integer NOT NULL DEFAULT 0;
