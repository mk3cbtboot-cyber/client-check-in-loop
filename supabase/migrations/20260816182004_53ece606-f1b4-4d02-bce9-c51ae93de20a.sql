DO $$
DECLARE
  c RECORD;
  colours text[] := ARRAY['blue','green','orange'];
  labels text[] := ARRAY['Suggestion 1','Suggestion 2','Suggestion 3'];
  i int;
  meal text;
  opt jsonb;
  items jsonb;
  meals jsonb;
  suggestions jsonb;
  sugg jsonb;
  cat text;
  catkey text;
  lim jsonb;
  k text;
  seeded int := 0;
BEGIN
  FOR c IN SELECT id, mb_meal_options, food_limits, mb_plan FROM public.clients WHERE system_mode = 'mb' LOOP
    -- skip if a plan already exists with suggestions
    IF jsonb_typeof(c.mb_plan) = 'object' AND jsonb_typeof(c.mb_plan->'suggestions') = 'array' THEN
      CONTINUE;
    END IF;

    suggestions := '[]'::jsonb;
    FOR i IN 1..3 LOOP
      meals := '{}'::jsonb;
      FOREACH meal IN ARRAY ARRAY['breakfast','lunch','dinner'] LOOP
        items := '[]'::jsonb;
        opt := NULL;
        IF jsonb_typeof(c.mb_meal_options) = 'object'
           AND jsonb_typeof(c.mb_meal_options->meal) = 'array' THEN
          opt := c.mb_meal_options->meal->(i-1);
        END IF;

        IF opt IS NOT NULL AND jsonb_typeof(opt) = 'object' THEN
          cat := NULLIF(trim(coalesce(opt->>'protein_category','')), '');
          IF cat IS NOT NULL THEN
            catkey := CASE lower(cat)
              WHEN 'egg(s)' THEN 'fixed'
              WHEN 'eggs' THEN 'fixed'
              WHEN 'poultry' THEN 'poultry'
              WHEN 'meat' THEN 'meat'
              WHEN 'fish' THEN 'fish'
              WHEN 'seafood' THEN 'seafood'
              WHEN 'cheese' THEN 'cheese'
              WHEN 'yogurt' THEN 'yogurt'
              WHEN 'legumes' THEN 'legumes'
              WHEN 'milk' THEN 'milkProducts'
              WHEN 'milk products' THEN 'milkProducts'
              WHEN 'nuts' THEN 'nuts'
              ELSE ''
            END;
            items := items || jsonb_build_array(jsonb_build_object(
              'id', colours[i] || '-' || meal || '-protein',
              'category', catkey,
              'label', cat,
              'qty', CASE WHEN (opt->>'protein_grams') IS NULL THEN NULL ELSE (opt->>'protein_grams')::numeric END,
              'unit', CASE WHEN (opt->>'protein_grams') IS NULL THEN 'as_listed' ELSE 'g' END,
              'note', '',
              'optional', false
            ));
          END IF;

          IF (opt->>'veg_grams') IS NOT NULL THEN
            items := items || jsonb_build_array(jsonb_build_object(
              'id', colours[i] || '-' || meal || '-veg',
              'category', 'vegetables',
              'label', 'Vegetables',
              'qty', (opt->>'veg_grams')::numeric,
              'unit', 'g',
              'note', '',
              'optional', false
            ));
          END IF;

          IF coalesce((opt->>'has_fruit')::boolean, false) THEN
            items := items || jsonb_build_array(jsonb_build_object(
              'id', colours[i] || '-' || meal || '-fruit',
              'category', 'fruit', 'label', 'Fruit',
              'qty', NULL, 'unit', 'as_listed', 'note', 'as listed', 'optional', false));
          END IF;

          IF coalesce((opt->>'has_bread')::boolean, false) THEN
            items := items || jsonb_build_array(jsonb_build_object(
              'id', colours[i] || '-' || meal || '-bread',
              'category', 'bread', 'label', 'Bread',
              'qty', NULL, 'unit', 'as_listed', 'note', 'as listed', 'optional', false));
          END IF;
        END IF;

        meals := meals || jsonb_build_object(meal, jsonb_build_object('items', items, 'note', ''));
      END LOOP;

      sugg := jsonb_build_object('colour', colours[i], 'label', labels[i], 'meals', meals);
      suggestions := suggestions || jsonb_build_array(sugg);
    END LOOP;

    -- enriched caps from flat food_limits
    lim := '[]'::jsonb;
    IF jsonb_typeof(c.food_limits) = 'object' THEN
      FOR k IN SELECT jsonb_object_keys(c.food_limits) LOOP
        IF (c.food_limits->>k) ~ '^[0-9]+(\.[0-9]+)?$' THEN
          lim := lim || jsonb_build_array(jsonb_build_object(
            'id', 'limit-' || k,
            'food', k,
            'type', 'weekly',
            'min', NULL,
            'max', (c.food_limits->>k)::numeric
          ));
        END IF;
      END LOOP;
    END IF;

    UPDATE public.clients
      SET mb_plan = jsonb_build_object('version', 1, 'confirmed_at', NULL, 'suggestions', suggestions),
          mb_food_limits = CASE
            WHEN jsonb_typeof(mb_food_limits) = 'array' AND jsonb_array_length(mb_food_limits) > 0
              THEN mb_food_limits ELSE lim END
      WHERE id = c.id;
    seeded := seeded + 1;
  END LOOP;

  RAISE NOTICE 'seeded % MB clients', seeded;
END $$;