ALTER TABLE public.weekly_meal_plans
  ADD COLUMN IF NOT EXISTS breakfast_locked_recipe jsonb,
  ADD COLUMN IF NOT EXISTS lunch_locked_recipe jsonb,
  ADD COLUMN IF NOT EXISTS dinner_locked_recipe jsonb,
  ADD COLUMN IF NOT EXISTS breakfast_locked_recipe_alt jsonb,
  ADD COLUMN IF NOT EXISTS lunch_locked_recipe_alt jsonb,
  ADD COLUMN IF NOT EXISTS dinner_locked_recipe_alt jsonb,
  ADD COLUMN IF NOT EXISTS breakfast_primary_log_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lunch_primary_log_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dinner_primary_log_count integer NOT NULL DEFAULT 0;