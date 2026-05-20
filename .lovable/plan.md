## Weekly Meal Planner — Weekly Food Limits & Meal Splits

This is a sizable feature touching the database, practitioner dashboard, client meal planner, edge function, and shopping list. Outlining the approach so we agree before I build it.

### 1. Data model

**`clients` table** — add one column:
- `weekly_food_limits jsonb default '{}'` — flat map of normalized food name → units allowed per week.
  - Example: `{ "eggs": 5, "salmon": 2, "avocado": 3 }`
  - Units are interpreted contextually: "eggs" = count, "salmon" = serves, etc. Practitioner sees a free-text label so the UX stays simple.

**`weekly_meal_plans` table** — add per-meal "alternate" fields so a slot can hold two meals split across the week:
- `breakfast_meal_id_alt int`, `lunch_meal_id_alt int`, `dinner_meal_id_alt int`
- `breakfast_selections_alt jsonb default '{}'`, `lunch_selections_alt`, `dinner_selections_alt`
- `breakfast_primary_days int` (number of days the primary meal covers, 1–7; alt covers `7 - primary_days`), same for lunch/dinner.

No new tables.

### 2. Limit-detection logic (shared util `src/lib/food-limits.ts`)

For a given meal option + selections + limits:
1. Walk fixed ingredients and component selections, extract `(foodKey, perServingQty)` where:
   - Eggs → parse count from "Eggs — 3" style.
   - Selected food name → normalize (lowercase, singularize) and match against limit keys (also normalized).
   - Quantity sourced from the component `qty` ("160g") or trailing `(…)` in the food name.
2. For each matched food: `maxDays = floor(limit / perServingQty)`. Meal max days = min across all matched components. If `maxDays < 7`, the meal is "limited".
3. Returns `{ limited: boolean, maxDays: number, reasons: [{food, limit, perServing, maxDays}] }`.

### 3. Practitioner dashboard

In the Phase 2 Strict client card (Meal Plan tab), add a **Weekly Food Limits** editor below the existing food-list editor:
- Rows of `[food name] [units/week] [remove]`
- "Add limit" button.
- Saves to `clients.weekly_food_limits` on blur (same pattern as existing field edits).
- Helper text: "Used by the Weekly Meal Planner to warn clients when a meal would exceed their allowance."

### 4. Client meal planner (`MealPlanner.tsx`)

For each of breakfast/lunch/dinner:
- After the selected option's components are filled, run the limit check.
- If `limited`, render a warning card beneath the meal column:
  > ⚠️ Your plan allows {limit} {food}/week. This meal uses {perServing} per serving — that's enough for {maxDays} {day(s)}. Choose an alternative for the remaining {7-maxDays} days.
- Reveal a second option picker ("Alternate meal — covers {7-maxDays} days"). Same component flow as the primary, persists into the `*_alt` fields.
- Show split summary: "Primary — Mon, Tue / Alternate — Wed–Sun" (we'll just label by day-count to keep it dietless of real weekdays unless the user wants real weekday names).
- `isMealComplete` requires the alternate to also be complete when the primary is limited.
- Confirm button gating updated accordingly.

### 5. Shopping list

`shoppingList` memo updated:
- For each meal slot, multiply primary ingredients by `primaryDays` (default 7).
- If alt exists, add alt ingredients × `(7 - primaryDays)`.
- Same dedupe/grouping as today; identical foods with different qty are combined by summing grams/ml/count.

### 6. Edge function `weekly-meal-plan`

- `get` returns the new `*_alt` and `*_primary_days` fields.
- `save` accepts and persists them.
- No other behavior changes.

### 7. Recipe Generator restriction

`ClientPortal.tsx`'s `restrictedItems` is expanded to also include `*_selections_alt` so the generator allows the alt-meal ingredients too.

### Out of scope (call out for later)
- The MB PDF parser auto-populating limits — explicitly deferred per your message.
- Real calendar day assignment (Mon/Tue vs Wed/Sun is just a label; we always put the primary at the start of the week).
- Three-way splits (only primary + one alternate is supported).

If this matches what you want I'll ship it end-to-end.