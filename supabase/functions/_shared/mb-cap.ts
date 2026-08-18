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
