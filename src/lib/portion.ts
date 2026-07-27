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
