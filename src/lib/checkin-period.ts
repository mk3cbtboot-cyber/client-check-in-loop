// Current check-in period — one submission per period.
//
// Two deliberately separate paths (do NOT merge them):
//  - MB / MB-side clients: the period comes from the phase rules
//    (Phase 2 strict: daily for the first 14 days, then weekly; Phase 2
//    extended / Phase 3: weekly from the phase start).
//  - Custom Rx clients: the period comes from the practitioner-set cadence
//    (checkin_cadence + anchor + weekday/effective-from).
//
// Returns null when no period can be determined (Phase 1, Phase 4, missing
// phase start date, cadence "none"). Enforcement simply does not apply then.

import { diffDaysISO, shiftISO } from "@/lib/local-day";
import { dueCheckinDates, resolveCheckinSchedule, STRICT_DAYS } from "@/lib/checkin-schedule";
import type { CheckinScheduleClient } from "@/lib/checkin-schedule";

export interface CheckinPeriod {
  /** YYYY-MM-DD, inclusive. */
  start: string;
  /** YYYY-MM-DD, inclusive. */
  end: string;
}

export type CheckinPeriodClient = CheckinScheduleClient;

const dayOnly = (v: string | null | undefined): string | null =>
  typeof v === "string" && v.length >= 10 ? v.slice(0, 10) : null;

const isCustom = (c: CheckinPeriodClient): boolean =>
  c.client_type === "custom" || c.system_mode === "own_practice";

/** MB-side path: phase-driven. */
function mbPeriod(c: CheckinPeriodClient, today: string): CheckinPeriod | null {
  const phase = c.phase ?? null;
  if (!phase || phase === "phase1" || phase === "phase4") return null;
  const start = dayOnly(c.phase2_strict_started_at);
  if (!start) return null;

  if (phase === "phase2_strict") {
    const elapsed = diffDaysISO(start, today);
    if (elapsed < 0) return null;
    // Daily for the first 14 days.
    if (elapsed < STRICT_DAYS) return { start: today, end: today };
    // Then weekly, counted from day 14.
    const weeklyFrom = shiftISO(start, STRICT_DAYS);
    const blocks = Math.floor(diffDaysISO(weeklyFrom, today) / 7);
    const s = shiftISO(weeklyFrom, blocks * 7);
    return { start: s, end: shiftISO(s, 6) };
  }

  // Phase 2 extended / Phase 3: weekly from the phase start.
  const elapsed = diffDaysISO(start, today);
  if (elapsed < 0) return null;
  const s = shiftISO(start, Math.floor(elapsed / 7) * 7);
  return { start: s, end: shiftISO(s, 6) };
}

/** Custom Rx path: practitioner-set cadence. */
function customPeriod(c: CheckinPeriodClient, today: string): CheckinPeriod | null {
  const sched = resolveCheckinSchedule(c);
  if (sched.mode === "none" || !sched.anchor) return null;
  if (sched.mode === "daily") return { start: today, end: today };

  const step = sched.mode === "biweekly" ? 14 : 7;
  // Due dates around today define the period boundaries.
  const dues = dueCheckinDates(sched, shiftISO(today, -(step * 2)), shiftISO(today, step * 2));
  const startsOnOrBefore = dues.filter((d) => d <= today);
  const start = startsOnOrBefore.length ? startsOnOrBefore[startsOnOrBefore.length - 1] : null;
  if (!start) return null;
  const next = dues.find((d) => d > start);
  return { start, end: next ? shiftISO(next, -1) : shiftISO(start, step - 1) };
}

export function currentCheckinPeriod(c: CheckinPeriodClient, today: string): CheckinPeriod | null {
  return isCustom(c) ? customPeriod(c, today) : mbPeriod(c, today);
}

/** Is this local calendar day inside the period? */
export const isInPeriod = (p: CheckinPeriod | null, day: string): boolean =>
  !!p && day >= p.start && day <= p.end;
