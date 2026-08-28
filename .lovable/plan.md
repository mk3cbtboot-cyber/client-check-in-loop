# Plan instructions: findings + scoped plan

## 1. What the parser captures today

All of it comes out of `parse-mb-pdf` and is returned to the browser in the parse response:

| Thing captured | Response field | Shape | Mechanism |
|---|---|---|---|
| Per-category preparation / usage rules split out of food-list rows (e.g. "When eating oatmeal…") | `foodNotes` | `Record<categoryField, string>` keyed by client column name (`food_fish`, `food_starch`, `phase3_*`, plus a synthetic `eggs` key) | Generic free text — any long/note-looking fragment inside a category row becomes a note |
| Frequency / combination rules ("…twice per week", "max 5 eggs per week") | mined out of those same notes into `fields.food_limits` | `Record<foodKey, number>` — a weekly count only | Hardcoded: only a weekly numeric max survives; the "with eggs only" / combination part of the sentence is dropped |
| Meal-swap note | `mealSwapNote` | single string \| null | Hardcoded regex (`swap/exchange/switch` + a meal word), verbatim sentence |
| Treat-meal note | `treatMealNote` | single string \| null | Hardcoded regex (`treat/cheat/free meal`), verbatim sentence |
| Foods not included | `foodExclusions` | `string[]` | Generic list |
| Eggs min/week, water target | `fields.eggs_min_per_week`, `fields.water_target_litres` | numbers | Hardcoded |

**Critical gap:** `foodNotes`, `mealSwapNote` and `treatMealNote` are **never persisted**. `MbPdfImport.save()` writes `mb_pdf_path`, the flat category fields, `food_limits`, `mb_food_limits`, `mb_meal_options`, `mb_plan`, `food_exclusions` — and nothing else. The notes exist only in React state for the life of the review dialog and are discarded on save. There is no client column holding MB plan instructions (`food_list_notes` is the Custom/Food-List path only; `practitioner_notes` is a private practitioner scratchpad).

## 2. What the client sees today

Nothing from the above. MB portal surfaces (`MbRunPlanner`, `MbSuggestionBoard`, `MbPersonalFoodList`, `MbPlanMirror`) render zero note text — no `note` reference in any of them. `mb_plan` is sent to the portal by `client-portal-data`, and `MbPlanSetup` lets the practitioner type a per-meal note into `mb_plan.suggestions[].meals[].note`, but that note is never displayed anywhere, to anyone. `practitioner_notes` is dashboard-only. `food_list_notes` is displayed only for Custom clients (`CustomFoodListEditor`, `FoodListClientHome`).

So: parsed instructions are visible for a few seconds in the review dialog and then vanish; practitioner-typed meal notes are saved but invisible.

## 3. Practitioner editing after import

Not possible. The review dialog shows `mealSwapNote` / `treatMealNote` as read-only `<p>` text and the food notes as a read-only list. Nothing is editable, nothing is stored, and there is no "add an instruction" affordance anywhere for MB clients. The only editable free text that persists is the invisible `mb_plan` meal note and the private `practitioner_notes`.

## 4. The inert cap fields

- Type: `MbFoodLimit` in `src/lib/mb-plan.ts` — `{ id, food, type: "weekly"|"per_day"|"combination", min, max, unit?, combines_with?, note? }`; `parseMbFoodLimits` reads them all off `clients.mb_food_limits` (jsonb array).
- UI: `src/components/MbPlanSetup.tsx` "Food caps" block — type `<Select>` with Weekly / Per day / Combination, a Min input, a Max input, a Unit input, a conditional "Combines with" input, and a Note input.
- Evaluation: `supabase/functions/_shared/mb-cap.ts` line 74 — `if (!row || row.type !== "weekly" || row.max == null) continue;`. That is the only reader. `min`, `per_day`, `combination` and `combines_with` are read by nothing else in `src/` or `supabase/`. Removing them from the editor is safe.
- Data today: across all clients, 10 cap rows exist, **0** of type `per_day`/`combination`, **0** with `combines_with`, **1** with a non-null `min`. The PDF import writes `type: "weekly"` only and carries `min` over as `prior?.min ?? null`, so no parsed data populates them.
- The cap `note` field *is* stored but, like everything else, is never shown to the client.

## 5. Scoped plan

### (a) Trim the Food caps editor
`src/components/MbPlanSetup.tsx` only: drop the type `<Select>` (rows become implicitly weekly), the Min input, and the "Combines with" input. "Add cap" seeds `{ food, type: "weekly", max: null, unit: "count" }`. Keep Food / Max / Unit / Note and the whole weekly-max path untouched.
`src/lib/mb-plan.ts`: narrow `MbLimitType` to `"weekly"`, drop `min` and `combines_with` from `MbFoodLimit`, and have `parseMbFoodLimits` ignore those keys (existing rows keep working; stale keys in stored jsonb are simply not read). `src/components/MbPdfImport.tsx` stops copying `min`. No change to `mb-cap.ts`, `mb-run`, or `food_limits`.

### (b) Store and show "Your plan instructions"
New column `clients.plan_instructions` — jsonb array of `{ id, text, source: "parsed" | "practitioner", origin?: string }`, default `[]`, generic free text, no enforcement (migration + GRANT-free since `clients` already has them).
- `src/components/MbPdfImport.tsx`: on save, seed `plan_instructions` from `foodNotes` (one entry per category, `origin` = the category label), `mealSwapNote`, and `treatMealNote`, merging with any existing practitioner entries rather than clobbering.
- `supabase/functions/client-portal-data/index.ts`: add `plan_instructions` to the returned client payload.
- New `src/components/PlanInstructions.tsx`: a simple card, "Your plan instructions", bulleted list, hidden when empty.
- `src/pages/ClientPortal.tsx`: render it on the plan tab above the suggestion board (MB) and alongside the food list (Custom), so it is not MB-only.

### (c) Practitioner editing
- New `src/components/PlanInstructionsEditor.tsx`: list of rows (textarea + delete), "Add instruction" button, autosave to `clients.plan_instructions`, with parsed entries marked and freely editable.
- Mount it in `src/components/MbPlanSetup.tsx` (MB) and in `src/components/CustomFoodListEditor.tsx` or the Dashboard client panel (Custom), so both client types get one editor.

### Files touched
`supabase/migrations/<new>.sql`, `src/lib/mb-plan.ts`, `src/components/MbPlanSetup.tsx`, `src/components/MbPdfImport.tsx`, `supabase/functions/client-portal-data/index.ts`, `src/pages/ClientPortal.tsx`, new `src/components/PlanInstructions.tsx`, new `src/components/PlanInstructionsEditor.tsx`, plus the mount point in `src/pages/Dashboard.tsx` / `CustomFoodListEditor.tsx`.

No changes to the ledger, caps evaluation, `mb_run`, or email.
