ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'scheduled',
  ADD COLUMN IF NOT EXISTS attended_at timestamptz,
  ADD COLUMN IF NOT EXISTS missed_flagged_at timestamptz;

CREATE INDEX IF NOT EXISTS appointments_client_status_idx ON public.appointments (client_id, status, scheduled_at);