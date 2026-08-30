UPDATE public.clients c
SET mb_plan = jsonb_set(
  c.mb_plan,
  '{suggestions}',
  (
    SELECT jsonb_agg(
      jsonb_set(
        s,
        '{meals}',
        (
          SELECT jsonb_object_agg(
            m.key,
            jsonb_set(
              m.value,
              '{items}',
              (
                SELECT COALESCE(jsonb_agg(
                  CASE
                    WHEN i->>'category' = 'nuts' AND lower(i->>'label') = 'pumpkin seeds'
                      THEN jsonb_set(i, '{category}', '"pumpkinSeeds"')
                    WHEN i->>'category' = 'nuts' AND lower(i->>'label') = 'sunflower seeds'
                      THEN jsonb_set(i, '{category}', '"sunflowerSeeds"')
                    ELSE i
                  END
                  ORDER BY io
                ), '[]'::jsonb)
                FROM jsonb_array_elements(
                  CASE WHEN jsonb_typeof(m.value->'items') = 'array' THEN m.value->'items' ELSE '[]'::jsonb END
                ) WITH ORDINALITY AS t(i, io)
              )
            )
            ORDER BY m.key
          )
          FROM jsonb_each(CASE WHEN jsonb_typeof(s->'meals') = 'object' THEN s->'meals' ELSE '{}'::jsonb END) AS m
        )
      )
      ORDER BY so
    )
    FROM jsonb_array_elements(c.mb_plan->'suggestions') WITH ORDINALITY AS q(s, so)
  )
)
WHERE jsonb_typeof(c.mb_plan->'suggestions') = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(c.mb_plan->'suggestions') s,
         jsonb_each(CASE WHEN jsonb_typeof(s->'meals') = 'object' THEN s->'meals' ELSE '{}'::jsonb END) m,
         jsonb_array_elements(CASE WHEN jsonb_typeof(m.value->'items') = 'array' THEN m.value->'items' ELSE '[]'::jsonb END) i
    WHERE i->>'category' = 'nuts'
      AND lower(i->>'label') IN ('pumpkin seeds', 'sunflower seeds')
  );