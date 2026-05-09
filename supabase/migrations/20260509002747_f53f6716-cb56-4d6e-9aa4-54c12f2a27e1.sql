ALTER TABLE public.clients RENAME COLUMN phase3_grains_carbs TO phase3_starches;
ALTER TABLE public.clients ADD COLUMN phase3_bread text NOT NULL DEFAULT '';