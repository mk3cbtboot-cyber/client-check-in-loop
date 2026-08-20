# MB weekly cap ledger + per-day meal swap inside a 3-day run

MB / Metabolic Rx clients only (`client_type = 'mb'` / `system_mode !== 'own_practice'`). Custom is untouched: no edits to `MealPlanner.tsx`, `CustomFoodListEditor.tsx`, the `FoodList*` components, or Dashboard's Custom branch.

Kept as-is: the 3-day colour-locked run, the explicit Confirm gate, `confirmed_on`, the server backstop in `mb-run`, and the single shared evaluator in `supabase/functions/_shared/mb-cap.ts`. What changes is the cap maths and the granularity of a swap.

## a) How the run is stored today, and what it must gain

Today (`src/lib/mb-run.ts`, `clients.mb_run`):

```text
mb_run = {
  colour, started_on, confirmed_on,
  meals: { breakfast|lunch|dinner: { colour, picks: { itemId: "Food" } } | null }
}
```

One meals object for the whole run. A swap replaces a meal for **all three days**. There is no per-day detail, so "eggs on days 1–2, swapped on day 3" is unrepresentable. There is also no history: the row is overwritten each run, so nothing knows what an earlier run in the same week already consumed.

Proposed shape (same column, additive, `version: 2`):

```text
mb_run = {
  version: 2,
  colour, started_on, confirmed_on,       // unchanged meaning: one colour, 3 days
  week_start: "YYYY-MM-DD",               // cap window this run was planned against
  days: [
    { date: "YYYY-MM-DD",
      meals: {
        breakfast: { colour, picks: { itemId: "Food" } },   // colour = run colour unless swapped
        lunch:     { ... },
        dinner:    { ... }
      } },
    ... exactly 3 entries
  ],
  // v1 keys left in place on old rows; ignored by v2 readers
  meals?
}
```

- `days[i].meals[m].colour` is the per-day per-meal swap. Default = the run colour; a swap sets it to another suggestion for that day only, everything else that day stays on the chosen colour.
- Picks are per day, so a swapped day carries its own food choices.
- `parseMbRun` gains a read-time v1 → v2 upgrade: a v1 run expands into 3 days from `started_on` (or today), each day copying the v1 meal colours/picks. No SQL migration, no data loss, rollback = revert code.
- `mb_food_limits` stays authoritative, `food_limits` stays the fallback. No consolidation.

## b) Phase 2 start date as the week anchor

It already exists: `clients.phase2_strict_started_at` (timestamptz), set when the practitioner starts Phase 2 strict.

Anchor rule, one shared function `weekWindowFor(anchor, onDate)` in `_shared/mb-cap.ts`:

- `week_index = floor(days_between(anchor_date, on_date) / 7)`, `week_start = anchor_date + 7 * week_index`, `week_end = week_start + 6`.
- Phase 2's 14 days is therefore exactly two consecutive windows off the same anchor; nothing special-cased.
- Fallback when `phase2_strict_started_at` is null (Phase 3/4, or not yet started): anchor on the client's first confirmed run in the current model, persisted as `mb_run.week_start`; if that is also absent, anchor on today. The fallback is deterministic and stored, so the window never silently shifts under the client.
- A 3-day run can straddle a window boundary. Each day is charged to the window that day falls in — the ledger is keyed by `week_start`, so a run spanning the roll simply writes to two windows and the reset happens mid-run exactly as the rules say.

## c) The weekly ledger (consumption across runs)

`mb_run` is overwritten per run, so the ledger needs its own durable store. New MB-only table:

```text
public.mb_cap_ledger
  id uuid pk
  client_id uuid not null references public.clients(id) on delete cascade
  week_start date not null          -- from the Phase 2 anchor
  day date not null                 -- the day consumed
  meal text not null                -- breakfast | lunch | dinner
  food text not null                -- normalised cap food name
  qty numeric not null              -- perMealQty for that item
  run_started_on date               -- provenance
  created_at timestamptz default now()
  unique (client_id, day, meal, food)   -- re-confirming a run replaces, never double-counts
```

Grants (`authenticated` select, `service_role` all), RLS enabled: practitioners read their own clients' rows; writes are service-role only from the `mb-run` edge function. Clients reach it only through the token-authed function, exactly like `mb_run` today.

