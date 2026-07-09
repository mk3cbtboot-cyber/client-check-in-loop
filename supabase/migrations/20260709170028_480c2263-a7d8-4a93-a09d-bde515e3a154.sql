
UPDATE public.clients
SET food_list = $json$
{
  "breakfast": [
    {"category":"Veg","est_calories":0,"est_carbs_g":5,"est_fat_g":0,"est_protein_g":1,"name":"Bell Peppers","portion":"100g"},
    {"category":"Veg","est_calories":0,"est_carbs_g":2,"est_fat_g":1,"est_protein_g":3,"name":"Spinach","portion":"100g"},
    {"category":"Carbs","est_calories":292,"est_carbs_g":50.8,"est_fat_g":4.9,"est_protein_g":9.9,"name":"Oats","portion":"75g"},
    {"category":"Protein","est_calories":210,"est_carbs_g":0.9,"est_fat_g":14.3,"est_protein_g":18.9,"name":"Whole Egg","portion":"3 eggs"},
    {"category":"Protein","est_calories":52,"est_carbs_g":0.7,"est_fat_g":0.2,"est_protein_g":11,"name":"Liquid Egg Whites","portion":"100g"}
  ],
  "morning_snack": [
    {"category":"Veg","est_calories":25,"est_carbs_g":3,"est_fat_g":1,"est_protein_g":4,"name":"Broccoli","portion":"100g"},
    {"category":"Veg","est_calories":35,"est_carbs_g":8,"est_fat_g":0,"est_protein_g":1,"name":"Carrots","portion":"100g"},
    {"category":"Carbs","est_calories":205,"est_carbs_g":48,"est_fat_g":0,"est_protein_g":4,"name":"Sweet Potato","portion":"270g"},
    {"category":"Protein","est_calories":236,"est_carbs_g":0,"est_fat_g":9,"est_protein_g":36,"name":"Chicken Breast","portion":"120g"},
    {"category":"Fat","est_calories":0,"est_carbs_g":4,"est_fat_g":10,"est_protein_g":1,"name":"Avocado","portion":"50g"}
  ],
  "lunch": [
    {"category":"Veg","est_calories":22,"est_carbs_g":4,"est_fat_g":0,"est_protein_g":2,"name":"Asparagus","portion":"100g"},
    {"category":"Veg","est_calories":35,"est_carbs_g":8,"est_fat_g":0,"est_protein_g":2,"name":"Green Beans","portion":"100g"},
    {"category":"Carbs","est_calories":221,"est_carbs_g":47,"est_fat_g":1,"est_protein_g":5,"name":"Brown Rice","portion":"150g"},
    {"category":"Protein","est_calories":143,"est_carbs_g":0,"est_fat_g":0,"est_protein_g":35,"name":"Cod","portion":"170g"},
    {"category":"Fat","est_calories":159,"est_carbs_g":0,"est_fat_g":18,"est_protein_g":0,"name":"Olive Oil","portion":"4 tsp"}
  ],
  "afternoon_snack": [
    {"category":"Veg","est_calories":0,"est_carbs_g":6,"est_fat_g":0,"est_protein_g":1,"name":"Cucumber","portion":"100g"},
    {"category":"Veg","est_calories":0,"est_carbs_g":5,"est_fat_g":0,"est_protein_g":2,"name":"Zucchini","portion":"100g"},
    {"category":"Carbs","est_calories":274,"est_carbs_g":53,"est_fat_g":5,"est_protein_g":11,"name":"Quinoa","portion":"250g"},
    {"category":"Protein","est_calories":147,"est_carbs_g":0,"est_fat_g":2,"est_protein_g":30,"name":"Turkey Breast","portion":"100g"},
    {"category":"Fat","est_calories":119,"est_carbs_g":0,"est_fat_g":14,"est_protein_g":0,"name":"Olive Oil (estimated)","portion":"3 tsp"}
  ],
  "dinner": [
    {"category":"Veg","est_calories":36,"est_carbs_g":7,"est_fat_g":1,"est_protein_g":3,"name":"Brussels Sprouts","portion":"100g"},
    {"category":"Veg","est_calories":0,"est_carbs_g":4,"est_fat_g":0,"est_protein_g":1,"name":"Tomato","portion":"100g"},
    {"category":"Carbs","est_calories":239,"est_carbs_g":47,"est_fat_g":2,"est_protein_g":9,"name":"Whole Wheat Pasta","portion":"150g"},
    {"category":"Protein","est_calories":277,"est_carbs_g":0,"est_fat_g":16,"est_protein_g":31,"name":"Salmon","portion":"120g"}
  ]
}
$json$::jsonb,
client_food_selections = jsonb_build_object(
  'breakfast',       jsonb_build_object('protein','Whole Egg · 3 eggs','carbs','Oats · 75g','veg','Bell Peppers · 100g','fat',null),
  'morning_snack',   jsonb_build_object('protein','Chicken Breast · 120g','carbs','Sweet Potato · 270g','veg','Broccoli · 100g','fat','Avocado · 50g'),
  'lunch',           jsonb_build_object('protein','Cod · 170g','carbs','Brown Rice · 150g','veg','Asparagus · 100g','fat','Olive Oil · 4 tsp'),
  'afternoon_snack', jsonb_build_object('protein','Turkey Breast · 100g','carbs','Quinoa · 250g','veg','Cucumber · 100g','fat','Olive Oil (estimated) · 3 tsp'),
  'dinner',          jsonb_build_object('protein','Salmon · 120g','carbs','Whole Wheat Pasta · 150g','veg','Brussels Sprouts · 100g','fat',null)
)
WHERE id = 'a5cd5628-b185-49d0-9263-822813ba1585';
