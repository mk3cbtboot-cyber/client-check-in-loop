CREATE TABLE public.phase3_food_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  food_name text NOT NULL,
  ai_classification text NOT NULL DEFAULT 'whole_food' CHECK (ai_classification IN ('whole_food','processed_or_meal')),
  ai_reason text,
  status text NOT NULL DEFAULT 'pending_practitioner_review' CHECK (status IN ('pending_practitioner_review','approved','declined','needs_resubmit')),
  practitioner_note text,
  swap_suggestion text,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_phase3_food_requests_client ON public.phase3_food_requests(client_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.phase3_food_requests TO authenticated;
GRANT ALL ON public.phase3_food_requests TO service_role;

ALTER TABLE public.phase3_food_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Practitioners manage their clients' food requests"
ON public.phase3_food_requests FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = phase3_food_requests.client_id AND c.practitioner_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = phase3_food_requests.client_id AND c.practitioner_id = auth.uid()));

CREATE TRIGGER phase3_food_requests_updated_at
BEFORE UPDATE ON public.phase3_food_requests
FOR EACH ROW EXECUTE FUNCTION public.touch_weekly_meal_plans_updated_at();