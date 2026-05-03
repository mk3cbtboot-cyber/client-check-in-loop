
CREATE TABLE public.recipes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prep_time TEXT NOT NULL,
  servings TEXT NOT NULL,
  ingredients JSONB NOT NULL DEFAULT '[]'::jsonb,
  instructions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Practitioners view recipes for own clients"
ON public.recipes FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = recipes.client_id AND c.practitioner_id = auth.uid()));

CREATE POLICY "Practitioners insert recipes for own clients"
ON public.recipes FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = recipes.client_id AND c.practitioner_id = auth.uid()));

CREATE POLICY "Practitioners delete recipes for own clients"
ON public.recipes FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = recipes.client_id AND c.practitioner_id = auth.uid()));

CREATE INDEX idx_recipes_client_id ON public.recipes(client_id);
