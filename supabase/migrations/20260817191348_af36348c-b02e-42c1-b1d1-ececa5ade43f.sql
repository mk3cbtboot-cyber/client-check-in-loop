ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS mb_food_list jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS mb_run jsonb NOT NULL DEFAULT '{}'::jsonb;