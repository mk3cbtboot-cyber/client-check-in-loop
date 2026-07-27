// Shared portion parsing and unit-to-gram conversion.
// This module is the single source of truth for turning a free-text portion
// string like "210g", "3 eggs", "2 tsp" into a gram quantity.
// A mirrored copy lives at supabase/functions/_shared/food-macros.ts for
// server-side use. Keep the two in sync.

export interface ParsedPortion {
  qty: number | null;
  unit: string;
  raw: string;
}

const UNIT_ALIASES: Record<string, string> = {
  "": "g",
  g: "g",
  gram: "g",
  grams: "g",
  gr: "g",
  kg: "kg",
  kilogram: "kg",
  kilograms: "kg",
  mg: "mg",
  ml: "ml",
  millilitre: "ml",
  millilitres: "ml",
  milliliter: "ml",
  milliliters: "ml",
  l: "l",
  litre: "l",
  litres: "l",
  liter: "l",
  liters: "l",
  oz: "oz",
  ounce: "oz",
  ounces: "oz",
  lb: "lb",
  lbs: "lb",
  pound: "lb",
  pounds: "lb",
  tsp: "tsp",
  teaspoon: "tsp",
  teaspoons: "tsp",
  tbsp: "tbsp",
  tablespoon: "tbsp",
  tablespoons: "tbsp",
  cup: "cup",
  cups: "cup",
  egg: "egg",
  eggs: "egg",
  slice: "slice",
  slices: "slice",
  piece: "piece",
  pieces: "piece",
  whole: "piece",
  unit: "piece",
  units: "piece",
  small: "piece",
  medium: "piece",
  large: "piece",
  serving: "serving",
  servings: "serving",
  handful: "handful",
};

/** Foods measured by count. Grams per single item. */
const COUNT_GRAMS: Array<{ match: RegExp; grams: number }> = [
  { match: /\begg\s*whites?\b/i, grams: 33 },
  { match: /\begg\b/i, grams: 50 },
  { match: /\bbanana\b/i, grams: 118 },
  { match: /\bapple\b/i, grams: 182 },
  { match: /\borange\b/i, grams: 131 },
  { match: /\bpear\b/i, grams: 178 },
  { match: /\bkiwi\b/i, grams: 75 },
  { match: /\bavocado\b/i, grams: 150 },
  { match: /\bpotato\b/i, grams: 173 },
  { match: /\bsweet\s*potato\b/i, grams: 130 },
  { match: /\btomato\b/i, grams: 123 },
  { match: /\bbread|toast|slice\b/i, grams: 40 },
  { match: /\brice\s*cake\b/i, grams: 9 },
  { match: /\btortilla|wrap\b/i, grams: 49 },
  { match: /\bchicken\s*breast\b/i, grams: 174 },
];

const OILY = /\b(oil|butter|ghee|tallow|lard|margarine)\b/i;

