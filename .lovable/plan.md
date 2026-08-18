# MB practitioner portal: "Client Plan" mirror + editor relocation

Gated entirely by **client type = MB** (`client.system_mode !== "own_practice"`). Tier plays no part.

## a) New component: `src/components/MbPlanMirror.tsx`

Read-only presentational component. No token, no Supabase calls, no writes, no selects/dropdowns/buttons that mutate.

Props:
- `suggestions: MbSuggestion[]` (from the resolver)
- `foodList: MbFoodListMap`
- `run: unknown` (raw `clients.mb_run`)
- `confirmed: boolean` (whether the plan is live)
- `clientName: string`

Shared libs reused — exactly the ones the client planner uses:
- `@/lib/mb-plan` — `getMbPlan`, `MbSuggestion`, `MbPlanItem`, `MbColour`
- `@/lib/mb-run` — `parseMbRun`, `RUN_DAYS`, `RUN_MEALS`
- `@/lib/mb-food-list` — `categoryLabel`
- The same `fmtQty` item formatter currently living in `MbRunPlanner` — it moves to a shared export (`src/lib/mb-run.ts` or a small `mb-format` helper) and both components import it, so the two views can never drift.

Branching rule (single decision, mirrors the planner):
```
const run = parseMbRun(client.mb_run)
run?.colour  → locked view
otherwise    → three-card view
```
- **Locked view:** the locked colour's header bar + label, and for each of the 3 meals the item rows showing the client's actual pick (`run.meals[meal].picks`) with the plan item's qty/unit; any item the client hasn't picked yet renders as "Not picked yet" in muted text. Includes the run's day/date span (`RUN_DAYS`) the same way the client sees it.
- **Three-card view:** the same three colour cards the client sees before locking — colour bar, Suggestion label, meal panels with item label + qty/unit — rendered read-only.
- If the plan is not confirmed, it shows the existing "no live plan yet" empty state pointing at MB Plan Setup.

Data source in Dashboard: `load()` already does `select("*")`, so `mb_run`, `mb_food_list`, `mb_plan`, `mb_food_limits` are all on the client row already. **No fetch change needed.**

## b) Relocating the two editors into MB Plan Setup

`src/components/MbPlanSetup.tsx` gains two new sections inside the existing scrollable dialog body, placed after `<MbPersonalFoodList />` and before the "Food caps" card:

1. **Phase 2 food list editor** — the section/item delete UI, "Restore Defaults" dialog, the phase2/phase3 headings and empty states, moved verbatim from `Dashboard.tsx`'s `mealplan` tab. It keeps calling the exact same Dashboard handlers (`restorePhase2Defaults`, `deletePhase2Section`, `deletePhase2Item`) — these are passed into `MbPlanSetup` as props rather than reimplemented, so what is written (`phase2_food_list` + legacy columns) is unchanged, and `categoriesForPhase` stays the single resolver.
2. **Weekly limits** — `<WeeklyLimitsEditor value={client.food_limits ?? {}} onSave={…saveWeeklyFoodLimits} />` moved as-is, with the read-only weekly-acknowledgement notice directly beneath it (acks passed in as a prop from `weeklyAcks[client.id]`).

Also relocated: the Phase 3 read-only extended food list block, so nothing from the old tab is lost.

Write behaviour and runtime consumption are unchanged: same columns (`phase2_food_list`, `food_limits`), same handlers, same optimistic-update/rollback logic in Dashboard, same reads in the portal and edge functions. This is a move, not a rewrite. The parallel legacy/new stores (two food-list stores, two caps stores) are left exactly as they are — out of scope.

## c) Gating the rename and body swap

In `src/pages/Dashboard.tsx`:
- Tab trigger (line ~1975) becomes `{client.system_mode === "own_practice" ? "Meal Plan" : "Client Plan"}`.
- `<TabsContent value="mealplan">`: the existing `client.system_mode === "own_practice" ? (…) : (…)` branch stays. The **true** branch (Custom: `CustomFoodListEditor` / `RecipePlanAssignments` / fallback text) is left byte-for-byte identical — no reindentation, no prop changes. The **false** branch (all the phase2/phase3/weekly-limits JSX) is replaced with a single `<MbPlanMirror … />`, with the removed JSX moved into `MbPlanSetup`.
- The tab `value` stays `"mealplan"` so `_activeTab` navigation and the Custom "go to macros"/plan-generation flows keep working.

## d) Verification plan

MB client (Scott Strong or similar, confirmed plan):
1. Before a pick — clear/absent `mb_run`: Client Plan tab shows three read-only Suggestion cards matching the client's My Plan pre-lock view; no dropdowns, no buttons.
2. After a pick — lock a colour and pick foods in the client portal, reload the practitioner view: Client Plan shows only the locked colour with those exact picks; screenshot both sides for a like-for-like comparison.
3. Open MB Plan Setup: Phase 2 food list editor present and functional (delete an item, confirm it persists to `phase2_food_list` via a DB read, then restore defaults); Weekly Limits saves to `clients.food_limits` (verified by DB read); acknowledgement notice renders when acks exist.
4. Unconfirmed MB client: Client Plan shows the empty state, no crash.

Custom client:
5. Tab still reads "Meal Plan"; `CustomFoodListEditor` (food_list and food_list_generated) and the recipe-plan branch render and save unchanged; git diff shows no edits inside the `own_practice` branch.
