CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE public.nutrition_coaching_kb (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  keywords text[] NOT NULL DEFAULT '{}',
  body text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.nutrition_coaching_kb TO service_role;

ALTER TABLE public.nutrition_coaching_kb ENABLE ROW LEVEL SECURITY;

CREATE INDEX nutrition_kb_title_trgm ON public.nutrition_coaching_kb USING gin (title gin_trgm_ops);
CREATE INDEX nutrition_kb_summary_trgm ON public.nutrition_coaching_kb USING gin (summary gin_trgm_ops);
CREATE INDEX nutrition_kb_keywords_gin ON public.nutrition_coaching_kb USING gin (keywords);

CREATE TRIGGER nutrition_coaching_kb_updated_at
BEFORE UPDATE ON public.nutrition_coaching_kb
FOR EACH ROW EXECUTE FUNCTION public.touch_weekly_meal_plans_updated_at();