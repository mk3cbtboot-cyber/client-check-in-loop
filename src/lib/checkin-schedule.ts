// Check-in cadence engine — one queryable schedule for both tiers.
//
// MB clients derive their cadence from the phase rules (Phase 1 none,
// Phase 2 daily for the first 14 days then weekly, Phase 3 weekly,
// Phase 4 excluded). Custom clients use the practitioner-set cadence stored
// on clients.checkin_cadence / checkin_cadence_anchor. A practitioner-set
// cadence on an MB client also wins, so Phase 3 can be made settable later
// without touching this engine.

import { shiftISO } from "@/lib/local-day";

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
  created_at?: string | null;
}

export type ScheduleMode = "none" | "daily" | "weekly" | "biweekly" | "phase2";

export interface ResolvedSchedule {
  mode: ScheduleMode;
  /** YYYY-MM-DD the schedule counts from; null when there is no schedule. */
  anchor: string | null;
  label: string;
  source: "mb_phase" | "practitioner" | "default" | "none";
}

const dayOnly = (v: string | null | undefined): string | null =>
  typeof v === "string" && v.length >= 10 ? v.slice(0, 10) : null;

const isCustom = (c: CheckinScheduleClient): boolean =>
  c.client_type === "custom" || c.system_mode === "own_practice";

const NONE: ResolvedSchedule = { mode: "none", anchor: null, label: "No check-in schedule", source: "none" };

export function resolveCheckinSchedule(c: CheckinScheduleClient): ResolvedSchedule {
  const cadence = (c.checkin_cadence ?? "auto") as CheckinCadence;
  const explicitAnchor = dayOnly(c.checkin_cadence_anchor);
  const created = dayOnly(c.created_at);
  const phaseStart = dayOnly(c.phase2_strict_started_at);

  // Practitioner-set cadence always wins (both tiers).
  if (cadence !== "auto") {
    if (cadence === "none") return NONE;
    const anchor = explicitAnchor ?? phaseStart ?? created;
    if (!anchor) return NONE;
    return {
      mode: cadence,
      anchor,
      label: cadence === "daily" ? "Daily" : cadence === "weekly" ? "Weekly" : "Every 2 weeks",
      source: "practitioner",
    };
  }

  if (isCustom(c)) {
    // Custom default until the practitioner sets one: weekly from sign-up.
    const anchor = explicitAnchor ?? created;
    if (!anchor) return NONE;
    return { mode: "weekly", anchor, label: "Weekly (default)", source: "default" };
  }

  // MB: derived from the phase rules.
  const phase = c.phase ?? "phase1";
  if (phase === "phase1" || phase === "phase4") return NONE;
  const anchor = explicitAnchor ?? phaseStart;
  if (!anchor) return NONE;
  if (phase === "phase2_strict" || phase === "phase2_extended") {
    return { mode: "phase2", anchor, label: `Daily for ${STRICT_DAYS} days, then weekly`, source: "mb_phase" };
  }
  return { mode: "weekly", anchor, label: "Weekly", source: "mb_phase" };
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

  let d = sched.anchor;
  // Fast-forward to the window without looping from the epoch.
  while (d < from) d = shiftISO(d, step);
  while (d <= to) {
    out.push(d);
    d = shiftISO(d, step);
  }
  return out;
}

/** Was a check-in due on this exact date? */
export function isCheckinDue(sched: ResolvedSchedule, date: string): boolean {
  return dueCheckinDates(sched, date, date).length > 0;
}
