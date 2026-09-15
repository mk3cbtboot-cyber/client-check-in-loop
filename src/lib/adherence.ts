// Adherence % v1 — shared by Metabolic Balance and Custom clients.
//
//   score = 0.375 × meals% + 0.375 × water% + 0.25 × check-ins%
//
// Meals are "logged ÷ scheduled" with no swap-vs-deviation distinction (v1).
// Days with no scheduled meals (e.g. an MB client outside a confirmed run
// window) are excluded from the denominator, never counted as a failure.
// Every day boundary is taken in the client's own timezone.

import { localDayISO, localTodayISO, shiftISO } from "@/lib/local-day";
import {
  cadenceWindowDays,
  dueCheckinDates,
  resolveCheckinSchedule,
  type CheckinScheduleClient,
  type ResolvedSchedule,
} from "@/lib/checkin-schedule";

/** Longest window any cadence uses (biweekly). */
export const ADHERENCE_WINDOW_DAYS = 14;

export interface AdherenceClient extends CheckinScheduleClient {
  id?: string;
  meals_per_day?: number | null;
  plan_format?: string | null;
  phase?: string | null;
  water_target_litres?: number | null;
  timezone?: string | null;
  mb_run?: unknown;
}

export interface AdherenceInput {
  client: AdherenceClient;
  /** Meal logs (public.recipes rows, deleted ones already excluded). */
  mealLogs: { created_at: string }[];
  waterLogs: { log_date: string; litres: number | string }[];
  checkins: { created_at: string }[];
  /** Recipe Plan clients: how many recipe slots are assigned. */
  assignedSlots?: number;
  waterTarget: number;
  /** Override "today" (client-local) for tests. */
  today?: string;
  windowDays?: number;
}

export interface AdherenceComponent {
  done: number;
  total: number;
  pct: number | null;
}

export interface AdherenceResult {
  /** False when the client has no adherence window (Phase 1 / Phase 4 MB). */
  applicable: boolean;
  meals: AdherenceComponent;
  water: AdherenceComponent;
  checkins: AdherenceComponent;
  /** 0–100, or null when nothing could be measured yet. */
  score: number | null;
  windowStart: string;
  windowEnd: string;
  schedule: ResolvedSchedule;
}

const EMPTY: AdherenceComponent = { done: 0, total: 0, pct: null };

const pct = (done: number, total: number): number | null =>
  total > 0 ? Math.max(0, Math.min(100, (done / total) * 100)) : null;

const dayOnly = (v: string | null | undefined): string | null =>
  typeof v === "string" && v.length >= 10 ? v.slice(0, 10) : null;

/** Dates the confirmed MB run covers (3-day window). */
function mbRunDates(run: unknown): string[] {
  if (!run || typeof run !== "object") return [];
  const r = run as Record<string, unknown>;
  const started = typeof r.started_on === "string" ? r.started_on : null;
  const confirmed = typeof r.confirmed_on === "string" ? r.confirmed_on : null;
  if (!started || !confirmed) return [];
  return [0, 1, 2].map((i) => shiftISO(started, i));
}

/**
 * Meals scheduled on `date`, or null when the day has no plan at all and must
 * be excluded from the denominator.
 */
