# Phase 3 — one weekly-consumption store (`mb_cap_ledger`)

Goal: planning writes ledger rows, logging annotates them, every reader derives its number from that one table. `clients.food_limits` / `mb_food_limits` stay exactly as they are — they define caps, not consumption. `food_limit_counts` is retired.

MB only. Custom (`own_practice`) clients are untouched everywhere in this plan.

## 1. Schema change

Add three columns to `public.mb_cap_ledger` (all nullable / defaulted, so existing rows stay valid):

```text
status      text  not null default 'planned'   -- 'planned' | 'eaten' | 'skipped'
source      text  not null default 'run'       -- 'run' | 'log'
logged_at   timestamptz                        -- set when status flips to 'eaten'
recipe_id   uuid                               -- provenance of the log, nullable
```

Row shape, planned then eaten:

```text
{ client_id, week_start: '2026-08-24', day: '2026-08-26', meal: 'breakfast',
  food: 'eggs', qty: 2, run_started_on: '2026-08-26',
  status: 'planned', source: 'run', logged_at: null }

-- after the client logs that breakfast
  status: 'eaten', source: 'run', logged_at: '2026-08-26T07:40Z', recipe_id: …
```

Unplanned eaten food (client logged a recipe containing a capped food with no planned row for that day+meal):

```text
{ client_id, week_start: '2026-08-24', day: '2026-08-26', meal: 'lunch',
  food: 'avocado', qty: 1, run_started_on: null,
  status: 'eaten', source: 'log', logged_at: …, recipe_id: … }
```

The existing unique key `(client_id, day, meal, food)` still holds and is what makes this work: an unplanned row and a planned row for the same slot+food can never coexist — the logger updates the planned row instead of inserting.

Constraint to add: `check (status in ('planned','eaten','skipped'))`, `check (source in ('run','log'))`. Index `(client_id, week_start)` for the readers.

Grants unchanged (`select` to `authenticated`, `all` to `service_role`), RLS unchanged.

## 2. Run confirm (`mb-run` confirm)

Almost no change. The delete-then-insert of this run's days stays, with two adjustments:

- Insert rows with `status: 'planned'`, `source: 'run'`.
- The wholesale delete must **not** destroy already-eaten history. Change it to `delete … where client_id = … and day in (days) and status = 'planned'`. Rows already flipped to `eaten` (the client ate day 1, then re-plans days 2–3) survive re-confirmation and keep counting.

`ledgerRowsForRun` gains the two literal fields; `planRunAgainstLedger` is unchanged.

## 3. Meal logging (`log-mb-meal`) — the matching step

Today the logger derives `usesByKey` from `clients.food_limits` + ingredient regex. That derivation is kept verbatim (it is the only thing that knows how to read a recipe), but its output is written to the ledger rather than to `food_limit_counts`.

Per logged meal, for each `(food, qty)` in `usesByKey`:

1. **Slot match.** Look for a row `(client_id, day = today, meal = meal_type, status = 'planned')`.
2. **Food match** within that slot, in order:
   a. exact normalised equality (`eggs` = `Eggs`);
   b. the same loose containment `weeklyCapFor` already uses (`f.includes(rk) || rk.includes(f)`), so `egg` matches a planned `eggs` row;
   c. no match → unplanned.
3. **Matched** → `update status='eaten', logged_at=now(), recipe_id=…`, and set `qty` to the logged quantity **only when it differs** (the egg case: planned 2, cooked 3 → row becomes qty 3, eaten). Planned qty is a forecast; eaten qty is truth.
4. **Unmatched** → insert an `eaten` / `source='log'` row with `week_start = weekWindowFor(anchor, today).week_start`. On unique-key conflict (a planned row for the same food existed under a different meal-name spelling) fall back to the update path.
5. Planned rows for days that have passed with no log are left `planned` — they still count against the cap (the client committed to them). A later phase could add a nightly sweep to `skipped`; not in scope.

Egg-count case: `countEggsInRecipe` is unchanged and supplies the qty for the `eggs` key, so "3 eggs cooked against a planned 2" is recorded as 3 and the cap sees 3.

Substring risk: matching is scoped to one `(day, meal)` slot with at most a handful of rows, so the loose match can't collide across meals the way a global map can.

## 4. Readers — what each shows afterwards

All read `mb_cap_ledger` for the current window (`weekWindowFor(phase2_strict_started_at, today).week_start`), returned by the edge functions so no client re-derives it.

| Reader | Number shown | Definition |
|---|---|---|
| Portal card (`ClientTrackerRow`) | `used / cap`, `remaining` | used = **sum of qty for planned + eaten** in the window. This is "committed", which is the only number that matches what the run gate will let them do next. Card sub-line changes to "X eaten, Y planned". |
| Run gate (`planRunAgainstLedger`) | blocked / remaining | unchanged semantics: `cap − sum(qty of planned+eaten)`, still excluding the run being edited (excluded by `day`, as today). |
| Practitioner tracker (`Dashboard.tsx:1866`) | same as portal | same fold, compact variant. Practitioner also gets the eaten/planned split in the MB mirror. |
| AI assistant (`client-messages`) | "Used this week" | switch to the ledger fold, phrased explicitly: "eaten: {…}, planned: {…}, remaining: {…}". |

