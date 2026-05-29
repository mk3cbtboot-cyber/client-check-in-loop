ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS client_last_read_at timestamptz,
  ADD COLUMN IF NOT EXISTS practitioner_last_read_at timestamptz;