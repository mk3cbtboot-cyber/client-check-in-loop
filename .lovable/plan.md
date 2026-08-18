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
- **Locked view (per-meal colour override respected):** `mb_run.meals[x].colour` can differ from `run.colour` after a cap-conflict whole-meal swap, and the mirror must follow it. `MbRunPlanner`'s resolution (`const mealColour = rm?.colour ?? run.colour; const s = byColour.get(mealColour); const swapped = mealColour !== run.colour`) is extracted into a shared helper — `resolveRunMeal(run, suggestions, meal)` in `src/lib/mb-run.ts`, returning `{ colour, suggestion, items, picks, swapped }`. `MbRunPlanner` is refactored to call it (no behaviour change) and `MbPlanMirror` calls the same helper, so the two can never diverge. Each meal row renders with that meal's own colour bar/label, its items from that colour's suggestion, and a "swapped from <locked colour>" marker when `swapped` — matching what the client sees. Items with no pick render as "Not picked yet" in muted text. Header shows the locked run colour and the run's day span (`RUN_DAYS`).
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
2b. Cap-conflict swap — perform a whole-meal colour swap on one meal in the portal (or write a `meals[x].colour` override): the mirror shows that one meal in the swapped colour with the swapped colour's items and a "swapped" marker, while the other two meals stay on the locked colour. Side-by-side screenshots against My Plan.

3. Open MB Plan Setup: Phase 2 food list editor present and functional (delete an item, confirm it persists to `phase2_food_list` via a DB read, then restore defaults); Weekly Limits saves to `clients.food_limits` (verified by DB read); acknowledgement notice renders when acks exist.
4. Unconfirmed MB client: Client Plan shows the empty state, no crash.

Custom client:
5. Tab still reads "Meal Plan"; `CustomFoodListEditor` (food_list and food_list_generated) and the recipe-plan branch render and save unchanged; git diff shows no edits inside the `own_practice` branch.
