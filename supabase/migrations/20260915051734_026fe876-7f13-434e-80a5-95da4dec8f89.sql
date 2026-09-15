ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS checkin_weekday smallint,
  ADD COLUMN IF NOT EXISTS checkin_weekday_effective_from date;

ALTER TABLE public.clients
  DROP CONSTRAINT IF EXISTS clients_checkin_weekday_check;
ALTER TABLE public.clients
  ADD CONSTRAINT clients_checkin_weekday_check
  CHECK (checkin_weekday IS NULL OR (checkin_weekday >= 0 AND checkin_weekday <= 6));