export function scheduledMealsOn(
  client: AdherenceClient,
  date: string,
  assignedSlots = 0,
): number | null {
  const custom = client.client_type === "custom" || client.system_mode === "own_practice";
  if (!custom) {
    const dates = mbRunDates(client.mb_run);
    return dates.includes(date) ? 3 : null;
  }
  const format = client.plan_format ?? "recipe";
  if (format === "recipe") return assignedSlots > 0 ? assignedSlots : null;
  const n = Number(client.meals_per_day ?? 3);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * True when this client has an adherence window at all: MB Phase 1/4 and any
 * client set to "no check-ins" get no badge.
 */
export function adherenceApplies(client: AdherenceClient): boolean {
  return resolveCheckinSchedule(client).mode !== "none";
}

export function computeAdherence(input: AdherenceInput): AdherenceResult {
  const { client, mealLogs, waterLogs, checkins, waterTarget } = input;
  const tz = client.timezone ?? null;
  const today = input.today ?? localTodayISO(tz);
  const schedule = resolveCheckinSchedule(client);
  // The window matches the client's current cadence period, so meals, water and
  // check-ins all describe the same stretch of time.
  const windowDays = input.windowDays ?? cadenceWindowDays(schedule, today);

  // The window ends yesterday — today is still in progress and would unfairly
  // drag every score down.
  const windowEnd = shiftISO(today, -1);
  let windowStart = shiftISO(windowEnd, -(windowDays - 1));
  const created = dayOnly(client.created_at);
  if (created && created > windowStart) windowStart = created;
  if (schedule.anchor && schedule.anchor > windowStart) windowStart = schedule.anchor;
  const phaseStart = dayOnly(client.phase2_strict_started_at);
  if (!(client.client_type === "custom" || client.system_mode === "own_practice") && phaseStart && phaseStart > windowStart) {
    windowStart = phaseStart;
  }

  const base: AdherenceResult = {
    applicable: false,
    meals: EMPTY,
    water: EMPTY,
    checkins: EMPTY,
    score: null,
    windowStart,
    windowEnd,
    schedule,
  };

  if (!adherenceApplies(client) || windowStart > windowEnd) return base;

  const days: string[] = [];
  for (let d = windowStart; d <= windowEnd; d = shiftISO(d, 1)) days.push(d);

  // --- Meals -------------------------------------------------------------
  const loggedByDay = new Map<string, number>();
  for (const r of mealLogs) {
    const d = localDayISO(r.created_at, tz);
    loggedByDay.set(d, (loggedByDay.get(d) ?? 0) + 1);
  }
  let mealsDone = 0;
  let mealsTotal = 0;
  for (const d of days) {
    const scheduled = scheduledMealsOn(client, d, input.assignedSlots ?? 0);
    if (scheduled == null) continue; // no plan that day — excluded
    mealsTotal += scheduled;
    mealsDone += Math.min(scheduled, loggedByDay.get(d) ?? 0);
  }

  // --- Water -------------------------------------------------------------
  const litresByDay = new Map<string, number>();
  for (const w of waterLogs) litresByDay.set(w.log_date, Number(w.litres) || 0);
  let waterDone = 0;
  for (const d of days) if ((litresByDay.get(d) ?? 0) >= waterTarget) waterDone += 1;

  // --- Check-ins ---------------------------------------------------------
  const due = dueCheckinDates(schedule, windowStart, windowEnd);
  const checkinDays = new Set(checkins.map((ci) => localDayISO(ci.created_at, tz)));
  let checkinsDone = 0;
  due.forEach((d, i) => {
    // Satisfied by a check-in on the due date or any day before the next one.
    const next = due[i + 1] ?? shiftISO(windowEnd, 1);
    for (let x = d; x < next; x = shiftISO(x, 1)) {
      if (checkinDays.has(x)) {
        checkinsDone += 1;
        return;
      }
    }
  });

  const meals: AdherenceComponent = { done: mealsDone, total: mealsTotal, pct: pct(mealsDone, mealsTotal) };
  const water: AdherenceComponent = { done: waterDone, total: days.length, pct: pct(waterDone, days.length) };
  const checkinsC: AdherenceComponent = { done: checkinsDone, total: due.length, pct: pct(checkinsDone, due.length) };

  // Weights renormalise over whatever can actually be measured.
  const parts: Array<[number | null, number]> = [
    [meals.pct, 0.375],
    [water.pct, 0.375],
    [checkinsC.pct, 0.25],
  ];
  let sum = 0;
  let weight = 0;
  for (const [p, w] of parts) {
    if (p == null) continue;
    sum += p * w;
    weight += w;
  }

  return {
    applicable: true,
    meals,
    water,
    checkins: checkinsC,
    score: weight > 0 ? Math.round(sum / weight) : null,
    windowStart,
    windowEnd,
    schedule,
  };
}

export type AdherenceBand = "strong" | "steady" | "slipping";

export function adherenceBand(score: number): AdherenceBand {
  if (score >= 85) return "strong";
  if (score >= 70) return "steady";
  return "slipping";
}

/** Contextual subtext for the client-list badge — the weakest component. */
export function adherenceSubtext(a: AdherenceResult): string {
  if (!a.applicable || a.score == null) return "Not enough data yet";
  const parts: Array<{ label: string; pct: number }> = [];
  if (a.meals.pct != null) parts.push({ label: "meal logging", pct: a.meals.pct });
  if (a.water.pct != null) parts.push({ label: "water target", pct: a.water.pct });
  if (a.checkins.pct != null) parts.push({ label: "check-ins", pct: a.checkins.pct });
  if (!parts.length) return "Not enough data yet";
  const worst = parts.reduce((m, p) => (p.pct < m.pct ? p : m));
  if (worst.pct >= 85) return "On track across meals, water and check-ins";
  return `${Math.round(worst.pct)}% on ${worst.label} — lowest of the three`;
}
