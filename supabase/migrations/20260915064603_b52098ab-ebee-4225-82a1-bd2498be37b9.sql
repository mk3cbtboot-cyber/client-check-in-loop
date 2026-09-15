ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS checkin_metrics jsonb NOT NULL DEFAULT '{}'::jsonb;