# MB Foundation — Build #1: Personal Food List + Client Colour-Lock Flow

MB-only (`client_type = 'mb'`). No Custom path, component, or edge-function branch is touched; every new payload field is additive.

## Data model

Two new jsonb columns on `clients` (both nullable / default `{}`):

1. `mb_food_list` — ONE approved-food list per client, keyed by MB category:
   `{ "fish": ["Trout", …], "vegetables": [...], … }`
   Categories: Fish, Seafood, Milk Products, Yogurt, Meat, Poultry, Cheese, Legumes, Vegetables, Veg./Lettuce, Starch, Bread, Fruit.
   When null/empty it seeds (read-only fallback) from the existing `food_*` columns, so backfilled clients need no re-entry. First practitioner edit materialises the seeded list into the column. `food_*` columns are left untouched.

2. `mb_run` — the client's current colour lock and food picks:
   ```
   { colour: "blue"|"green"|"orange",
     started_on: "YYYY-MM-DD",
     meals: {
       breakfast: { colour: <colour of the meal actually used>, picks: { <planItemId>: "Trout" } },
       lunch: {...}, dinner: {...}
     } }
   ```
   `meals[x].colour` normally equals the run colour; it differs only for the cap-conflict swap (B3), where one meal is taken wholesale from another colour.

Caps: read-only consumption of existing `mb_food_limits` (weekly rows) with fallback to legacy `food_limits`. No cap model changes.

## Component changes

**Part A — practitioner (`MbPlanSetup.tsx`)**
- Suggestion cards move to a 3-across grid at the top (fields unchanged).
- New `MbPersonalFoodList` component rendered below them: the same chip/tag editor pattern already used on the Meal Plan tab (per-category card, chip with X, "Delete Section", plus an add-item input). Autosaves to `clients.mb_food_list`.
- Food caps section stays where it is.

**Part B — client (`ClientPortal.tsx`, MB branch only)**
- New `MbRunPlanner` component rendered inside the My Plan tab for confirmed MB plans:
  - Tapping any meal of a colour locks that whole colour as the 3-day run; the other two colours grey out with a "Change suggestion" action to unlock.
  - Each item's category label in the locked colour is a dropdown of that category's foods from the Personal Food List; picking fills the food into the meal.
  - Cap conflict: when a picked food has a weekly cap that cannot cover 3 days at the item quantity, that day/meal shows a warning and offers whole-meal replacement from one of the other two colours (all items swapped together, `meals[x].colour` changes). No same-category substitution.
  - When all three meals are picked, a "Your run is ready" state links to Home, where the existing 3-option / 1-regenerate recipe mechanic runs against the picked foods.
- The Meal Planner nav item is hidden for `client_type === 'mb'` with a confirmed plan. Custom clients' existing tab filter (planner already hidden for all three formats) is untouched.

**Edge functions**
- `client-portal-data`: additively include `mb_food_list` and `mb_run`.
- New `mb-run` function (token-authenticated, same pattern as `client-portal-water`): `get` / `save` of `clients.mb_run`.

Shopping list, cap model, and Suggestion editor fields are out of scope.

## Verification

On-screen check against a real MB client with a confirmed plan (food list backfilled) and a fresh/unconfirmed MB client (must stay on legacy behaviour, Meal Planner still present), plus one Custom client to confirm no visible change.
