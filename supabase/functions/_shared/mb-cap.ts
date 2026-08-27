// Single source of truth for MB weekly-cap evaluation.
//
// This file is imported BOTH by the browser client (src/lib/mb-food-list.ts and
// MbRunPlanner) and by the mb-run edge function, so the client gate and the
// server backstop can never disagree. Keep it dependency-free: no Deno APIs,
// no DOM APIs, no "@/..." imports — plain TypeScript only.
//
// Cap stores are unchanged and both stay in place:
//   1. mb_food_limits (enriched, authoritative)
//   2. food_limits    (legacy flat map, fallback)

export interface CapItem {
  id?: string;
  category?: string;
  label?: string;
  qty?: number | null;
  unit?: string;
  note?: string;
  optional?: boolean;
}

export interface CapLimit {
  food: string;
  type?: string;
  max?: number | null;
}

export interface CapMeal {
  items?: CapItem[];
}

export interface CapSuggestion {
  colour: string;
  label?: string;
  meals?: Record<string, CapMeal | undefined>;
}

export interface CapRunMeal {
  colour?: string;
  picks?: Record<string, string>;
}

export interface CapRun {
  colour?: string | null;
  meals?: Record<string, CapRunMeal | null | undefined>;
}

export interface CapViolation {
  meal: string;
  item_id: string;
  food: string;
  per_meal: number;
  needed: number;
  cap: number;
}

export const RUN_DAYS_DEFAULT = 3;
export const CAP_RUN_MEALS = ["breakfast", "lunch", "dinner"] as const;

const norm = (s: string) => s.trim().toLowerCase();

/**
 * The weekly max for a food: enriched mb_food_limits first, legacy flat
 * food_limits second. Returns null when the food is uncapped.
 */
export function weeklyCapFor(
  food: string,
  enriched: CapLimit[] | null | undefined,
  legacy: Record<string, number> | null | undefined,
): number | null {
  const f = norm(food ?? "");
  if (!f) return null;
  for (const row of enriched ?? []) {
    if (!row || row.type !== "weekly" || row.max == null) continue;
    const rf = norm(String(row.food ?? ""));
    if (!rf) continue;
    if (rf === f || f.includes(rf) || rf.includes(f)) return row.max;
  }
  for (const [k, v] of Object.entries(legacy ?? {})) {
    const rk = norm(k);
    const n = Number(v);
    if (!rk || !Number.isFinite(n) || n <= 0) continue;
    if (rk === f || f.includes(rk) || rk.includes(f)) return n;
  }
  return null;
}

/**
 * Real per-meal quantity for cap math.
 *  - count  → qty (e.g. 2 eggs = 2)
 *  - g / ml → 1 serving (caps count servings, not grams)
 *  - as_listed → leading whole number 1..20 parsed out of the note, else the
 *    label ("2 Eggs" → 2). Anything unparseable falls back to 1, which is
 *    exactly today's behaviour, so a bad parse can never invent a quantity.
 * Read-only: nothing is ever written back to the plan.
 */
export function perMealQty(item: CapItem | null | undefined): number {
  if (!item) return 1;
  const qty = typeof item.qty === "number" && Number.isFinite(item.qty) ? item.qty : null;
  if (item.unit === "count" && qty != null && qty > 0) return qty;
  if (item.unit === "g" || item.unit === "ml") return 1;
  const fromText = (s: string | undefined): number | null => {
    const m = /^\s*(\d{1,2})\b/.exec(String(s ?? ""));
    if (!m) return null;
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n <= 0 || n > 20) return null;
    return n;
  };
  return fromText(item.note) ?? fromText(item.label) ?? (qty != null && qty > 0 ? qty : 1);
}

/** The food name a cap lookup should use for an item + the client's pick. */
export function capFoodFor(item: CapItem, pick?: string | null): string {
  if (item.category === "fixed") return String(item.label ?? "").trim();
  return String(pick ?? "").trim();
}

/**
 * True when a weekly-capped food cannot cover every day of the run at the
 * item's per-meal quantity.
 */
