// Check-in cadence engine — one queryable schedule for both tiers.
//
// MB clients derive their cadence from the phase rules (Phase 1 none,
// Phase 2 daily for the first 14 days then weekly, Phase 3 weekly,
// Phase 4 excluded). Custom clients use the practitioner-set cadence stored
// on clients.checkin_cadence / checkin_cadence_anchor. A practitioner-set
// cadence on an MB client also wins, so Phase 3 can be made settable later
// without touching this engine.

import { diffDaysISO, shiftISO, weekdayOfISO } from "@/lib/local-day";

export type CheckinCadence = "auto" | "daily" | "weekly" | "biweekly" | "none";

export const CADENCE_OPTIONS: { value: CheckinCadence; label: string }[] = [
  { value: "auto", label: "Automatic (weekly)" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "none", label: "No check-ins" },
];

export const STRICT_DAYS = 14;

export interface CheckinScheduleClient {
  client_type?: string | null;
  system_mode?: string | null;
  phase?: string | null;
  phase2_strict_started_at?: string | null;
  checkin_cadence?: string | null;
  checkin_cadence_anchor?: string | null;
  /** Custom clients only: 0 = Sunday .. 6 = Saturday. */
  checkin_weekday?: number | null;
  /** Date the weekday setting took effect — earlier due dates keep the old rule. */
  checkin_weekday_effective_from?: string | null;
  created_at?: string | null;
}

export type ScheduleMode = "none" | "daily" | "weekly" | "biweekly" | "phase2";

export const WEEKDAY_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 0, label: "Sunday" },
];

export const weekdayLabel = (d: number | null | undefined): string | null =>
  WEEKDAY_OPTIONS.find((o) => o.value === d)?.label ?? null;

export interface ResolvedSchedule {
  mode: ScheduleMode;
  /** YYYY-MM-DD the schedule counts from; null when there is no schedule. */
  anchor: string | null;
  label: string;
  source: "mb_phase" | "practitioner" | "default" | "none";
  /** Chosen weekday (Custom weekly/biweekly only), null when unset. */
  weekday: number | null;
  /** Date from which `weekday` applies; before it, history is preserved. */
  weekdayFrom: string | null;
}

const dayOnly = (v: string | null | undefined): string | null =>
  typeof v === "string" && v.length >= 10 ? v.slice(0, 10) : null;

const isCustom = (c: CheckinScheduleClient): boolean =>
  c.client_type === "custom" || c.system_mode === "own_practice";

const NONE: ResolvedSchedule = {
  mode: "none",
  anchor: null,
  label: "No check-in schedule",
  source: "none",
  weekday: null,
  weekdayFrom: null,
};

export function resolveCheckinSchedule(c: CheckinScheduleClient): ResolvedSchedule {
  const cadence = (c.checkin_cadence ?? "auto") as CheckinCadence;
  const explicitAnchor = dayOnly(c.checkin_cadence_anchor);
  const created = dayOnly(c.created_at);
  const phaseStart = dayOnly(c.phase2_strict_started_at);
  // The weekday setting is a Custom-only control; MB stays phase-derived.
  const weekday =
    isCustom(c) && typeof c.checkin_weekday === "number" && c.checkin_weekday >= 0 && c.checkin_weekday <= 6
      ? c.checkin_weekday
      : null;
  const weekdayFrom = weekday == null ? null : dayOnly(c.checkin_weekday_effective_from);

  // Practitioner-set cadence always wins (both tiers).
  if (cadence !== "auto") {
    if (cadence === "none") return NONE;
    const anchor = explicitAnchor ?? phaseStart ?? created;
    if (!anchor) return NONE;
    const weekly = cadence === "weekly" || cadence === "biweekly";
    const wd = weekly ? weekday : null;
    const base = cadence === "daily" ? "Daily" : cadence === "weekly" ? "Weekly" : "Every 2 weeks";
    const wdName = weekdayLabel(wd);
    return {
      mode: cadence,
      anchor,
      label: wdName ? `${base} (${wdName}s)` : base,
      source: "practitioner",
      weekday: wd,
      weekdayFrom: wd == null ? null : weekdayFrom,
    };
  }

  if (isCustom(c)) {
    // Custom default until the practitioner sets one: weekly from sign-up.
    const anchor = explicitAnchor ?? created;
    if (!anchor) return NONE;
    const wdName = weekdayLabel(weekday);
    return {
      mode: "weekly",
      anchor,
      label: wdName ? `Weekly (${wdName}s)` : "Weekly (default)",
      source: "default",
      weekday,
      weekdayFrom: weekday == null ? null : weekdayFrom,
    };
  }

  // MB: derived from the phase rules.
  const phase = c.phase ?? "phase1";
  if (phase === "phase1" || phase === "phase4") return NONE;
  const anchor = explicitAnchor ?? phaseStart;
  if (!anchor) return NONE;
  if (phase === "phase2_strict" || phase === "phase2_extended") {
    return {
      mode: "phase2",
      anchor,
      label: `Daily for ${STRICT_DAYS} days, then weekly`,
      source: "mb_phase",
      weekday: null,
      weekdayFrom: null,
    };
  }
  return { mode: "weekly", anchor, label: "Weekly", source: "mb_phase", weekday: null, weekdayFrom: null };
}

