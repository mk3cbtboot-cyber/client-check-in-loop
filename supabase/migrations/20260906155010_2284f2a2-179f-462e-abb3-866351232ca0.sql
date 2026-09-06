ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS phase3_approved_foods jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.phase3_food_requests ADD COLUMN IF NOT EXISTS category text;