- Written on **confirm**, in one transaction-ish upsert: the function deletes the rows for that run's days and reinserts from the confirmed run, so editing and re-confirming a run is idempotent.
- Read on **plan/pick**: `remaining(food) = cap(food) − sum(qty) for (client, week_start)`, excluding rows belonging to the run currently being edited (so a client editing an already-confirmed run isn't blocked by their own prior confirmation).
- Only capped foods are recorded, keeping the table small (a handful of rows per week per client).

## d) Selection-time enforcement

The moment the client taps a Suggestion (before any confirm):

1. `startRun(colour)` builds the 3 dated days and fetches the week ledger via `mb-run action: "get"` (extended to return `{ run, week_start, consumed: { food: qty } }`).
2. The shared evaluator runs `planRunAgainstLedger(run, suggestions, limits, consumed, capacityByFood)`: it walks days 1→3 in order, and for each meal/item resolves the cap food (fixed items by `label`, picks by chosen food) and `perMealQty` — unchanged logic, so "2 eggs" and `as_listed "2 Eggs"` still count as 2. It debits the running weekly total per day and returns, per day+meal, either `ok` or a `blocked` record `{ day, meal, food, need, remaining }`.
3. Any blocked day/meal renders inline, immediately, on that day: an amber panel naming the food and the remaining allowance, with the only remedy — a Select offering the other two suggestions for **that meal on that day**. Choosing one rewrites `days[i].meals[m]` to the new colour with empty picks; the rest of that day stays on the run colour. The replacement meal is itself run through the evaluator (a swap can't smuggle in another over-cap food).
4. Confirm stays disabled while any day/meal is blocked or any required pick is empty; the copy states the swap is the way forward.
5. Because the ledger is consulted, a second run of the same colour later in the same week finds the allowance already spent and blocks that meal on **all** days of the new run until the window rolls — the worked example (eggs cap 4, 2-egg breakfast: days 1–2 keep it, day 3 swaps; next run same week swaps every day) is a direct consequence and becomes a named test.

## e) Components and server

- `src/lib/mb-run.ts` — v2 types, `parseMbRun` upgrade, `startRun(colour, dates)`, `setDayPick`, `swapDayMeal`, `resolveDayMeal` (per-day successor to `resolveRunMeal`).
- `supabase/functions/_shared/mb-cap.ts` — keep `weeklyCapFor`, `perMealQty`, `capFoodFor` untouched. Replace the `needed = per × RUN_DAYS` rule with `planRunAgainstLedger` (sequential per-day debit against `cap − consumed`) plus `ledgerRowsForRun` (what to write on confirm) and `weekWindowFor`. Still the one module imported by both the browser (`src/lib/mb-food-list.ts` re-exports) and the edge function.
- `src/components/MbRunPlanner.tsx` — the three-card colour choice is unchanged; after locking, the body becomes Day 1 / Day 2 / Day 3 sections, each with the three meals, per-day picks, per-day swap control on a blocked meal, a "remaining this week" line for capped foods, and the existing gated Confirm button and server-error surface.
- `src/pages/ClientPortal.tsx` — My Plan tab props gain the ledger (returned by `mb-run get`); `mbRunGateActive` still keys off `confirmed_on`, unchanged. Home handoff (`onGoHome`) unchanged; the Home/recipe surface reads **today's** day entry from the run instead of the single meals object.
- `src/components/MbPlanMirror.tsx` (practitioner, read-only) — mirrors the same Day 1–3 layout with swap badges and the week's consumed/remaining tallies. Still zero controls, zero writes.
- `src/pages/Dashboard.tsx` — passes `mb_run` through as today plus the ledger for the mirror; no Custom-path change.
- `supabase/functions/mb-run/index.ts` — `get` returns run + `week_start` + `consumed`; `save` stays permissive and clears `confirmed_on`; `confirm` re-runs `planRunAgainstLedger` server-side against the practitioner's stored `mb_plan` suggestions (never client-supplied items) and the ledger read under the service role, rejects with `409 cap_exceeded` carrying per-day/per-meal detail, and on success writes `confirmed_on` **and** upserts the ledger rows. Zod schema updated to the v2 run (exactly 3 dated days, bounded picks); v1 payloads upgraded by the same shared parser so a stale tab can't corrupt a row.

## f) Build order (each phase independently testable)

1. **Model** — v2 `mb_run` types + read-time v1→v2 upgrade + day helpers in `src/lib/mb-run.ts`. Unit tests only; existing rows parse into an identical 3-day run.
2. **Ledger table** — migration for `public.mb_cap_ledger` with grants, RLS and the uniqueness key. Verified by direct query; nothing reads it yet.
3. **Evaluator** — `weekWindowFor`, `planRunAgainstLedger`, `ledgerRowsForRun` in `_shared/mb-cap.ts`, with `src/test/mb-cap.test.ts` rewritten around the eggs example (cap 4, 2-egg breakfast, days 1–2 ok / day 3 blocked; second run same week blocked on all days; window roll clears it).
4. **Server** — `mb-run` `get`/`confirm` updated to read and write the ledger, deployed; verified by posting an over-cap run and getting `409`, then confirming a clean run and seeing ledger rows.
5. **Client planner** — `MbRunPlanner` Day 1–3 layout, selection-time block, per-day swap, remaining-allowance copy, gated Confirm. Verified in the preview as an MB client.
6. **Mirror + Home handoff** — `MbPlanMirror` week/ledger view and the Home surface reading today's day. Verified side by side against the client portal.

Custom stays untouched in every phase; no file on the `own_practice` path is edited, and both cap stores stay exactly as they are.
