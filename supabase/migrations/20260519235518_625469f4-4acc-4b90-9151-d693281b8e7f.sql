CREATE TABLE public.weekly_meal_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  week_start_date date NOT NULL,
  breakfast_meal_id integer,
  lunch_meal_id integer,
  dinner_meal_id integer,
  breakfast_selections jsonb NOT NULL DEFAULT '{}'::jsonb,
  lunch_selections jsonb NOT NULL DEFAULT '{}'::jsonb,
  dinner_selections jsonb NOT NULL DEFAULT '{}'::jsonb,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, week_start_date)
);

ALTER TABLE public.weekly_meal_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Practitioners manage own client plans"
  ON public.weekly_meal_plans
  FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = weekly_meal_plans.client_id AND c.practitioner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = weekly_meal_plans.client_id AND c.practitioner_id = auth.uid()));

CREATE INDEX idx_weekly_meal_plans_client_week ON public.weekly_meal_plans (client_id, week_start_date DESC);

CREATE OR REPLACE FUNCTION public.touch_weekly_meal_plans_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_weekly_meal_plans_updated_at
  BEFORE UPDATE ON public.weekly_meal_plans
  FOR EACH ROW EXECUTE FUNCTION public.touch_weekly_meal_plans_updated_at();