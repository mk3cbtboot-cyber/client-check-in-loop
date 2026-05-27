ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS gender text;
ALTER TABLE public.check_ins ADD COLUMN IF NOT EXISTS chest_cm numeric;