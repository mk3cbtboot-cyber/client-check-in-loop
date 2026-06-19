
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS phase3_lunch_protein_bonus integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS phase3_lunch_carb_bonus integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS phase3_portions_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS phase3_lunch_prompt_last_dismissed_on date;
