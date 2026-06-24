
CREATE TYPE public.recipe_slot AS ENUM ('breakfast','morning_snack','lunch','afternoon_snack','dinner','any');

CREATE TABLE public.practitioner_recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practitioner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  ingredients jsonb NOT NULL DEFAULT '[]'::jsonb,
  method text NOT NULL DEFAULT '',
  default_slot public.recipe_slot NOT NULL DEFAULT 'any',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.practitioner_recipes TO authenticated;
GRANT ALL ON public.practitioner_recipes TO service_role;

ALTER TABLE public.practitioner_recipes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Practitioners manage own recipes"
  ON public.practitioner_recipes
  FOR ALL
  TO authenticated
  USING (auth.uid() = practitioner_id)
  WITH CHECK (auth.uid() = practitioner_id);

CREATE INDEX practitioner_recipes_practitioner_idx ON public.practitioner_recipes(practitioner_id, created_at DESC);

CREATE TRIGGER practitioner_recipes_set_updated_at
  BEFORE UPDATE ON public.practitioner_recipes
  FOR EACH ROW EXECUTE FUNCTION public.touch_weekly_meal_plans_updated_at();