/** Every date (YYYY-MM-DD) a check-in was due, inclusive of `from`..`to`. */
export function dueCheckinDates(sched: ResolvedSchedule, from: string, to: string): string[] {
  if (sched.mode === "none" || !sched.anchor || from > to) return [];
  const out: string[] = [];
  const push = (d: string) => {
    if (d >= from && d <= to) out.push(d);
  };

  if (sched.mode === "daily") {
    let d = sched.anchor > from ? sched.anchor : from;
    while (d <= to) {
      out.push(d);
      d = shiftISO(d, 1);
    }
    return out;
  }

  const step = sched.mode === "biweekly" ? 14 : 7;
  if (sched.mode === "phase2") {
    for (let i = 0; i < STRICT_DAYS; i++) push(shiftISO(sched.anchor, i));
    let d = shiftISO(sched.anchor, STRICT_DAYS);
    while (d <= to) {
      push(d);
      d = shiftISO(d, 7);
    }
    return out;
  }

  // Weekly / biweekly. A chosen weekday only applies from its effective date —
  // due dates before that keep the original anchor-based rule, so a mid-stream
  // weekday change never rewrites a client's past adherence score.
  const switchOn = sched.weekday == null ? null : sched.weekdayFrom ?? sched.anchor;

  let d = sched.anchor;
  while (d < from && (switchOn == null || d < switchOn)) d = shiftISO(d, step);
  while (d <= to && (switchOn == null || d < switchOn)) {
    push(d);
    d = shiftISO(d, step);
  }

  if (switchOn != null && sched.weekday != null) {
    let s = switchOn;
    while (weekdayOfISO(s) !== sched.weekday) s = shiftISO(s, 1);
    while (s < from) s = shiftISO(s, step);
    while (s <= to) {
      push(s);
      s = shiftISO(s, step);
    }
  }
  return out;
}

/** Was a check-in due on this exact date? */
export function isCheckinDue(sched: ResolvedSchedule, date: string): boolean {
  return dueCheckinDates(sched, date, date).length > 0;
}

/** The next date a check-in falls due on or after `from`, or null within a year. */
export function nextCheckinDue(sched: ResolvedSchedule, from: string): string | null {
  if (sched.mode === "none") return null;
  return dueCheckinDates(sched, from, shiftISO(from, 370))[0] ?? null;
}

/**
 * Adherence window length (days) matching the client's current cadence period.
 * Daily periods grow with days elapsed (capped at 14); weekly cadences use a
 * trailing 7 days; biweekly stays at 14.
 */
export function cadenceWindowDays(sched: ResolvedSchedule, today: string): number {
  if (sched.mode === "biweekly") return 14;
  if (sched.mode === "daily") {
    if (!sched.anchor) return 14;
    return Math.max(1, Math.min(14, diffDaysISO(sched.anchor, today)));
  }
  if (sched.mode === "phase2" && sched.anchor) {
    const elapsed = diffDaysISO(sched.anchor, today);
    // Days 1-14 = the daily period: window grows with days elapsed.
    if (elapsed <= STRICT_DAYS) return Math.max(1, Math.min(STRICT_DAYS, elapsed));
    return 7;
  }
  return 7;
}
