# MB weekly-cap enforcement fixes

Scope: MB clients only. Custom (`own_practice`) code paths untouched. Both cap stores stay exactly as they are — `mb_food_limits` stays authoritative, `food_limits` stays the fallback. No migration, no consolidation.

## 1. Cap check must run on `fixed` items

**File:** `src/components/MbRunPlanner.tsx`

Today the item loop hits `if (it.category === "fixed") return (...)` and returns before `capBlocksRun` is ever called. Eggs are stored as `fixed`, so they are invisible to the checker.

Change: compute the cap result for every item — fixed or pick — before the fixed-item early return. The fixed branch then renders its label/qty line plus the same amber warn-and-block block (warning text + "swap this meal to another suggestion" selector) when `conflict.blocked` is true. For fixed items the food name used for the cap lookup is `it.label` (there is no dropdown pick).

The pick branch keeps its existing behaviour unchanged.

## 2. Per-meal quantity must reflect the real amount

**File:** `src/lib/mb-run.ts` (new exported helper) + used from `MbRunPlanner.tsx`

Today: `perMeal = it.unit === "count" && it.qty ? it.qty : 1`. So a `count` item works, but `as_listed` items ("2 eggs" living in `note`/`label`) always count as 1, and a 3-day run reads as 3 against a cap of 5 instead of 6.

New helper `perMealQty(item): number`:
- `unit === "count"` and `qty > 0` → `qty`.
- `unit === "g"` / `"ml"` → `1` (cap counts servings, not grams; unchanged from today).
- `unit === "as_listed"` → parse a leading integer from `note`, else from `label`, with a strict regex: a whole number 1–20 that is immediately followed by the food word or a unit-free space (`/^\s*(\d{1,2})\b/`). No match, non-finite, zero, or > 20 → fall back to `1`. Fractions and ranges ("1-2") are deliberately not counted above their lower bound; we take the first integer, which is the conservative reading and never invents a quantity that isn't written down.

This is read-only string parsing — nothing is written back to the plan, so a bad parse can only make the check behave the way it does today (count of 1), never corrupt data.

`capBlocksRun(food, perMealQty(it), RUN_DAYS, ...)` then compares `qty × 3` against the cap, which is what the requirement asks for.

`MbPlanMirror.tsx` keeps using `resolveRunMeal`/`fmtQty` as-is — no behaviour change there.

## 3. Correct the cap-editor copy

**File:** `src/components/MbPlanSetup.tsx`

- "Food caps" (`mb_food_limits`) subtitle: replace "Stored as a draft only — not yet enforced anywhere." with copy stating it is the live cap used for MB runs, e.g. *"Live caps — these are enforced when a client picks foods for a run."*
- Weekly Food Limits (`food_limits`, rendered by `WeeklyLimitsEditor`): label it as the fallback, e.g. heading stays but the description becomes *"Legacy fallback — only used when a food has no entry in Food caps above."*

**File:** `src/components/WeeklyLimitsEditor.tsx` — the description string lives here; it will take the wording change (and it is used only by the MB setup dialog now).

## 4. Fix the snap-back regression in Weekly Food Limits

**File:** `src/components/WeeklyLimitsEditor.tsx` (primary) and `src/components/MbPlanSetup.tsx` (secondary)

Cause: MB Plan Setup's 700 ms debounced autosave calls `onSaved()` → Dashboard `load()` → a fresh `food_limits` object identity → the editor's `useEffect([value])` rebuilds rows from the prop and discards the row being typed.

Change in `WeeklyLimitsEditor`: the sync effect keeps dirty rows instead of blowing them away. For each row coming from `value`, if a local row with the same `savedName` exists and is dirty (name or limit differs from what's persisted), keep the local row; otherwise take the incoming one. Unsaved (`savedName === null`) rows are preserved as they already are. Result: background reloads can no longer revert in-progress typing, and an explicit save/remove still round-trips normally.

Change in `MbPlanSetup`: the debounced draft autosave stops calling `onSaved()` on every tick — it only notifies the parent on dialog close / explicit save, so a draft-cap keystroke no longer forces a full client reload. Explicit saves keep their existing refresh.

## Verification

- Playwright, practitioner + client portal, against an MB test client (Carson Strong; data restored afterwards):
  1. Set a `mb_food_limits` weekly cap of 5 on eggs. Client locks a suggestion whose lunch is a **fixed** "2 eggs" item → amber warning appears (6 needed vs cap 5) with the whole-meal swap selector. Today it is silent.
  2. Same with an `as_listed` "2 Eggs" item → `needed` reads 6, not 3.
  3. Raise the cap to 6 → warning disappears.
  4. In MB Plan Setup, edit an existing Weekly Food Limits row and keep typing across the 700 ms autosave window → value no longer snaps back; check mark saves it.
  5. Read both editor descriptions on screen to confirm the new copy.
- `tsgo` typecheck.
- Confirm by diff that no Custom/`own_practice` file or branch is touched (`MealPlanner.tsx`, `CustomFoodListEditor.tsx`, Dashboard's Custom branch), and that neither cap store's schema, precedence in `weeklyCapFor`, nor write paths change.
