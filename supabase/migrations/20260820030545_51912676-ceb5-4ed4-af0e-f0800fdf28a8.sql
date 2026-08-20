CREATE TABLE public.mb_cap_ledger (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  day date NOT NULL,
  meal text NOT NULL,
  food text NOT NULL,
  qty numeric NOT NULL DEFAULT 1,
  run_started_on date,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT mb_cap_ledger_unique_entry UNIQUE (client_id, day, meal, food)
);

CREATE INDEX mb_cap_ledger_week_idx ON public.mb_cap_ledger (client_id, week_start);

GRANT SELECT ON public.mb_cap_ledger TO authenticated;
GRANT ALL ON public.mb_cap_ledger TO service_role;

ALTER TABLE public.mb_cap_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Practitioners can view their clients' cap ledger"
ON public.mb_cap_ledger
FOR SELECT
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.clients c
  WHERE c.id = mb_cap_ledger.client_id
    AND c.practitioner_id = auth.uid()
));