ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS meals_per_day INTEGER NOT NULL DEFAULT 3 CHECK (meals_per_day IN (3,4,5));

ALTER TABLE public.clients ALTER COLUMN food_list SET DEFAULT '{"breakfast":[],"morning_snack":[],"lunch":[],"afternoon_snack":[],"dinner":[]}'::jsonb;
ALTER TABLE public.clients ALTER COLUMN food_list_notes SET DEFAULT '{"breakfast":"","morning_snack":"","lunch":"","afternoon_snack":"","dinner":""}'::jsonb;

UPDATE public.clients
SET food_list = COALESCE(food_list, '{}'::jsonb)
  || jsonb_build_object(
    'morning_snack', COALESCE(food_list->'morning_snack', '[]'::jsonb),
    'afternoon_snack', COALESCE(food_list->'afternoon_snack', '[]'::jsonb)
  );

UPDATE public.clients
SET food_list_notes = COALESCE(food_list_notes, '{}'::jsonb)
  || jsonb_build_object(
    'morning_snack', COALESCE(food_list_notes->'morning_snack', '""'::jsonb),
    'afternoon_snack', COALESCE(food_list_notes->'afternoon_snack', '""'::jsonb)
  );