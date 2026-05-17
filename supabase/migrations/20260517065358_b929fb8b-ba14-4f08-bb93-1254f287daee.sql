ALTER TABLE public.recipes ADD COLUMN IF NOT EXISTS meal_type text;
CREATE INDEX IF NOT EXISTS idx_recipes_client_created ON public.recipes(client_id, created_at DESC);