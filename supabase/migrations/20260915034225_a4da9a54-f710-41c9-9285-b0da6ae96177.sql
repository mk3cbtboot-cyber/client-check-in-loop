ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS checkin_cadence text NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS checkin_cadence_anchor date;

ALTER TABLE public.clients
  ADD CONSTRAINT clients_checkin_cadence_check
  CHECK (checkin_cadence IN ('auto','daily','weekly','biweekly','none'));