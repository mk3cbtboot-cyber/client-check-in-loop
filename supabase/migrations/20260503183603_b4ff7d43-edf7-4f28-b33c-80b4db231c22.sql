ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS phase integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS avocado_count_week integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS egg_count_week integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS water_today_litres numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS water_date date NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS meal_streak integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS week_reset_date date NOT NULL DEFAULT (date_trunc('week', CURRENT_DATE)::date);

ALTER TABLE public.clients ADD CONSTRAINT clients_phase_check CHECK (phase IN (1,2,3));
