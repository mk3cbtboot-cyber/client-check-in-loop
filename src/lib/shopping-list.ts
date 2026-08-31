// Shopping list aggregation, shared by MB (confirmed 3-day run) and Custom
// (Meal Plan / Meal Plan Generator / Recipe Plan, one week ×7).
//
// Display-only: nothing here writes, and no plan data is modified.

import { parsePortion } from "@/lib/portion";
import { MB_COLOURS, type MbPlanItem, type MbSuggestion } from "@/lib/mb-plan";
import { parseMbRun, resolveDayMeal, runDates, RUN_MEALS } from "@/lib/mb-run";

export interface ShoppingEntry {
  /** Food name as it should appear on the list. */
  name: string;
  /** Grouping heading. */
  category: string;
  /** Portion text for a single day, e.g. "150g", "1 cup". */
  portion: string;
  /** How many days this portion is eaten. */
  days: number;
}

export interface ShoppingItem {
  key: string;
  name: string;
  category: string;
  qty: string;
}

const titleCase = (s: string) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();

const SUMMABLE = new Set(["g", "kg", "ml", "l", "egg", "slice", "piece"]);

const unitLabel = (unit: string, total: number): string => {
  if (unit === "g" || unit === "kg" || unit === "ml" || unit === "l") return `${total}${unit}`;
  if (unit === "egg") return `${total} ${total === 1 ? "egg" : "eggs"}`;
  return `${total} ${unit}${total === 1 ? "" : "s"}`;
};

/** Merge per-day entries into one line per food. */
export function aggregateShopping(entries: ShoppingEntry[]): Array<[string, ShoppingItem[]]> {
  type Group = { name: string; category: string; entries: ShoppingEntry[] };
  const groups = new Map<string, Group>();
  for (const e of entries) {
    const name = e.name.trim();
    if (!name || e.days <= 0) continue;
    const category = (e.category || "Other").trim();
    const k = `${category.toLowerCase()}::${name.toLowerCase()}`;
    const g = groups.get(k) ?? { name, category, entries: [] };
    g.entries.push({ ...e, name, category });
    groups.set(k, g);
  }

  const byCat = new Map<string, ShoppingItem[]>();
  for (const [k, g] of groups) {
    let qty: string;
    const parsed = g.entries.map((e) => ({ ...parsePortion(e.portion), days: e.days }));
    const units = new Set(parsed.map((p) => p.unit));
    const allSummable =
      units.size === 1 && SUMMABLE.has([...units][0]) && parsed.every((p) => p.qty != null);
    if (allSummable) {
      let unit = [...units][0];
      let total = parsed.reduce((s, p) => s + (p.qty as number) * p.days, 0);
      if (unit === "kg") { total *= 1000; unit = "g"; }
      if (unit === "l") { total *= 1000; unit = "ml"; }
      qty = unitLabel(unit, Math.round(total * 100) / 100);
    } else {
      // Non-numeric portions ("1 cup", "handful") — keep the text, collapse
      // identical portions and show the total day count.
      const byText = new Map<string, number>();
      for (const e of g.entries) {
        const t = e.portion.trim() || "1 serving";
        byText.set(t, (byText.get(t) ?? 0) + e.days);
      }
      qty = Array.from(byText.entries())
        .map(([t, d]) => `${t} × ${d} ${d === 1 ? "day" : "days"}`)
        .join(" + ");
    }
    const arr = byCat.get(g.category) ?? [];
    arr.push({ key: k, name: g.name, category: g.category, qty });
    byCat.set(g.category, arr);
  }

  for (const arr of byCat.values()) arr.sort((a, b) => a.name.localeCompare(b.name));
  return Array.from(byCat.entries()).sort(([a], [b]) => a.localeCompare(b));
}

/* ------------------------------- MB ------------------------------- */

const mbItemPortion = (it: MbPlanItem): string => {
  if (it.qty != null && (it.unit === "g" || it.unit === "ml")) return `${it.qty}${it.unit}`;
  if (it.qty != null && it.unit === "count") return `${it.qty} pieces`;
  return (it.note ?? "").trim();
};

/**
 * Entries for the confirmed MB run: the client's picks over the run's days,
 * with quantities coming from the practitioner's mb_plan suggestion items.
 */
export function mbRunShoppingEntries(rawRun: unknown, suggestions: MbSuggestion[]): ShoppingEntry[] {
  const run = parseMbRun(rawRun);
  if (!run.confirmed_on) return [];
  const entries: ShoppingEntry[] = [];
  for (const date of runDates(run)) {
    for (const meal of RUN_MEALS) {
      const resolved = resolveDayMeal(run, suggestions, date, meal);
      for (const it of resolved.items) {
        const chosen = resolved.picks[it.id];
        const name = (chosen ?? it.label ?? "").trim();
        if (!name) continue;
        if (it.optional && !chosen) continue;
        const portion = mbItemPortion(it);
        entries.push({ name, category: titleCase(it.category || "Other"), portion, days: 1 });
      }
    }
  }
  return entries;
}

export const isMbRunConfirmed = (rawRun: unknown): boolean => !!parseMbRun(rawRun).confirmed_on;

export const mbRunLabel = (rawRun: unknown): string => {
  const run = parseMbRun(rawRun);
  const dates = runDates(run);
  return dates.length ? `${dates[0]} – ${dates[dates.length - 1]}` : "";
};

export const MB_COLOUR_KEYS = MB_COLOURS;

/* ----------------------------- Custom ----------------------------- */

export type CustomFoodList = Record<string, Array<{ name: string; portion: string; category: string }>>;

/** Meal Plan + Meal Plan Generator: every food on the plan, eaten daily, ×7. */
export function customFoodListEntries(foodList: CustomFoodList, days = 7): ShoppingEntry[] {
  const entries: ShoppingEntry[] = [];
  for (const items of Object.values(foodList ?? {})) {
    for (const it of items ?? []) {
      if (!it?.name) continue;
      entries.push({
        name: it.name,
        category: titleCase(it.category || "Other"),
        portion: it.portion ?? "",
        days,
      });
    }
  }
  return entries;
}

export interface ShoppingRecipeAssignment {
  meal_slot: string;
  name: string;
  ingredients: Array<{ food: string; amount: string }>;
}

/** Recipe Plan: each assigned recipe's ingredients, ×7. */
export function customRecipeEntries(
  assignments: ShoppingRecipeAssignment[],
  days = 7,
): ShoppingEntry[] {
  const entries: ShoppingEntry[] = [];
  for (const a of assignments ?? []) {
    for (const ing of a?.ingredients ?? []) {
      const name = (ing?.food ?? "").trim();
      if (!name) continue;
      entries.push({
        name,
        category: titleCase(a.meal_slot || "Recipe"),
        portion: ing.amount ?? "",
        days,
      });
    }
  }
  return entries;
}

export function shoppingShareText(
  title: string,
  groups: Array<[string, ShoppingItem[]]>,
): string {
  const lines: string[] = [title, ""];
  for (const [cat, items] of groups) {
    lines.push(cat.toUpperCase());
    for (const it of items) lines.push(`  • ${it.name} — ${it.qty}`);
    lines.push("");
  }
  return lines.join("\n");
}
