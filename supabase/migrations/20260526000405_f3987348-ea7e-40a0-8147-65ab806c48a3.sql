ALTER TABLE public.clients
ADD COLUMN IF NOT EXISTS show_8_rules boolean NOT NULL DEFAULT false;

UPDATE public.clients
SET show_8_rules = COALESCE(show_rules, false)
WHERE show_8_rules IS DISTINCT FROM COALESCE(show_rules, false);