export function capBlocksRun(
  food: string,
  perMealQuantity: number | null,
  runDays: number,
  enriched: CapLimit[] | null | undefined,
  legacy: Record<string, number> | null | undefined,
): { blocked: boolean; cap: number | null; needed: number } {
  const cap = weeklyCapFor(food, enriched, legacy);
  const per = perMealQuantity && perMealQuantity > 0 ? perMealQuantity : 1;
  const needed = per * runDays;
  return { blocked: cap != null && needed > cap, cap, needed };
}

/**
 * Evaluate every meal of a run (fixed items included) against the caps.
 * The item list always comes from the practitioner's plan — never from the
 * client payload — so quantities cannot be spoofed.
 */
export function evaluateRunCaps(
  run: CapRun | null | undefined,
  suggestions: CapSuggestion[] | null | undefined,
  enriched: CapLimit[] | null | undefined,
  legacy: Record<string, number> | null | undefined,
  runDays: number = RUN_DAYS_DEFAULT,
): CapViolation[] {
  const out: CapViolation[] = [];
  if (!run) return out;
  for (const meal of CAP_RUN_MEALS) {
    const rm = run.meals?.[meal] ?? null;
    const colour = rm?.colour ?? run.colour ?? null;
    if (!colour) continue;
    const suggestion = (suggestions ?? []).find((s) => s?.colour === colour);
    const items = suggestion?.meals?.[meal]?.items ?? [];
    for (const it of items) {
      const pick = rm?.picks?.[String(it.id ?? "")];
      const food = capFoodFor(it, pick);
      if (!food) continue;
      const per = perMealQty(it);
      const res = capBlocksRun(food, per, runDays, enriched, legacy);
      if (res.blocked && res.cap != null) {
        out.push({
          meal,
          item_id: String(it.id ?? ""),
          food,
          per_meal: per,
          needed: res.needed,
          cap: res.cap,
        });
      }
    }
  }
  return out;
}

export function describeViolation(v: CapViolation): string {
  const meal = v.meal.charAt(0).toUpperCase() + v.meal.slice(1);
  return `${meal} — ${v.food}: ${v.needed} needed for this run, weekly cap is ${v.cap}.`;
}

/* ------------------------------------------------------------------ */
/* Weekly ledger model (v2)                                            */
/*                                                                     */
/* A run is still ONE colour for 3 days with one set of picks. Caps are */
/* a rolling 7-day window anchored on the client's Phase 2 start date,  */
/* and consumption accumulates across every run inside that window.     */
/* When a capped food runs out mid-run, the affected meal is blocked on */
/* the remaining day(s) only — the remedy is a whole-meal swap there.    */
/* ------------------------------------------------------------------ */

export interface CapDayOverrides {
  [meal: string]: CapRunMeal | undefined;
}

/** v2 run shape (plain data — mirrors src/lib/mb-run.ts). */
export interface CapRunV2 {
  colour?: string | null;
  started_on?: string | null;
  meals?: Record<string, CapRunMeal | null | undefined>;
  day_overrides?: Record<string, CapDayOverrides | undefined>;
}

/** week_start → food (as stored) → quantity already consumed. */
export type CapConsumed = Record<string, Record<string, number>>;

export interface CapWeekWindow {
  week_start: string;
  week_end: string;
  index: number;
}

export interface CapMealPlanResult {
  meal: string;
  colour: string;
  blocked: boolean;
  /** Populated when blocked. */
  food?: string;
  need?: number;
  remaining?: number;
  cap?: number;
}

export interface CapDayPlanResult {
  date: string;
  week_start: string;
  meals: CapMealPlanResult[];
}

export interface CapLedgerRow {
  week_start: string;
  day: string;
  meal: string;
  food: string;
  qty: number;
  status: "planned" | "eaten" | "skipped";
  source: "run" | "log";
}

export interface CapPlanResult {
  days: CapDayPlanResult[];
  blocks: Array<CapMealPlanResult & { date: string; week_start: string }>;
  /** Rows to write to the ledger if this run were confirmed as planned. */
  rows: CapLedgerRow[];
}

const DAY_MS = 86400000;

const dayNum = (iso: string): number => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
const isoFromNum = (n: number): string => new Date(n * DAY_MS).toISOString().slice(0, 10);

export function addDays(iso: string, days: number): string {
  return isoFromNum(dayNum(iso) + days);
}

