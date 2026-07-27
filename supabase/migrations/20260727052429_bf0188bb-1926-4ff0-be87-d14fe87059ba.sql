WITH d(dname, p, c, f) AS (
  VALUES
    ('Cooked Chicken Breast, sliced or diced', 31.0, 0.0, 3.6),
    ('Cooked Quinoa', 4.0, 21.0, 2.0),
    ('Arugula or Baby Kale', 3.0, 4.0, 1.0),
    ('Raw Unsalted Pecans, roughly chopped', 9.0, 14.0, 72.0),
    ('Cold-Pressed Extra-Virgin Olive Oil', 0.0, 0.0, 100.0),
    ('Fresh Lemon Juice', 0.0, 7.0, 0.0),
    ('Dijon Mustard', 3.0, 5.0, 0.0),
    ('Raw Honey', 0.0, 82.0, 0.0),
    ('Ground Turkey (Meat mixture serving: 100g)', 27.0, 0.0, 10.0),
    ('Sliced Bell Peppers', 1.0, 5.0, 0.0),
    ('Yellow Onion, chopped', 1.1, 9.3, 0.1),
    ('Garlic Clove, minced', 6.4, 33.0, 0.5),
    ('Cumin', 17.8, 44.0, 22.0),
    ('Oregano', 3.0, 16.0, 1.0),
    ('Cilantro, chopped', 2.0, 4.0, 0.0),
    ('Small Soft Corn Tortilla Shells', 5.7, 44.0, 1.8),
    ('Fresh or Frozen Blueberries', 1.0, 14.0, 0.0),
    ('Plain Fat Free Greek Yoghurt', 10.0, 4.0, 0.0),
    ('Plain Unsweetened Oat Milk', 0.3, 6.7, 1.5),
    ('Gluten-Free Rolled Oats', 13.0, 68.0, 7.0),
    ('Pure Maple Syrup', 0.0, 67.0, 0.0),
    ('Fat Free Cottage Cheese', 16.0, 8.0, 1.0),
    ('Chicken Breast', 30.0, 0.0, 8.0),
    ('Olive Oil', 0.0, 0.0, 100.0),
    ('Small Garlic Clove', 6.4, 33.0, 0.5),
    ('Steamed Rapini or Broccolini, or other green vegetables of your choice', 3.0, 6.0, 0.0)
)
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
             AND d.dname IS NOT NULL
            THEN e.it || jsonb_build_object(
              'density_protein_per_100g', d.p,
              'density_carbs_per_100g', d.c,
              'density_fat_per_100g', d.f,
              'density_source', 'usda_backfill'
            )
            ELSE e.it
          END ORDER BY e.ord), '[]'::jsonb)
        FROM jsonb_array_elements(je.v) WITH ORDINALITY e(it, ord)
        LEFT JOIN d ON d.dname = e.it->>'name'
      ) ELSE je.v END)
     FROM jsonb_each(c.food_list) je(k, v)) AS new_list
  FROM public.clients c
  WHERE c.food_list IS NOT NULL AND jsonb_typeof(c.food_list) = 'object'
) sub
WHERE cl.id = sub.id AND sub.new_list IS NOT NULL AND cl.food_list IS DISTINCT FROM sub.new_list;