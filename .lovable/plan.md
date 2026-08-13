# MB colour-grouped meal model — foundation phase

Goal of this phase: introduce the colour-as-a-whole-day data model, make the practitioner review screen the source of truth (fully hand-enterable), point the portal at the confirmed data instead of hardcoded portions, and backfill existing MB clients. Planner rework, shopping list and cap enforcement are explicitly out of scope.

## (a) Data model

### New column: `clients.mb_plan` (jsonb, NOT NULL DEFAULT '{}')

`mb_meal_options` is dead data in an incompatible shape (3 slots x 3 options, no day grouping, no foods). Rather than mutate it in place, add a new versioned column and leave the old one untouched as a rollback/pre-fill source. One column keeps the whole plan atomic (a colour day only makes sense as a unit) and avoids a multi-table join in the portal.

```jsonc
{
  "version": 1,
  "confirmed_at": "2026-08-13T17:00:00Z",   // null = draft, not yet live
  "suggestions": [
    {
      "colour": "blue",                      // blue | green | orange (fixed set, ordered)
      "label": "Suggestion 1",               // practitioner-editable display name
      "meals": {
        "breakfast": {
          "items": [
            { "id": "u1", "category": "cheese", "label": "Cheese",
              "qty": 60, "unit": "g", "note": "" },
            { "id": "u2", "category": "vegetables", "label": "Vegetables",
              "qty": 85, "unit": "g", "note": "" },
            { "id": "u3", "category": "fruit", "label": "Fruit",
              "qty": null, "unit": "as_listed", "note": "1 piece" },
            { "id": "u4", "category": "bread", "label": "Bread",
              "qty": 25, "unit": "g", "note": "" }
          ],
          "note": ""
        },
        "lunch":  { "items": [ ... ], "note": "" },
        "dinner": { "items": [ ... ], "note": "" }
      }
    },
    { "colour": "green",  ... },
    { "colour": "orange", ... }
  ]
}
```

Notes on the shape:
- `category` keys reuse the existing `MB_FOODS` / `clients.food_*` category vocabulary, so an item resolves to the client's own approved food list for that category (that list stays where it is — flat `food_*` columns, unchanged this phase).
- `qty` + `unit` replace hardcoded portion strings. `unit: "as_listed"` covers fruit/bread items whose amount is baked into the food name.
- Every item carries a stable `id` so later phases (logging, shopping list) can reference a specific line.
- `label` is free text so a practitioner can hand-enter something the category vocabulary doesn't cover.
- Missing/empty meals are allowed in a draft; `confirmed_at` is only set when all 3 colours have all 3 meals.

### Enriched caps: `clients.mb_food_limits` (jsonb, NOT NULL DEFAULT '[]')

`food_limits` is `{"eggs": 2}` — a bare max with no type and no min, which is why "min 1, max 5 per week" collapsed to a wrong 2. New shape, array so ordering and duplicates-by-scope are expressible:

```jsonc
[
  { "id": "c1", "food": "Eggs",     "type": "weekly",      "min": 1,    "max": 5,  "unit": "count" },
  { "id": "c2", "food": "Fruit",    "type": "per_day",     "min": null, "max": 3,  "unit": "count" },
  { "id": "c3", "food": "Potatoes", "type": "combination", "min": null, "max": 2,  "unit": "serving",
    "combines_with": ["Rice", "Bread"], "note": "any 2 of these per week" }
]
```

`type` = `weekly | per_day | combination`. Old `food_limits` stays in place and keeps driving today's enforcement until the enforcement phase migrates it; this phase only stores, reviews and displays the new shape.

Migration = two `ALTER TABLE ... ADD COLUMN` on `clients`. No new table, no drops.

## (b) Practitioner review / setup screen

Rework `MbPdfImport.tsx` into an **MB Plan Setup** screen (reachable from the client detail regardless of whether a PDF was ever uploaded), with three sections:

1. **Import (optional).** The existing PDF upload, relabelled "Pre-fill from PDF". Success fills the draft; failure or skip leaves an empty but fully usable draft. There is no path where a bad parse blocks the practitioner.
2. **Three colour cards.** Blue / Green / Orange, each with Breakfast / Lunch / Dinner sub-panels. Each meal is a list of item rows: category select (from the existing MB category list, plus "Other"), free-text label, numeric qty, unit select (`g`, `ml`, `count`, `as listed`), optional note. Add row / remove row / drag to reorder. "Copy meal from…" and "Duplicate colour" shortcuts so hand entry of 9 meals is quick.
3. **Caps.** A repeating row editor: food, type (weekly / per day / combination), min, max, unit, and a multi-select for combination members. Free text food names — no dependency on the parse.