/**
 * The 7-day cap window a date falls in, counted from the Phase 2 start date.
 * Phase 2 (14 days) is therefore exactly two consecutive windows off the same
 * anchor. Dates before the anchor fall in window index 0.
 * With no anchor, the date itself starts the window (deterministic fallback).
 */
export function weekWindowFor(
  anchor: string | null | undefined,
  onDate: string,
  weekLength = 7,
): CapWeekWindow {
  const base = anchor && /^\d{4}-\d{2}-\d{2}/.test(anchor) ? anchor.slice(0, 10) : onDate;
  const diff = dayNum(onDate) - dayNum(base);
  const index = diff < 0 ? 0 : Math.floor(diff / weekLength);
  const week_start = addDays(base, index * weekLength);
  return { week_start, week_end: addDays(week_start, weekLength - 1), index };
}

/**
 * Quantity of `food` already consumed in a window. Uses the same loose name
 * matching as weeklyCapFor so "Eggs" and "eggs" (or "egg breakfast") agree.
 */
export function consumedFor(
  food: string,
  weekConsumed: Record<string, number> | null | undefined,
): number {
  const f = norm(food ?? "");
  if (!f) return 0;
  let total = 0;
  for (const [k, v] of Object.entries(weekConsumed ?? {})) {
    const rk = norm(k);
    const n = Number(v);
    if (!rk || !Number.isFinite(n) || n <= 0) continue;
    if (rk === f || f.includes(rk) || rk.includes(f)) total += n;
  }
  return total;
}

function resolveDayMealItems(
  run: CapRunV2,
  suggestions: CapSuggestion[] | null | undefined,
  date: string,
  meal: string,
): { colour: string | null; items: CapItem[]; picks: Record<string, string> } {
  const override = run.day_overrides?.[date]?.[meal] ?? null;
  const base = run.meals?.[meal] ?? null;
  const source = override ?? base;
  const colour = source?.colour ?? run.colour ?? null;
  if (!colour) return { colour: null, items: [], picks: {} };
  const suggestion = (suggestions ?? []).find((s) => s?.colour === colour);
  return {
    colour,
    items: suggestion?.meals?.[meal]?.items ?? [],
    picks: source?.picks ?? {},
  };
}

/** The capped-food demand of one meal: food → quantity. */
function mealDemand(
  items: CapItem[],
  picks: Record<string, string>,
): Array<{ food: string; qty: number }> {
  const out: Array<{ food: string; qty: number }> = [];
  for (const it of items) {
    const food = capFoodFor(it, picks[String(it.id ?? "")]);
    if (!food) continue;
    out.push({ food, qty: perMealQty(it) });
  }
  return out;
}

/**
 * Walk the run day by day, debiting each meal against the client's remaining
 * weekly allowance (cap − already consumed − what earlier days of this run
 * take). A meal is evaluated atomically: if any capped food in it would breach,
 * the whole meal is blocked for that day and consumes nothing, because the
 * sanctioned remedy is a whole-meal swap.
 */
