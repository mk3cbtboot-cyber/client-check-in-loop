# MB PDF parser — real item model, per-option detection, unit preservation

MB-only. Touches `parse-mb-pdf`, `MbPdfImport`, and a one-off re-seed of the 8 MB clients that have a stored PDF. No Custom path, `food_list`, or recipe code is touched.

## Root causes (confirmed in code)

1. `MealOption` is `{protein_category, protein_grams, veg_grams, has_fruit, has_bread}` — Starch and Fat/Oil have nowhere to go, so "50 g Starch" is dropped.
2. `extractVegGramsForSlot` falls back to "any 2–4 digit number between 80 and 250" in the slot chunk, with no requirement that the word *Vegetables* appears — that is where the phantom 140 g comes from.
3. Fruit/Bread are computed once per meal chunk (`/\bFruit\b/i.test(chunk)`) and stamped onto all 3 options.
4. Protein grams are parsed with a `g`-only regex, so "200 ml Milk Products" is either missed or recorded as grams.

## New meal-item model

Each of the 9 options gains an ordered `items` array:

```
{ category: "Milk Products" | "Starch" | "Vegetables" | "Fruit" | "Bread" | "Fat/Oil" | "Eggs" | …,
  qty: number | null,
  unit: "g" | "ml" | "count" | "as_listed" }
```

Legacy `protein_category / protein_grams / veg_grams / has_fruit / has_bread` stay on the object, derived from `items`, so the review dialog and the existing `mb_meal_options` readers keep working unchanged.

## Parser changes (`supabase/functions/parse-mb-pdf/index.ts`)

- Slot chunking stays anchored on the ordered protein candidates (option 1/2/3 per meal), but each option's chunk is now tokenised in full.
- One tokenizer recognises, in either order, `N <unit> <Category>` and `<Category> N <unit>` with unit ∈ {g, ml} plus `N Egg(s)` (unit `count`) and bare `<Category>` with no quantity (unit `as_listed`, e.g. "Fruit", "Bread").
- Categories recognised: all Phase-2 protein categories, Vegetables / Veg./Lettuce, Starch, Bread, Fruit, Fat/Oil.
- The 80–250 numeric scavenge is deleted. `veg_grams` is only set when a Vegetables token is present in that option's own chunk.
- Fruit/Bread come from the option's own chunk only — the meal-chunk stamping loop is removed.
- Units preserved: `200 ml Milk Products` → `{category:"Milk Products", qty:200, unit:"ml"}`; legacy `protein_grams` still gets 200 for compatibility, but the item carries the true unit.

## Import changes (`src/components/MbPdfImport.tsx`)

- Carries `items` through parse → review → save (review UI unchanged; it still edits the legacy fields, and edits are reconciled back into `items`).
- On save, in addition to `mb_meal_options`, it writes a **draft** `mb_plan` (`confirmed_at: null`) whose 3 suggestions are built directly from the parsed `items` — one `MbPlanItem` per parsed item, with the item's real category, qty and unit. This removes the lossy `mb_meal_options → mb_plan` seeding path for new uploads.

## Re-seed of affected clients

For each MB client with `mb_pdf_path` (Carmen Candy, Carson Strong, Cheryl strong, Harry Haymaker, Sally Stressor, Scott Strong, Steve Streaker, Thomas Scott): re-invoke `parse-mb-pdf` against the stored PDF, rebuild `mb_meal_options` and `mb_plan` from the new item model. These are practice clients, so previously confirmed plans are overwritten and reset to draft for practitioner re-confirmation.

## Verification

Re-parsed Suggestion 2 breakfast for Scott Strong and Carson Strong shown against their source PDFs, plus a browser check of MB Plan Setup and the client My Plan tab for one of them.
