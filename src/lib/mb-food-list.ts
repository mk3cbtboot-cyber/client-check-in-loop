// The client's ONE personal approved-food list (clients.mb_food_list).
// Seeds from the legacy per-category food_* columns when the practitioner
// hasn't materialised the list yet. MB clients only.


export interface MbFoodCategory {
  /** MB_FOODS-compatible key, also the mb_food_list json key. */
  key: string;
  label: string;
  /** Legacy clients.food_* column this category seeds from. */
  field: string;
}

export const MB_FOOD_CATEGORIES: MbFoodCategory[] = [
  { key: "fish", label: "Fish", field: "food_fish" },
  { key: "seafood", label: "Seafood", field: "food_seafood" },
  { key: "milkProducts", label: "Milk Products", field: "food_milk_products" },
  { key: "yogurt", label: "Yogurt", field: "food_yogurt" },
  { key: "meat", label: "Meat", field: "food_meat" },
  { key: "poultry", label: "Poultry", field: "food_poultry" },
  { key: "cheese", label: "Cheese", field: "food_cheese" },
  { key: "legumes", label: "Legumes", field: "food_legumes" },
  { key: "vegetables", label: "Vegetables", field: "food_vegetables" },
  { key: "vegLettuce", label: "Veg./Lettuce", field: "food_veg_lettuce" },
  { key: "starch", label: "Starch", field: "food_starch" },
  { key: "bread", label: "Bread", field: "food_bread" },
  { key: "fruit", label: "Fruit", field: "food_fruit" },
];

export type MbFoodListMap = Record<string, string[]>;

const parseList = (raw: unknown): string[] =>
  String(raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const dedupe = (items: string[]): string[] => {
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i) ? false : (seen.add(i), true)));
};

/** Narrow the stored jsonb into a category → foods map. */
export function parseMbFoodList(raw: unknown): MbFoodListMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: MbFoodListMap = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(v)) continue;
    const items = dedupe(v.map((x) => String(x).trim()).filter(Boolean));
    out[k] = items;
  }
  return out;
}

/** Build the seed list from the legacy food_* columns. */
export function seedMbFoodList(client: Record<string, unknown> | null | undefined): MbFoodListMap {
  const out: MbFoodListMap = {};
  if (!client) return out;
  for (const c of MB_FOOD_CATEGORIES) {
    const items = parseList(client[c.field]);
    if (items.length) out[c.key] = dedupe(items);
  }
  return out;
}

/**
 * The list to render/consume: the stored list when the practitioner has one,
 * otherwise a seed built from the client's parsed food_* columns.
 */
export function resolveMbFoodList(client: Record<string, unknown> | null | undefined): MbFoodListMap {
  const stored = parseMbFoodList(client?.mb_food_list);
  if (Object.keys(stored).length > 0) return stored;
  return seedMbFoodList(client);
}

/** Foods approved for one plan-item category (falls back to an empty list). */
export function foodsForCategory(list: MbFoodListMap, category: string): string[] {
  return list[category] ?? [];
}

export function categoryLabel(key: string): string {
  return MB_FOOD_CATEGORIES.find((c) => c.key === key)?.label ?? (key
    ? key.replace(/([A-Z])/g, " $1").replace(/^./, (m) => m.toUpperCase())
    : "Item");
}

/* ------------------------------------------------------------------ */
/* Weekly caps — re-exported from the ONE shared evaluator that the     */
/* mb-run edge function also imports, so client and server can never    */
/* disagree. Store precedence is unchanged: mb_food_limits first,       */
/* food_limits as the legacy fallback.                                  */
/* ------------------------------------------------------------------ */

export {
  weeklyCapFor,
  capBlocksRun,
  perMealQty,
  capFoodFor,
  evaluateRunCaps,
  describeViolation,
} from "../../supabase/functions/_shared/mb-cap";
export type { CapViolation } from "../../supabase/functions/_shared/mb-cap";