export function planRunAgainstLedger(
  run: CapRunV2 | null | undefined,
  suggestions: CapSuggestion[] | null | undefined,
  enriched: CapLimit[] | null | undefined,
  legacy: Record<string, number> | null | undefined,
  consumed: CapConsumed | null | undefined,
  opts: { anchor?: string | null; runDays?: number; startDate?: string } = {},
): CapPlanResult {
  const runDays = opts.runDays ?? RUN_DAYS_DEFAULT;
  const result: CapPlanResult = { days: [], blocks: [], rows: [] };
  if (!run) return result;
  const start = (opts.startDate ?? run.started_on ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return result;

  // Running debit taken by this run, per window: week_start → food → qty.
  const used: Record<string, Record<string, number>> = {};

  for (let i = 0; i < runDays; i++) {
    const date = addDays(start, i);
    const { week_start } = weekWindowFor(opts.anchor ?? null, date);
    const dayResult: CapDayPlanResult = { date, week_start, meals: [] };
    used[week_start] = used[week_start] ?? {};

    for (const meal of CAP_RUN_MEALS) {
      const { colour, items, picks } = resolveDayMealItems(run, suggestions, date, meal);
      if (!colour) continue;
      const demand = mealDemand(items, picks);

      let blocked: CapMealPlanResult | null = null;
      // Tentative debit for this meal only — committed once the whole meal fits.
      const pending: Record<string, number> = {};

      for (const d of demand) {
        const cap = weeklyCapFor(d.food, enriched, legacy);
        if (cap == null) continue;
        const already =
          consumedFor(d.food, consumed?.[week_start]) +
          consumedFor(d.food, used[week_start]) +
          consumedFor(d.food, pending);
        if (already + d.qty > cap) {
          blocked = {
            meal,
            colour,
            blocked: true,
            food: d.food,
            need: d.qty,
            remaining: Math.max(0, cap - already),
            cap,
          };
          break;
        }
        pending[d.food] = (pending[d.food] ?? 0) + d.qty;
      }

      if (blocked) {
        dayResult.meals.push(blocked);
        result.blocks.push({ ...blocked, date, week_start });
        continue;
      }

      for (const [food, qty] of Object.entries(pending)) {
        used[week_start][food] = (used[week_start][food] ?? 0) + qty;
        result.rows.push({ week_start, day: date, meal, food, qty, status: "planned", source: "run" });
      }
      dayResult.meals.push({ meal, colour, blocked: false });
    }

    result.days.push(dayResult);
  }

  return result;
}

/**
 * The ledger rows a confirmed run writes. Plan-based: what the client commits
 * to eat for the run, never what they later log.
 */
export function ledgerRowsForRun(
  run: CapRunV2 | null | undefined,
  suggestions: CapSuggestion[] | null | undefined,
  enriched: CapLimit[] | null | undefined,
  legacy: Record<string, number> | null | undefined,
  consumed: CapConsumed | null | undefined,
  opts: { anchor?: string | null; runDays?: number; startDate?: string } = {},
): CapLedgerRow[] {
  return planRunAgainstLedger(run, suggestions, enriched, legacy, consumed, opts).rows;
}

export function describeBlock(b: CapMealPlanResult & { date?: string }): string {
  const meal = b.meal.charAt(0).toUpperCase() + b.meal.slice(1);
  const when = b.date ? ` on ${b.date}` : "";
  return `${meal}${when} — ${b.food}: ${b.need} needed, ${b.remaining} left of your weekly ${b.cap}.`;
}

/* ------------------------------------------------------------------ */
/* Phase 4 — the ONE fold every reader uses.                           */
/*                                                                     */
/* eaten     = rows the client actually logged                         */
/* planned   = rows committed by a confirmed run, not yet logged       */
/* committed = planned + eaten  (what the cap gate enforces against)   */
/* 'skipped' rows never count.                                          */
/* ------------------------------------------------------------------ */

export interface CapLedgerFoldRow {
  week_start?: string | null;
  day?: string | null;
  food: string;
  qty: number | string | null;
  status?: string | null;
}

export interface CapFold {
  eaten: Record<string, number>;
  planned: Record<string, number>;
  committed: Record<string, number>;
}

export const emptyCapFold = (): CapFold => ({ eaten: {}, planned: {}, committed: {} });

export function foldLedger(
  rows: CapLedgerFoldRow[] | null | undefined,
  opts: { weekStart?: string | null; excludeDays?: Iterable<string> } = {},
): CapFold {
  const out = emptyCapFold();
  const exclude = new Set(opts.excludeDays ?? []);
  for (const r of rows ?? []) {
    if (!r || !r.food) continue;
    const status = String(r.status ?? "planned");
    if (status === "skipped") continue;
    if (opts.weekStart && String(r.week_start ?? "") !== opts.weekStart) continue;
    if (r.day && exclude.has(String(r.day))) continue;
    const qty = Number(r.qty ?? 0);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const food = String(r.food);
    const bucket = status === "eaten" ? out.eaten : out.planned;
    bucket[food] = (bucket[food] ?? 0) + qty;
    out.committed[food] = (out.committed[food] ?? 0) + qty;
  }
  return out;
}

/** Per-cap tallies for one food, using the same loose name matching. */
export function capTallyFor(food: string, fold: CapFold | null | undefined) {
  return {
    eaten: consumedFor(food, fold?.eaten),
    planned: consumedFor(food, fold?.planned),
    committed: consumedFor(food, fold?.committed),
  };
}