Behaviour:
- Draft autosaves to `mb_plan` with `confirmed_at: null`. The portal ignores drafts.
- **Confirm plan** validates 3 colours x 3 meals each with at least one item, then stamps `confirmed_at`. That stamp is the switch that makes the data live.
- Re-opening a confirmed plan shows an "editing a live plan" banner; re-confirming republishes.
- Empty state = 3 blank colour cards, so the screen is usable with zero parser involvement. That is the acceptance test for the manual-entry requirement.

## (c) Runtime consumers

Introduce `src/lib/mb-plan.ts` with a single resolver:

```ts
getMbPlan(client) -> { source: "confirmed" | "legacy", suggestions }
```

When `mb_plan.confirmed_at` is set it returns the confirmed colour days. Otherwise it synthesises the same shape from today's hardcoded `MB_OPTIONS` + `food_*` columns, so **every existing client keeps exactly today's behaviour** until their plan is confirmed. Nothing is deleted from `mb-foods.ts` in this phase.

Consumers repointed at the resolver:
- `ClientPortal.tsx` — My Plan tab and the MB meal surfaces render the confirmed items and their real qty/unit (this is what closes the hardcoded-portion gap; clients start seeing their actual grams).
- `MealPlanner.tsx` / `MealRecipeSection.tsx` — read structure and portions from the resolver instead of `MB_OPTIONS`. The planner's own selection/lock flow is untouched this phase; it just gets its options from the new source.
- `client-portal-data` edge function — include `mb_plan` in the payload.
- `generate-mb-recipe` and `client-messages` — pass resolved portions instead of hardcoded strings.

Colour grouping is surfaced read-only in the portal this phase (a client can see the three suggestion days); per-day colour assignment is the next phase.

## (d) Backfill for existing MB clients (~8)

A one-off script (not a migration; it writes data via the insert tool) that, per MB client, builds a **draft** `mb_plan`:
- Colour N takes option index N from `mb_meal_options` for each of breakfast/lunch/dinner (index ordering is the only grouping signal that exists — it is a best-effort draft, which is exactly why it stays a draft).
- `protein_category` / `protein_grams` / `veg_grams` / `has_fruit` / `has_bread` map onto item rows; fruit and bread become `as_listed` items.
- Clients with empty `mb_meal_options` get 3 blank colour cards seeded from `MB_OPTIONS` structure with no portions.
- `mb_food_limits` seeded from `food_limits` as `{type: "weekly", min: null, max: <value>}`.
- `confirmed_at` stays null for all of them, so nothing changes on screen until the practitioner reviews each client. Cheryl works through ~8 clients once.

## (e) Keeping the parser thin

`parse-mb-pdf` is reduced to: PDF in → **draft `mb_plan` + draft `mb_food_limits`** out. It does no writing, no validation of business rules, and nothing else in the app imports from it. The contract is the JSON shape in (a), asserted by a fixture test. When Metabolic Balance changes their format, the only file that changes is `parse-mb-pdf/index.ts` (plus its fixture) — the model, the review screen, the resolver and the portal are untouched. The review screen treats parser output as a suggestion it can fully overwrite, never as a dependency.

## (f) Build order (each slice ~2h, independently testable)

1. **Smallest safe first slice — model + resolver, zero UI change.** Migration adding `mb_plan` and `mb_food_limits`; add `src/lib/mb-plan.ts` with the resolver returning the legacy synthesis for everyone. Ship: nothing changes on screen, but the seam exists. Test: existing MB portal renders identically.
2. **Review screen, colour cards, draft-only.** Hand-entry UI for 3 colours x 3 meals, autosave to `mb_plan` draft. No portal impact. Test: build a full plan from scratch with no PDF.
3. **Caps editor.** `mb_food_limits` rows with type/min/max/combination, shown alongside the old flat caps.
4. **Confirm + publish.** Validation, `confirmed_at` stamping, live-edit banner.
5. **Portal reads confirmed data.** Resolver returns confirmed suggestions when present; My Plan and MB meal surfaces render real portions; `client-portal-data` includes the column. Test one confirmed client vs one unconfirmed client side by side.
6. **Parser retarget.** `parse-mb-pdf` emits the new draft shape; wire "Pre-fill from PDF" into the review screen. Fixture test on the current PDF format.
7. **Backfill script + practitioner walkthrough.** Seed the 8 drafts, spot-check two clients, hand over for re-confirmation.