export function normalizeUnit(raw: string): string {
  const u = (raw ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (u in UNIT_ALIASES) return UNIT_ALIASES[u];
  // Handle things like "g cooked" or "eggs (large)".
  const first = u.split(/[\s(,]/)[0];
  if (first in UNIT_ALIASES) return UNIT_ALIASES[first];
  return u;
}

export function parsePortion(portion: string): ParsedPortion {
  const raw = String(portion ?? "").trim();
  const m = raw.match(/^\s*(\d+(?:[.,]\d+)?)\s*(.*)$/);
  if (!m) return { qty: null, unit: normalizeUnit(raw), raw };
  const qty = Number(m[1].replace(",", "."));
  return {
    qty: Number.isFinite(qty) ? qty : null,
    unit: normalizeUnit(m[2]),
    raw,
  };
}

/** Grams for one countable unit of this food, or null when unknown. */
export function countUnitGrams(name: string): number | null {
  const n = String(name ?? "");
  for (const c of COUNT_GRAMS) {
    if (c.match.test(n)) return c.grams;
  }
  return null;
}

/**
 * Convert a portion string to grams. Returns null when the quantity or unit
 * cannot be resolved - callers treat those items as fixed ("as listed").
 */
export function portionToGrams(portion: string, name = ""): number | null {
  const { qty, unit } = parsePortion(portion);
  if (qty === null || !Number.isFinite(qty) || qty < 0) return null;
  const isOil = OILY.test(name);
  switch (unit) {
    case "g":
      return qty;
    case "kg":
      return qty * 1000;
    case "mg":
      return qty / 1000;
    case "ml":
      return qty * (isOil ? 0.92 : 1);
    case "l":
      return qty * 1000 * (isOil ? 0.92 : 1);
    case "oz":
      return qty * 28.35;
    case "lb":
      return qty * 453.6;
    case "tsp":
      return qty * (isOil ? 4.5 : 5);
    case "tbsp":
      return qty * (isOil ? 13.6 : 15);
    case "cup":
      return qty * 240;
    case "egg":
      return qty * (countUnitGrams(/white/i.test(name) ? "egg white" : "egg") ?? 50);
    case "slice":
    case "piece": {
      const g = countUnitGrams(name);
      return g === null ? null : qty * g;
    }
    default:
      return null;
  }
}

/** Rebuild a display string from a quantity and a unit. */
export function formatPortion(qty: number, unit: string): string {
  const u = normalizeUnit(unit);
  const n = Math.round(qty * 100) / 100;
  if (u === "g") return `${n}g`;
  if (u === "egg") return `${n} ${n === 1 ? "egg" : "eggs"}`;
  return `${n} ${u}`;
}
// Shared macro derivation for Custom food-list items.
// Macros are always derived at read time from grams x per-100g density, so a
// portion change scales the item, the meal total, the day total and the client
// tracker together. Items without a resolvable gram weight or without
// densities fall back to their stored absolute values and are flagged fixed.



export interface MacroSetLike {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export interface DensityFoodItem {
  name?: string;
  portion?: string;
  category?: string;
  grams?: number | null;
  density_protein_per_100g?: number;
  density_carbs_per_100g?: number;
  density_fat_per_100g?: number;
  density_source?: string;
  est_calories?: number;
  est_protein_g?: number;
  est_carbs_g?: number;
  est_fat_g?: number;
}

const numOr = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export function zeroMacros(): MacroSetLike {
  return { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
}

export function caloriesFrom(protein_g: number, carbs_g: number, fat_g: number): number {
  return protein_g * 4 + carbs_g * 4 + fat_g * 9;
}

/** Gram weight for an item: stored value first, otherwise parsed from the portion. */
export function resolveGrams(item: DensityFoodItem): number | null {
  const stored = Number(item?.grams);
  if (Number.isFinite(stored) && stored > 0) return stored;
  const parsed = portionToGrams(String(item?.portion ?? ""), String(item?.name ?? ""));
  return parsed !== null && parsed > 0 ? parsed : null;
}

export function hasDensities(item: DensityFoodItem): boolean {
  return (
    Number.isFinite(Number(item?.density_protein_per_100g)) &&
    Number.isFinite(Number(item?.density_carbs_per_100g)) &&
    Number.isFinite(Number(item?.density_fat_per_100g))
  );
}

/**
 * Back out per-100g densities from stored absolute macros at the item's current
 * gram weight. Reproduces today's numbers exactly at the unchanged portion.
 */
export function deriveDensities(
  item: DensityFoodItem,
): { p: number; c: number; f: number } | null {
  const grams = resolveGrams(item);
  if (grams === null || grams < 1) return null;
  const p = Number(item?.est_protein_g);
  const c = Number(item?.est_carbs_g);
  const f = Number(item?.est_fat_g);
  if (![p, c, f].every((n) => Number.isFinite(n))) return null;
  if (p === 0 && c === 0 && f === 0) return null;
  return { p: (p / grams) * 100, c: (c / grams) * 100, f: (f / grams) * 100 };
}

/**
 * Lazy repair: fill grams and densities on an item that predates the density
 * model. Idempotent, and never changes an item's macros at its current portion.
 */
export function withDensityModel<T extends DensityFoodItem>(item: T): T {
  const grams = resolveGrams(item);
  const next: T = { ...item };
  if (grams !== null && !Number.isFinite(Number(item.grams))) next.grams = grams;
  if (!hasDensities(item)) {
    const d = deriveDensities(item);
    if (d) {
      next.density_protein_per_100g = d.p;
      next.density_carbs_per_100g = d.c;
      next.density_fat_per_100g = d.f;
      if (!next.density_source) next.density_source = "derived";
    }
  }
  return next;
}

/** True when macros cannot scale with portion (shown as "fixed" in the UI). */
export function isFixedItem(item: DensityFoodItem): boolean {
  const repaired = withDensityModel(item);
  return resolveGrams(repaired) === null || !hasDensities(repaired);
}

/** Macros for a single item, derived from grams x density when possible. */
export function macrosFor(item: DensityFoodItem): MacroSetLike {
  const repaired = withDensityModel(item);
  const grams = resolveGrams(repaired);
  if (grams !== null && hasDensities(repaired)) {
    const factor = grams / 100;
    const protein_g = numOr(repaired.density_protein_per_100g) * factor;
    const carbs_g = numOr(repaired.density_carbs_per_100g) * factor;
    const fat_g = numOr(repaired.density_fat_per_100g) * factor;
    return { protein_g, carbs_g, fat_g, calories: caloriesFrom(protein_g, carbs_g, fat_g) };
  }
  const protein_g = numOr(item.est_protein_g);
  const carbs_g = numOr(item.est_carbs_g);
  const fat_g = numOr(item.est_fat_g);
  const stored = Number(item.est_calories);
  return {
    protein_g,
    carbs_g,
    fat_g,
    calories: Number.isFinite(stored) && stored > 0 ? stored : caloriesFrom(protein_g, carbs_g, fat_g),
  };
}

/** Sum derived macros across items. Sums unrounded, callers round once. */
export function sumMacros(items: DensityFoodItem[] | undefined | null): MacroSetLike {
  const total = zeroMacros();
  for (const it of items ?? []) {
    const m = macrosFor(it);
    total.protein_g += m.protein_g;
    total.carbs_g += m.carbs_g;
    total.fat_g += m.fat_g;
  }
  total.calories = caloriesFrom(total.protein_g, total.carbs_g, total.fat_g);
  return total;
}

/** Sum across every visible slot of a food list. */
export function sumMacrosAcrossSlots(
  list: Record<string, DensityFoodItem[]> | undefined | null,
  slots: string[],
): MacroSetLike {
  const total = zeroMacros();
  for (const s of slots) {
    const m = sumMacros(list?.[s]);
    total.protein_g += m.protein_g;
    total.carbs_g += m.carbs_g;
    total.fat_g += m.fat_g;
  }
  total.calories = caloriesFrom(total.protein_g, total.carbs_g, total.fat_g);
  return total;
}
