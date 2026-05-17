ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS practitioner_notes text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS medical_conditions text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS current_medications text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS client_goal text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS vitamins_supplements text NOT NULL DEFAULT '';