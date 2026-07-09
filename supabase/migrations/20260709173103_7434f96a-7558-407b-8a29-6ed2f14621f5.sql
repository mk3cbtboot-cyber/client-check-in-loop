UPDATE public.clients
SET food_list = jsonb_set(
  food_list,
  '{dinner}',
  (
    SELECT jsonb_agg(
      CASE WHEN lower(elem->>'name') = 'white rice'
        THEN elem
          || jsonb_build_object(
            'est_calories', 195,
            'est_protein_g', 4,
            'est_carbs_g', 43,
            'est_fat_g', 0,
            'density_protein_per_100g', 2.6666666666666665,
            'density_carbs_per_100g', 28.666666666666668,
            'density_fat_per_100g', 0
          )
        ELSE elem
      END
    )
    FROM jsonb_array_elements(food_list->'dinner') elem
  )
)
WHERE id = 'a5cd5628-b185-49d0-9263-822813ba1585';