ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS mb_plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS mb_food_limits jsonb NOT NULL DEFAULT '[]'::jsonb;