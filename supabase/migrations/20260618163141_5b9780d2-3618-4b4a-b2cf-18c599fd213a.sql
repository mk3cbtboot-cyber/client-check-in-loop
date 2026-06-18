
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS food_limit_counts jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Merge eggs_max_per_week into weekly_food_limits as "eggs" key (only if not already set).
UPDATE public.clients
SET weekly_food_limits = COALESCE(weekly_food_limits, '{}'::jsonb)
  || jsonb_build_object('eggs', eggs_max_per_week)
WHERE eggs_max_per_week IS NOT NULL
  AND eggs_max_per_week > 0
  AND NOT (COALESCE(weekly_food_limits, '{}'::jsonb) ? 'eggs');

-- Migrate existing per-week counts into the new JSON field.
UPDATE public.clients
SET food_limit_counts = COALESCE(food_limit_counts, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
  'eggs', NULLIF(COALESCE(egg_count_week, 0), 0),
  'avocado', NULLIF(COALESCE(avocado_count_week, 0), 0)
))
WHERE COALESCE(egg_count_week, 0) > 0 OR COALESCE(avocado_count_week, 0) > 0;

ALTER TABLE public.clients RENAME COLUMN weekly_food_limits TO food_limits;
ALTER TABLE public.clients DROP COLUMN IF EXISTS eggs_max_per_week;
ALTER TABLE public.clients DROP COLUMN IF EXISTS avocado_count_week;
ALTER TABLE public.clients DROP COLUMN IF EXISTS egg_count_week;
