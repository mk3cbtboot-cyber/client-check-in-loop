-- Backfill the density model onto existing clients.food_list items.
-- Idempotent: only fills grams/densities that are missing, and derives densities
-- from the item's current absolute macros so numbers do not shift.

CREATE OR REPLACE FUNCTION public.food_item_grams(item jsonb)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  existing numeric;
  m text[];
  qty numeric;
  unit text;
  nm text := lower(coalesce(item->>'name', ''));
  oily boolean;
BEGIN
  BEGIN
    existing := (item->>'grams')::numeric;
  EXCEPTION WHEN OTHERS THEN existing := NULL;
  END;
  IF existing IS NOT NULL AND existing > 0 THEN
    RETURN existing;
  END IF;

  m := regexp_match(coalesce(item->>'portion', ''), '^\s*([0-9]+(?:[.][0-9]+)?)\s*(.*)$');
  IF m IS NULL THEN RETURN NULL; END IF;
  qty := m[1]::numeric;
  unit := lower(btrim(coalesce(m[2], '')));
  oily := nm ~ '(oil|butter|ghee|tallow|lard|margarine)';

  IF qty IS NULL OR qty <= 0 THEN RETURN NULL; END IF;

  IF unit = '' OR unit ~ '^(g|gram|grams|gr)\M' THEN RETURN qty; END IF;
  IF unit ~ '^kg' THEN RETURN qty * 1000; END IF;
  IF unit ~ '^ml' THEN RETURN qty * CASE WHEN oily THEN 0.92 ELSE 1 END; END IF;
  IF unit ~ '^(oz|ounce)' THEN RETURN qty * 28.35; END IF;
  IF unit ~ '^(lb|pound)' THEN RETURN qty * 453.6; END IF;
  IF unit ~ '^(tsp|teaspoon)' THEN RETURN qty * CASE WHEN oily THEN 4.5 ELSE 5 END; END IF;
  IF unit ~ '^(tbsp|tablespoon)' THEN RETURN qty * CASE WHEN oily THEN 13.6 ELSE 15 END; END IF;
  IF unit ~ '^cup' THEN RETURN qty * 240; END IF;
  IF unit ~ '^egg' THEN RETURN qty * CASE WHEN nm ~ 'white' THEN 33 ELSE 50 END; END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.food_item_with_density(item jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  g numeric := public.food_item_grams(item);
  p numeric;
  c numeric;
  f numeric;
  out_item jsonb := item;
BEGIN
  IF g IS NULL OR g <= 0 THEN
    RETURN item;
  END IF;

  IF (item->>'grams') IS NULL THEN
    out_item := jsonb_set(out_item, '{grams}', to_jsonb(round(g::numeric, 2)));
  END IF;

  IF (item ? 'density_protein_per_100g')
     AND (item ? 'density_carbs_per_100g')
     AND (item ? 'density_fat_per_100g') THEN
    RETURN out_item;
  END IF;

  BEGIN
    p := (item->>'est_protein_g')::numeric;
    c := (item->>'est_carbs_g')::numeric;
    f := (item->>'est_fat_g')::numeric;
  EXCEPTION WHEN OTHERS THEN RETURN out_item;
  END;

  IF p IS NULL OR c IS NULL OR f IS NULL THEN RETURN out_item; END IF;
  IF p = 0 AND c = 0 AND f = 0 THEN RETURN out_item; END IF;
  IF g < 1 THEN RETURN out_item; END IF;

  out_item := jsonb_set(out_item, '{density_protein_per_100g}', to_jsonb(round(p / g * 100, 4)));
  out_item := jsonb_set(out_item, '{density_carbs_per_100g}', to_jsonb(round(c / g * 100, 4)));
  out_item := jsonb_set(out_item, '{density_fat_per_100g}', to_jsonb(round(f / g * 100, 4)));
  out_item := jsonb_set(out_item, '{density_source}', to_jsonb('derived'::text));
  RETURN out_item;
END;
$$;

CREATE OR REPLACE FUNCTION public.food_list_with_density(fl jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT coalesce(
    jsonb_object_agg(
      slot.key,
      CASE
        WHEN jsonb_typeof(slot.value) = 'array' THEN (
          SELECT coalesce(jsonb_agg(public.food_item_with_density(elem) ORDER BY ord), '[]'::jsonb)
          FROM jsonb_array_elements(slot.value) WITH ORDINALITY AS t(elem, ord)
        )
        ELSE slot.value
      END
    ),
    fl
  )
  FROM jsonb_each(CASE WHEN jsonb_typeof(fl) = 'object' THEN fl ELSE '{}'::jsonb END) AS slot;
$$;

UPDATE public.clients
SET food_list = public.food_list_with_density(food_list)
WHERE food_list IS NOT NULL
  AND jsonb_typeof(food_list) = 'object'
  AND food_list::text <> '{}'
  AND public.food_list_with_density(food_list) IS DISTINCT FROM food_list;