// The MB client's current colour-locked 3-day run (clients.mb_run).
//
// v2 model — "pick once, applies to all three days":
//   • `meals` holds ONE set of picks for the run; every day inherits it.
//   • `day_overrides` only ever gains an entry when a weekly cap forces a
//     whole-meal swap on a specific day. A conflict-free run never materialises
//     three day forms.
// v1 rows (no version / no day_overrides) read as an identical 3-day run.

import type { MealType } from "@/lib/mb-foods";
import { MB_COLOURS, type MbColour, type MbPlanItem, type MbSuggestion } from "@/lib/mb-plan";

export const RUN_DAYS = 3;
export const RUN_MEALS: MealType[] = ["breakfast", "lunch", "dinner"];
export const MB_RUN_VERSION = 2;

/** Shared item quantity formatter — used by both the client planner and the practitioner mirror. */
export function fmtQty(it: MbPlanItem): string {
  if (it.unit === "g" && it.qty != null) return `${it.qty}g`;
  if (it.unit === "ml" && it.qty != null) return `${it.qty}ml`;
  if (it.unit === "count" && it.qty != null) return `${it.qty}`;
  return (it.note ?? "").trim();
}

export const todayISO = (): string => new Date().toISOString().slice(0, 10);

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const isISODate = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

export interface MbRunMeal {
  /** Colour this meal is actually taken from (differs only after a cap swap). */
  colour: MbColour;
  /** planItemId → chosen food. */
  picks: Record<string, string>;
}

/** Per-day, per-meal swap. Only present for days a cap forced off the run colour. */
export type MbDayOverrides = Partial<Record<MealType, MbRunMeal>>;

export interface MbRun {
  version: number;
  colour: MbColour | null;
  started_on: string | null;
  /** Set by the server when the client confirms a cap-clean run. */
  confirmed_on: string | null;
  /** Cap window this run was planned against (Phase 2 anchored). */
  week_start: string | null;
  /** The single set of picks that fills every day of the run. */
  meals: Record<MealType, MbRunMeal | null>;
  /** date (YYYY-MM-DD) → per-meal swaps for that day only. */
  day_overrides: Record<string, MbDayOverrides>;
}

export const emptyRun = (): MbRun => ({
  version: MB_RUN_VERSION,
  colour: null,
  started_on: null,
  confirmed_on: null,
  week_start: null,
  meals: { breakfast: null, lunch: null, dinner: null },
  day_overrides: {},
});

function parseRunMeal(raw: unknown, fallbackColour: MbColour | null): MbRunMeal | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rm = raw as Record<string, unknown>;
  const colour = MB_COLOURS.includes(rm.colour as MbColour)
    ? (rm.colour as MbColour)
    : fallbackColour;
  if (!colour) return null;
  const picksRaw = (rm.picks ?? {}) as Record<string, unknown>;
  const picks: Record<string, string> = {};
  for (const [k, v] of Object.entries(picksRaw)) {
    if (typeof v === "string" && v.trim()) picks[k] = v;
  }
  return { colour, picks };
}

export function parseMbRun(raw: unknown): MbRun {
  const out = emptyRun();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const o = raw as Record<string, unknown>;

  if (MB_COLOURS.includes(o.colour as MbColour)) out.colour = o.colour as MbColour;
  if (isISODate(o.started_on)) out.started_on = o.started_on;
  if (isISODate(o.confirmed_on)) out.confirmed_on = o.confirmed_on;
  if (isISODate(o.week_start)) out.week_start = o.week_start;

  const meals = (o.meals ?? {}) as Record<string, unknown>;
  for (const m of RUN_MEALS) {
    out.meals[m] = parseRunMeal(meals[m], out.colour);
  }

  const ov = (o.day_overrides ?? {}) as Record<string, unknown>;
  if (ov && typeof ov === "object" && !Array.isArray(ov)) {
    for (const [date, val] of Object.entries(ov)) {
      if (!isISODate(date) || !val || typeof val !== "object") continue;
      const day: MbDayOverrides = {};
      for (const m of RUN_MEALS) {
        const parsed = parseRunMeal((val as Record<string, unknown>)[m], out.colour);
        if (parsed) day[m] = parsed;
      }
      if (Object.keys(day).length) out.day_overrides[date] = day;
    }
  }

  // v1 rows carry no version and no day_overrides; everything above already
  // reads them as the same run, so the upgrade is just stamping the version.
  out.version = MB_RUN_VERSION;
  return out;
}

