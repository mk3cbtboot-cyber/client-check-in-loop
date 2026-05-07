ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS weight_unit text NOT NULL DEFAULT 'kg';
ALTER TABLE public.check_ins ADD COLUMN IF NOT EXISTS water_litres numeric;