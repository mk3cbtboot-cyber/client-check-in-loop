// Server-side mirror of src/lib/checkin-period.ts.
//
// Two deliberately separate paths (do NOT merge them):
//  - MB-side clients: period derived from the phase rules.
//  - Custom Rx clients: period derived from the practitioner-set cadence
//    (checkin_cadence + anchor + weekday/effective-from).
//
// Returns null when no period is determinable (Phase 1/4, missing phase start,
// cadence "none") — duplicate enforcement then does not apply.

import { diffDaysISO, shiftISO, weekdayOfISO } from "./local-day.ts";

export const STRICT_DAYS = 14;

export interface CheckinPeriod {
  start: string;
  end: string;
}

export interface PeriodClient {
  client_type?: string | null;
  system_mode?: string | null;
  phase?: string | null;
  phase2_strict_started_at?: string | null;
  checkin_cadence?: string | null;
  checkin_cadence_anchor?: string | null;
  checkin_weekday?: number | null;
  checkin_weekday_effective_from?: string | null;
  created_at?: string | null;
}

const dayOnly = (v: unknown): string | null =>
  typeof v === "string" && v.length >= 10 ? v.slice(0, 10) : null;

const isCustom = (c: PeriodClient): boolean =>
  c.client_type === "custom" || c.system_mode === "own_practice";

function mbPeriod(c: PeriodClient, today: string): CheckinPeriod | null {
  const phase = c.phase ?? null;
  if (!phase || phase === "phase1" || phase === "phase4") return null;
  const start = dayOnly(c.phase2_strict_started_at);
  if (!start) return null;
  const elapsed = diffDaysISO(start, today);
  if (elapsed < 0) return null;

  if (phase === "phase2_strict") {
    if (elapsed < STRICT_DAYS) return { start: today, end: today };
    const weeklyFrom = shiftISO(start, STRICT_DAYS);
    const blocks = Math.floor(diffDaysISO(weeklyFrom, today) / 7);
    const s = shiftISO(weeklyFrom, blocks * 7);
    return { start: s, end: shiftISO(s, 6) };
  }

  const s = shiftISO(start, Math.floor(elapsed / 7) * 7);
  return { start: s, end: shiftISO(s, 6) };
}

function customPeriod(c: PeriodClient, today: string): CheckinPeriod | null {
  const cadence = (c.checkin_cadence ?? "auto") as string;
  if (cadence === "none") return null;
  if (cadence === "daily") return { start: today, end: today };

  const anchor = dayOnly(c.checkin_cadence_anchor) ?? dayOnly(c.phase2_strict_started_at) ?? dayOnly(c.created_at);
  if (!anchor) return null;
  const step = cadence === "biweekly" ? 14 : 7;

  const weekday =
    typeof c.checkin_weekday === "number" && c.checkin_weekday >= 0 && c.checkin_weekday <= 6
      ? c.checkin_weekday
      : null;
  const switchOn = weekday == null ? null : (dayOnly(c.checkin_weekday_effective_from) ?? anchor);

  // Before the weekday switch (or when none is set): anchor-stepped periods.
  if (switchOn == null || today < switchOn) {
    if (today < anchor) return null;
    const s = shiftISO(anchor, Math.floor(diffDaysISO(anchor, today) / step) * step);
    const end = switchOn != null && shiftISO(s, step - 1) >= switchOn ? shiftISO(switchOn, -1) : shiftISO(s, step - 1);
    return { start: s, end };
  }

  // From the switch date onwards: periods land on the chosen weekday.
  let first = switchOn;
  while (weekdayOfISO(first) !== weekday) first = shiftISO(first, 1);
  if (today < first) {
    // Gap between the switch date and the first chosen weekday.
    return { start: switchOn, end: shiftISO(first, -1) };
  }
  const s = shiftISO(first, Math.floor(diffDaysISO(first, today) / step) * step);
  return { start: s, end: shiftISO(s, step - 1) };
}

export function currentCheckinPeriod(c: PeriodClient, today: string): CheckinPeriod | null {
  return isCustom(c) ? customPeriod(c, today) : mbPeriod(c, today);
}
