ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS weekly_food_limits jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.weekly_meal_plans
  ADD COLUMN IF NOT EXISTS breakfast_meal_id_alt integer,
  ADD COLUMN IF NOT EXISTS lunch_meal_id_alt integer,
  ADD COLUMN IF NOT EXISTS dinner_meal_id_alt integer,
  ADD COLUMN IF NOT EXISTS breakfast_selections_alt jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS lunch_selections_alt jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS dinner_selections_alt jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS breakfast_primary_days integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS lunch_primary_days integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS dinner_primary_days integer NOT NULL DEFAULT 7;