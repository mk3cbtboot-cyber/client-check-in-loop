REVOKE EXECUTE ON FUNCTION public.match_nutrition_kb(text, integer) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_nutrition_kb(text, integer) TO service_role;