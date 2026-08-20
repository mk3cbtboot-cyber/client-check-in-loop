# MB 7-Day Week Model (replacing the fixed 3-day run)

MB clients only (`client_type = 'mb'` / `system_mode !== 'own_practice'`). Custom is untouched: no edits to `MealPlanner.tsx`, `CustomFoodListEditor.tsx`, `FoodList*`, or Dashboard's Custom branch.

## a) What `mb_run` can represent today

Current shape (`src/lib/mb-run.ts`):

```text
mb_run = {
  colour: "blue" | "green" | "orange" | null,   // one colour for the whole run
  started_on: "YYYY-MM-DD" | null,
  confirmed_on: "YYYY-MM-DD" | null,
  meals: { breakfast|lunch|dinner: { colour, picks: { itemId: "Food" } } | null }
}
```

Can represent: one locked colour, one set of food picks per meal, and a per-meal colour override (the cap-conflict whole-meal swap). Cap math treats the run as `RUN_DAYS = 3` and multiplies each item's per-meal quantity by 3.

Cannot represent: anything per day. There is exactly one meals object shared by all days, so it cannot express "Mon+Tue blue, Wed green", different picks on different days, a swap that applies to one day only, partial planning (3 days assigned, 4 unassigned), or a cumulative weekly total. The cap check is "per-meal qty x 3 days", not a sum over assigned days.

## b) Proposed data model (additive, `mb_run` stays the column)

```text
mb_run = {
  version: 2,
  week_start: "YYYY-MM-DD",            // anchor for the weekly cap window
  confirmed_on: "YYYY-MM-DD" | null,   // unchanged semantics, now week-level
  days: {
    "YYYY-MM-DD": {
      colour: "blue"|"green"|"orange",
      meals: {
        breakfast: { colour, picks: { itemId: "Food" } } | null,
        lunch:     { ... } | null,
        dinner:    { ... } | null
      }
    },
    ...                                 // only assigned days appear; gaps = unplanned
  },
  // legacy v1 keys kept on the row but ignored by v2 readers
  colour?, started_on?, meals?
}
```

- `days[date].colour` is the day's assigned Suggestion. `days[date].meals[m].colour` is the per-day per-meal swap (defaults to the day colour when absent) — the same override concept, now scoped to one day.
- Picks are per day per meal, so the same colour on two days can carry different foods.
- Parser `parseMbRun` gains a v1 -> v2 upgrade: a v1 run with `colour` set becomes 3 days starting at `started_on` (or today), each with the v1 colour and the v1 meal picks/overrides copied in; `confirmed_on` carries over. Nothing is written back until the client next saves, so the migration is read-time and non-destructive (no SQL migration, no data loss, rollback = revert code).
- `mb_food_limits` stays authoritative, `food_limits` stays the fallback. No consolidation, no store changes.

## c) Client planner UI: 7-day week frame

`src/components/MbRunPlanner.tsx` becomes a week planner:

- Header: week label (`Mon 24 – Sun 30`) plus save/confirm state.
- A 7-day strip. Each day is either unassigned (shows the three colour chips to assign) or assigned (colour dot + Suggestion label, tap to expand).
- Chunk filling: assigning a colour offers "apply to the next N days" (defaults to the remaining unassigned run), so batching stays one tap. Days can be left blank and filled later.
- Expanding a day shows that day's three meals with the same food dropdowns as today, plus the per-meal swap Select on a cap conflict (scoped to that day only, other days keep the food).
- Running weekly totals for capped foods shown under the strip ("Eggs 4 / 5 this week").
- Confirm gate unchanged in shape: Confirm is disabled while any assigned day has an unresolved cap breach or an unpicked required item.

Other components:
- `src/pages/ClientPortal.tsx` — My Plan tab passes the same props; `mbRunGateActive` reads `confirmed_on` from the v2 run (no change in meaning). Home handoff (`onGoHome`) keeps working; the Home/recipe surface starts using *today's* assigned day's colour + picks instead of the single locked colour.
- `src/components/MbPlanMirror.tsx` (practitioner, read-only) — mirrors the same week strip: 7 days with assigned colour, expanded picks, swap badges, and the weekly cap tallies. Still zero controls.
- `src/pages/Dashboard.tsx` — passes `mb_run` through as today; no logic change.
- `src/lib/mb-run.ts` — new v2 types, `parseMbRun` upgrade, `assignDay`, `assignRange`, `clearDay`, `resolveDayMeal` (the per-day successor to `resolveRunMeal`), `weekStartFor`.

