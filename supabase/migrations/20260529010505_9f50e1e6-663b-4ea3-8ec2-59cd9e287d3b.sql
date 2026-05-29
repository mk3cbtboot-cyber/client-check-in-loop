ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS office_hours jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS out_of_office boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ooo_message text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS ooo_return_date date,
  ADD COLUMN IF NOT EXISTS timezone text;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS deferred boolean NOT NULL DEFAULT false;