export function startRun(colour: MbColour, startDate: string = todayISO()): MbRun {
  return {
    version: MB_RUN_VERSION,
    colour,
    started_on: startDate,
    confirmed_on: null,
    week_start: null,
    meals: {
      breakfast: { colour, picks: {} },
      lunch: { colour, picks: {} },
      dinner: { colour, picks: {} },
    },
    day_overrides: {},
  };
}

/** The dates this run covers (always RUN_DAYS long once started). */
export function runDates(run: MbRun, runDays: number = RUN_DAYS): string[] {
  const start = run.started_on ?? todayISO();
  return Array.from({ length: runDays }, (_, i) => addDaysISO(start, i));
}

/** True when at least one day has been swapped off the run colour. */
export function hasDayOverrides(run: MbRun): boolean {
  return Object.values(run.day_overrides).some((d) => Object.keys(d ?? {}).length > 0);
}

/** Swap one meal on one day to another suggestion (the only sanctioned remedy). */
export function swapDayMeal(run: MbRun, date: string, meal: MealType, colour: MbColour): MbRun {
  const next = structuredClone(run);
  const day = next.day_overrides[date] ?? {};
  day[meal] = { colour, picks: {} };
  next.day_overrides[date] = day;
  next.confirmed_on = null;
  return next;
}

/** Drop a day's swap so the meal returns to the run colour. */
export function clearDayMeal(run: MbRun, date: string, meal: MealType): MbRun {
  const next = structuredClone(run);
  const day = next.day_overrides[date];
  if (day) {
    delete day[meal];
    if (Object.keys(day).length === 0) delete next.day_overrides[date];
  }
  next.confirmed_on = null;
  return next;
}

export interface ResolvedRunMeal {
  /** Colour this meal is actually taken from (may differ after a cap swap). */
  colour: MbColour;
  suggestion: MbSuggestion | undefined;
  items: MbPlanItem[];
  picks: Record<string, string>;
  /** True when the meal was swapped away from the locked run colour. */
  swapped: boolean;
}

/**
 * Single source of truth for "which suggestion does this meal come from".
 * Base (run-level) resolution: the picks that fill every unswapped day.
 * Both MbRunPlanner (client) and MbPlanMirror (practitioner) use this so the two
 * views can never diverge.
 */
export function resolveRunMeal(
  run: MbRun,
  suggestions: MbSuggestion[],
  meal: MealType,
): ResolvedRunMeal {
  const rm = run.meals[meal];
  const colour = (rm?.colour ?? run.colour) as MbColour;
  const suggestion = suggestions.find((s) => s.colour === colour);
  return {
    colour,
    suggestion,
    items: suggestion?.meals?.[meal]?.items ?? [],
    picks: rm?.picks ?? {},
    swapped: !!run.colour && colour !== run.colour,
  };
}

/**
 * Per-day resolution: the day's override when a cap forced a swap there,
 * otherwise the shared run-level meal (pick once, applies to all three days).
 */
export function resolveDayMeal(
  run: MbRun,
  suggestions: MbSuggestion[],
  date: string,
  meal: MealType,
): ResolvedRunMeal {
  const override = run.day_overrides[date]?.[meal];
  if (!override) return resolveRunMeal(run, suggestions, meal);
  const suggestion = suggestions.find((s) => s.colour === override.colour);
  return {
    colour: override.colour,
    suggestion,
    items: suggestion?.meals?.[meal]?.items ?? [],
    picks: override.picks,
    swapped: !!run.colour && override.colour !== run.colour,
  };
}
