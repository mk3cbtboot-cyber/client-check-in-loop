# Tenacia — Run Expiry Prompt (Build Brief v1)

MB only. Window length stays 3 days. No auto-roll, no notifications/email.

## 1. Shared window helper
`runWindow(run, today?, runDays?)` in `src/lib/mb-run.ts` returns
`{ status, dates, lastDate, dayIndex, isActive, isLastDay, isExpired }`
with `status` one of `none | upcoming | active | last_day | expired`.
It is the single source of truth for "where is today in the run" and is used by
Home (`ClientPortal.tsx`) and the My Plan planner (`MbRunPlanner.tsx`).

## 2. Home (ClientPortal)
- Expired: banner "Your last 3 days of meals are complete — choose your next 3 days below",
  then the normal suggestion picker (unchanged fallback behaviour).
- Last day of an active run: pre-filled/locked view unchanged, plus the heads-up
  "You're on your last day of meals — pick your next 3 days tomorrow."
- `resolvedOptions` / `runSelections` now gate on `runWindow(...).isActive`.

## 3. My Plan (MbRunPlanner)
- Expired: the "confirmed through …" locked panel is replaced by the restart flow —
  an expiry prompt above the normal suggestion board, exactly the first-confirm path.

## 4. Re-confirm
One confirm path: on confirm, a run whose `started_on` is in the past is rebased to
today (stale day overrides dropped), so a new window starts correctly.

## 5. Practitioner side (report only, not changed)
Overview has no `mb_run`-derived copy — nothing stale there. The stale copy lives on the
practitioner Meal Plan tab in `MbPlanMirror`: "Locked for 3 days from <date>" and
"confirmed <date>" render with no expiry awareness, so an elapsed run still reads as locked.
Fix would be the same `runWindow` helper.
