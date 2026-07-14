
WITH keyed AS (
  SELECT pr.id, pr.practitioner_id, pr.created_at,
         lower(pr.name) AS n,
         COALESCE((
           SELECT string_agg(DISTINCT lower(trim(x->>'food')), '|' ORDER BY lower(trim(x->>'food')))
           FROM jsonb_array_elements(
             CASE jsonb_typeof(pr.ingredients) WHEN 'array' THEN pr.ingredients ELSE '[]'::jsonb END
           ) x
           WHERE trim(COALESCE(x->>'food','')) <> ''
         ), '') AS ing_key
  FROM public.practitioner_recipes pr
),
ranked AS (
  SELECT k.*,
         ROW_NUMBER() OVER (PARTITION BY k.practitioner_id, k.n, k.ing_key ORDER BY k.created_at ASC, k.id ASC) AS rn,
         COUNT(*) OVER (PARTITION BY k.practitioner_id, k.n, k.ing_key) AS grp_size,
         FIRST_VALUE(k.id) OVER (PARTITION BY k.practitioner_id, k.n, k.ing_key ORDER BY k.created_at ASC, k.id ASC) AS survivor_id
  FROM keyed k
),
mapping AS (
  SELECT id AS victim_id, survivor_id
  FROM ranked
  WHERE grp_size > 1 AND rn > 1
)
UPDATE public.client_recipe_assignments cra
SET recipe_id = m.survivor_id
FROM mapping m
WHERE cra.recipe_id = m.victim_id;

WITH keyed AS (
  SELECT pr.id, pr.practitioner_id, pr.created_at,
         lower(pr.name) AS n,
         COALESCE((
           SELECT string_agg(DISTINCT lower(trim(x->>'food')), '|' ORDER BY lower(trim(x->>'food')))
           FROM jsonb_array_elements(
             CASE jsonb_typeof(pr.ingredients) WHEN 'array' THEN pr.ingredients ELSE '[]'::jsonb END
           ) x
           WHERE trim(COALESCE(x->>'food','')) <> ''
         ), '') AS ing_key
  FROM public.practitioner_recipes pr
),
ranked AS (
  SELECT k.id,
         ROW_NUMBER() OVER (PARTITION BY k.practitioner_id, k.n, k.ing_key ORDER BY k.created_at ASC, k.id ASC) AS rn,
         COUNT(*) OVER (PARTITION BY k.practitioner_id, k.n, k.ing_key) AS grp_size
  FROM keyed k
)
DELETE FROM public.practitioner_recipes
WHERE id IN (SELECT id FROM ranked WHERE grp_size > 1 AND rn > 1);
