UPDATE public.clients cl
SET food_list = sub.new_list
FROM (
  SELECT c.id,
    (SELECT jsonb_object_agg(je.k,
      CASE WHEN jsonb_typeof(je.v) = 'array' THEN (
        SELECT COALESCE(jsonb_agg(
          CASE
            WHEN (e.it->>'grams') IS NOT NULL
             AND (e.it->>'density_protein_per_100g') IS NULL
             AND (e.it->>'name') = 'Fresh Berries of your choice, for topping'
            THEN e.it || jsonb_build_object(
              'density_protein_per_100g', 1.0,
              'density_carbs_per_100g', 12.0,
              'density_fat_per_100g', 0.3,
              'density_source', 'usda_backfill'
            )
            ELSE e.it
          END ORDER BY e.ord), '[]'::jsonb)
        FROM jsonb_array_elements(je.v) WITH ORDINALITY e(it, ord)
      ) ELSE je.v END)
     FROM jsonb_each(c.food_list) je(k, v)) AS new_list
  FROM public.clients c
  WHERE c.food_list IS NOT NULL AND jsonb_typeof(c.food_list) = 'object'
) sub
WHERE cl.id = sub.id AND cl.food_list IS DISTINCT FROM sub.new_list;