ALTER TABLE public.notices
  ADD COLUMN IF NOT EXISTS push_sent_at timestamptz;
