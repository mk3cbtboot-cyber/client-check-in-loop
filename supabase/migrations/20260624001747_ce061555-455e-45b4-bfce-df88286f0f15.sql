
CREATE TABLE public.client_recipe_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  recipe_id uuid NOT NULL REFERENCES public.practitioner_recipes(id) ON DELETE CASCADE,
  meal_slot text NOT NULL,
  portion_overrides jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_recipe_assignments TO authenticated;
GRANT ALL ON public.client_recipe_assignments TO service_role;

ALTER TABLE public.client_recipe_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Practitioners manage own client recipe assignments"
  ON public.client_recipe_assignments
  FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.practitioner_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.practitioner_id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.practitioner_recipes r WHERE r.id = recipe_id AND r.practitioner_id = auth.uid())
  );

CREATE INDEX client_recipe_assignments_client_idx ON public.client_recipe_assignments(client_id, meal_slot);