One shared fold helper in `_shared/mb-cap.ts` (`foldLedger(rows) → { eaten, planned, committed }`) used by every server reader, mirrored to the browser through the existing `src/lib/mb-food-list.ts` re-export.

**Decision needed (A):** portal card = *committed* (planned+eaten) or *eaten only*? I recommend committed, so the card never disagrees with the gate. Eaten-only is more literal ("what I've actually had") but will read lower than the allowance the gate enforces.

## 5. Retiring `food_limit_counts`

Reads/writes today: written in `log-mb-meal` (increment) and reset lazily every UTC Monday in `client-portal-data:60`; read in `client-portal-data` (portal payload), `ClientPortal.tsx:472`, `Dashboard.tsx:1866`, `client-messages:202,591`, and `log-mb-meal`'s own enforcement.

Migration:

1. Backfill — for each MB client with non-empty `food_limit_counts`, insert one `eaten` / `source='log'` row per food into the **current** window, `day = today`, `meal = 'unknown'`, qty = the count. Coarse but correct in total; history before this week is not reconstructable and is not needed (caps are weekly). Requires relaxing `meal` to allow `'unknown'` — it is free text, so no change needed.
2. Flip readers to the ledger (phase 5 below).
3. Stop writing the column and delete the Monday reset block.
4. Leave the column in place, unused, for one release; drop it in a follow-up migration.

The Monday reset disappears with the column — window boundaries come from `week_start` on each row.

**Decision needed (B):** backfill into a `meal='unknown'` bucket, or start the ledger clean and accept that in-flight clients get a one-time reset of this week's tallies? Clean start is simpler and self-heals in ≤7 days.

## 6. Week window

Standardise on `weekWindowFor(phase2_strict_started_at, today)` — the Phase-2-anchored rolling 7-day window already used by enforcement. To drop UTC-Monday:

- remove the `mondayOf` reset in `client-portal-data`;
- `log-mb-meal` computes `week_start` via `weekWindowFor` (it must import the shared module — it currently has its own `mondayOf`, which stays only for the unrelated `weekly_meal_plans` batch-cooking lookup);
- `client-portal-data` returns `week_start`, `week_end`, and the folded tallies so the portal shows the right dates;
- the portal card copy changes from "this week" to the window dates when they aren't Mon–Sun.

Fallback when `phase2_strict_started_at` is null is the existing one in `weekWindowFor` (anchor on the date being asked about) — unchanged.

## 7. Enforcement continuity

Both logging-path guards survive, in the same function, reading the ledger instead of the counts map:

- **Hard block (non-egg):** `used + uses > cap` where `used` is the ledger fold **minus any planned row in this same slot for that food** (otherwise a client's own plan blocks them from logging it). Same 400 response, same copy.
- **Egg `requires_confirmation` override:** unchanged shape (`eggs_in_meal`, `eggs_used_this_week`, `eggs_max_per_week`), with `eggs_used_this_week` from the ledger fold. `force: true` still writes through, and the resulting row records the real qty — so an over-cap confirmed meal is visible in the ledger rather than silently absorbed.

The run-gate backstop in `mb-run confirm` is untouched.

## 8. Phased rollout

1. **Schema** — migration adding `status`, `source`, `logged_at`, `recipe_id`, checks and index. Nothing reads them. Rollback: drop the four columns; the table works as before.
2. **Writers — plan side** — `mb-run confirm` writes `status/source` and deletes only `planned` rows. Verified by confirming a run and querying rows.
3. **Writers — log side** — `log-mb-meal` annotates/inserts ledger rows **while still writing `food_limit_counts`** (dual write). Verified by logging a planned meal, an over-plan egg meal and an unplanned capped food, then comparing the ledger fold to the counts map — they should agree.
4. **Readers** — `foldLedger` + switch portal payload, `ClientTrackerRow`, practitioner tracker, AI context, and both `log-mb-meal` guards to the ledger. Verified side-by-side against the still-live counts map.
5. **Retire** — remove the `food_limit_counts` write and the Monday reset, run the backfill (or clean start, per decision B). Column dropped in a later release.

Rollback for each phase is a code revert; only phase 1 touches schema and it is purely additive. The dual-write window in phase 3 means phases 3–4 can be reverted independently without losing consumption data.

## Decisions I need

- **A** — portal card shows committed (planned+eaten) or eaten only?
- **B** — backfill existing `food_limit_counts` into the ledger, or clean start?
- **C** — should an unlogged planned day eventually flip to `skipped` and free its allowance, or keep counting? (Plan currently: keeps counting, no sweep.)
