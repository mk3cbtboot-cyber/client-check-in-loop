CREATE TABLE public.treat_meals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  eaten_on DATE NOT NULL,
  week_start DATE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX treat_meals_client_week_unique ON public.treat_meals (client_id, week_start);
CREATE INDEX treat_meals_client_idx ON public.treat_meals (client_id, eaten_on DESC);

ALTER TABLE public.treat_meals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Practitioners manage own client treat meals"
ON public.treat_meals
FOR ALL
TO authenticated
USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = treat_meals.client_id AND c.practitioner_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = treat_meals.client_id AND c.practitioner_id = auth.uid()));
