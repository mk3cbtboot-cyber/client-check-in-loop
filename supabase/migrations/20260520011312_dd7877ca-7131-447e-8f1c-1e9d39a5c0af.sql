
CREATE TABLE public.weekly_limit_acknowledgements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  week_start_date date NOT NULL,
  food_name text NOT NULL,
  limit_value numeric NOT NULL,
  per_serving_qty numeric NOT NULL,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, week_start_date, food_name)
);

ALTER TABLE public.weekly_limit_acknowledgements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Practitioners view own client acks"
ON public.weekly_limit_acknowledgements
FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.practitioner_id = auth.uid()));

CREATE POLICY "Practitioners manage own client acks"
ON public.weekly_limit_acknowledgements
FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.practitioner_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.practitioner_id = auth.uid()));

CREATE INDEX idx_wla_client_week ON public.weekly_limit_acknowledgements(client_id, week_start_date);
