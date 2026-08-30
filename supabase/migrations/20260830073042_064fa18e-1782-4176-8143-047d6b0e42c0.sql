CREATE OR REPLACE FUNCTION public.match_nutrition_kb(_q text, _limit integer DEFAULT 2)
RETURNS TABLE (slug text, title text, summary text, body text, score real)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT k.slug, k.title, k.summary, k.body,
         GREATEST(
           similarity(k.title, _q),
           similarity(k.summary, _q),
           similarity(array_to_string(k.keywords, ' '), _q)
         )::real AS score
  FROM public.nutrition_coaching_kb k
  ORDER BY score DESC
  LIMIT GREATEST(COALESCE(_limit, 2), 1);
$$;

REVOKE ALL ON FUNCTION public.match_nutrition_kb(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_nutrition_kb(text, integer) TO service_role;