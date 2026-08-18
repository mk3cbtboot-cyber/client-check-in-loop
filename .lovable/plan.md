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

---

## 5. The block must actually stop the run (client gate)

**How a run is finalised today:** there is no explicit confirm step. `MbRunPlanner` computes `runReady` (a colour is locked and every non-optional pick is filled), then shows a "Your run is ready" panel whose only action is `onGoHome()` → `ClientPortal` `changeTab("home")`, where Home generates recipes from the saved `mb_run` (`generate-mb-recipe`). Saving is a 500 ms debounced `mb-run { action: "save" }`. So "finalising" = the run reaching ready + the client handing off to Home to cook it.

**Files:** `src/components/MbRunPlanner.tsx`, `src/pages/ClientPortal.tsx`, `supabase/functions/mb-run/index.ts`.

**Change — make the handoff an explicit, gated confirm:**
- Compute `capViolations = evaluateRunCaps(...)` (the shared evaluator, section 7) for the whole run, across all three meals and every item, fixed and pick.
- `runReady` becomes `allPicked && capViolations.length === 0`. While any violation exists, the ready panel is replaced by a blocking amber panel listing each offending meal/food ("Lunch — eggs: 6 needed for a 3-day run, cap is 5") and the sanctioned remedy only: the whole-meal swap selector to another suggestion for that meal. No "acknowledge", no override, no dismiss.
- The "Go to Home" button is replaced by **Confirm run**, which is `disabled` while violations exist and calls `mb-run { action: "confirm", run }`. Only on a 200 does the planner call `onGoHome()`. A rejection surfaces the server's message inline (toast + the same amber panel) and the client stays on the planner.
- `mb_run` gains a `confirmed_on: string | null` field (set by the server on a successful confirm, cleared by any subsequent `save`), so Home can tell a confirmed run from a half-picked draft. `parseMbRun` / `startRun` / `emptyRun` in `src/lib/mb-run.ts` carry it.
- `ClientPortal` Home: MB recipe generation reads the run only when `confirmed_on` is set; otherwise Home shows "Finish and confirm your run in My Plan" and links back. That is where the gate bites in the client flow — an unconfirmable run can never reach the cooking surface.

Autosave (`action: "save"`) stays permissive so a client can keep editing mid-conflict; only `confirm` is gated.

## 6. Server-side backstop in `supabase/functions/mb-run`

**File:** `supabase/functions/mb-run/index.ts`

Today it validates shape with Zod and writes whatever is posted. Add:
- Widen the select to `id, client_type, mb_run, mb_plan, mb_food_limits, food_limits` plus the food-list columns needed to resolve items (the confirmed colour plan is the source of the item list — the client cannot post its own items, so it cannot lie about quantities).
- New `action: "confirm"`. It resolves each meal's suggestion from the stored `mb_plan` honouring the per-meal `colour` override, walks every item (fixed and pick), and runs the **same shared evaluator** as the client.
- If violations exist → `409 { error: "cap_exceeded", violations: [{ meal, food, needed, cap, per_meal }] }`. Nothing is written.
- If clean → write `mb_run` with `confirmed_on = today` and return it.
- `action: "save"` is unchanged except that it clears `confirmed_on`, so a client cannot edit their way past a cap after confirming.

The client surfaces `error` / `violations` verbatim in the amber panel, so a stale client build still gets blocked with a readable reason.

## 7. One shared cap-evaluation path (client + server in lockstep)

**New file:** `supabase/functions/_shared/mb-cap.ts` — dependency-free, no Deno or DOM APIs, plain TS.

Exports:
- `perMealQty(item)` — the quantity logic from section 2, verbatim, one implementation.
- `weeklyCapFor(food, enrichedLimits, legacyLimits)` — moved here; `mb_food_limits` first, `food_limits` fallback. Precedence and both stores unchanged.
- `capBlocksRun(...)` and `evaluateRunCaps(run, suggestions, enriched, legacy, runDays)` → `Violation[]`.

Wiring:
- The edge function imports it as `../_shared/mb-cap.ts` (deploys with the function).
- The client imports the same file: `src/lib/mb-food-list.ts` re-exports `weeklyCapFor` / `capBlocksRun` from `../../supabase/functions/_shared/mb-cap` so existing call sites keep their imports, and `MbRunPlanner` uses `evaluateRunCaps`. Vite resolves the path at build time; nothing is duplicated. If that cross-root import proves awkward in the Vite build, the fallback is a single source file plus a checked-in generated copy with a unit test asserting the two are byte-identical — but the direct import is the intent.
- A vitest case in `src/test/` covers: fixed 2-egg item vs cap 5 → blocked; as_listed "2 Eggs" → needed 6; cap 6 → clean; and the same fixtures run through the evaluator the server calls, proving one code path.

## Verification additions

6. Client with a fixed 2-egg lunch and an egg cap of 5: **Confirm run** is disabled, the amber panel lists the violation and offers only the whole-meal swap; after swapping lunch to another colour, Confirm enables and succeeds.
7. Direct `mb-run` call posting the violating run with `action: "confirm"` (bypassing the UI) returns `409 cap_exceeded` and leaves `mb_run` unwritten.
8. Home refuses to generate MB recipes until `confirmed_on` is set.

## Unchanged, restated

- Custom (`own_practice`) is untouched: no edits to `MealPlanner.tsx`, `CustomFoodListEditor.tsx`, or Dashboard's Custom branch. `checkMealLimits` and its use of `food_limits` on the legacy/Custom path keep working exactly as today.
- Both cap stores stay in place with the same authority: `mb_food_limits` first, `food_limits` fallback. No migration, no consolidation, no schema change beyond the additive `confirmed_on` key inside the existing `mb_run` jsonb.