## d) Cap evaluation

`supabase/functions/_shared/mb-cap.ts` (the one shared evaluator, imported by both browser and edge) changes from "per-meal qty x RUN_DAYS" to a cumulative weekly sum:

1. For every assigned day in the week, for every meal, for every item (fixed items included), resolve the cap food (`label` for fixed, the pick otherwise) and `perMealQty` — unchanged logic, so `2 eggs` and `as_listed "2 Eggs"` still count as 2.
2. Accumulate `total[food] += perMealQty`, tracking which day/meal/item contributed.
3. A violation is any food whose weekly total exceeds `weeklyCapFor(food, mb_food_limits, food_limits)`. Violations are attributed to the day that pushed it over, so the block is day-scoped.
4. Eggs: cap 5, 2-egg lunch on day 1 (2) and day 2 (4) pass; day 3 would be 6 -> that day is blocked, days 1-2 unaffected.
5. Only remedy offered: swap that one day's affected meal to another colour. No same-category substitution, no cap override.

Existing tests in `src/test/mb-cap.test.ts` are rewritten for weekly totals plus new cases for partial weeks and per-day swaps.

**Decision for you — week anchoring:** I recommend a **calendar week anchored to Monday** (`week_start` = Monday of the current date, caps reset Monday 00:00 client-local). It matches how clients read "per week", makes the practitioner mirror unambiguous, and survives a client planning ahead. The alternative is **rolling from the plan/phase start date** (`phase2_strict_started_at`), which lines up cleanly with Phase 2's 14 days = exactly two windows but drifts against the calendar and is harder to explain. Either way Phase 2's 14 days spans two windows and each window resets independently. Tell me which you want; the anchor is one function (`weekStartFor`) so it is cheap to change but I do not want to guess.

## e) Confirm gate and server backstop

- `supabase/functions/mb-run/index.ts` keeps the `get` / `save` / `confirm` actions and the same pattern: `save` is permissive and always clears `confirmed_on`; `confirm` re-runs the shared evaluator server-side against the practitioner's stored `mb_plan` suggestions (never client-supplied items), the same `mb_food_limits` -> `food_limits` precedence, and rejects with `409 cap_exceeded` plus per-day violation detail the planner surfaces inline on the offending day.
- The zod `Run` schema is replaced with the v2 week schema (bounded: max 7 days, dates validated, picks capped in length as now). v1 payloads are upgraded server-side by the same shared parser so an old client tab cannot corrupt a row.
- `confirmed_on` now means "this week's plan is confirmed"; the client portal cooking gate reads it exactly as it does today.
- One evaluator, two callers — `src/lib/mb-food-list.ts` continues to re-export from `_shared/mb-cap.ts`, so client and server cannot diverge.

## f) Shopping list coupling

The MB shopping list today is inside `src/components/MealPlanner.tsx`, built from the legacy weekly meal plan selections, not from `mb_run`. It is therefore not broken by this change and **can follow in a later build**. The spec's "build the list from the colours assigned to the days being shopped" becomes straightforward once `mb_run.days` exists: sum the items of each assigned day's resolved meals over a chosen date range. I would ship the week model first, then the list, so each is testable on its own.

## g) Build order (each phase independently testable)

1. **Model + parser** — v2 types, `parseMbRun` v1->v2 upgrade, day helpers, `weekStartFor`. Unit tests only, nothing rendered. Verifiable: existing MB rows parse into a 3-day week identical to their old run.
2. **Cap evaluator** — cumulative weekly totals in `_shared/mb-cap.ts` + rewritten tests (eggs 5-cap example as a named case). No UI yet.
3. **Client planner** — `MbRunPlanner` week strip, chunk assignment, per-day picks, per-day swap, running tallies, gated Confirm. Verified in the preview as an MB client.
4. **Server backstop** — v2 schema + weekly evaluation in `mb-run`, deployed; verified by posting an over-cap week and getting `409`.
5. **Practitioner mirror** — `MbPlanMirror` week view; verified side by side against the client portal.
6. **Home handoff** — today's-day colour drives the recipe surface; gate still keyed on `confirmed_on`.
7. *(Follow-up, not this build)* shopping list from assigned days.

Custom stays untouched in every phase; no file on the `own_practice` path is edited.
