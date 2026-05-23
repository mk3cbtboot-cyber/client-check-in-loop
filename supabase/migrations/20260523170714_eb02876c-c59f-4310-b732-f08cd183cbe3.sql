CREATE TABLE public.daily_water_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  log_date date NOT NULL,
  litres numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, log_date)
);

CREATE INDEX idx_daily_water_logs_client_date ON public.daily_water_logs (client_id, log_date DESC);

ALTER TABLE public.daily_water_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Practitioners view daily water for own clients"
ON public.daily_water_logs
FOR SELECT
TO authenticated
USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = daily_water_logs.client_id AND c.practitioner_id = auth.uid()));