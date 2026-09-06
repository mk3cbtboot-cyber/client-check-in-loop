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
  { key: "nuts", label: "Nuts", field: "food_nuts" },
  { key: "pumpkinSeeds", label: "Pumpkin Seeds", field: "food_pumpkin_seeds" },
  { key: "sunflowerSeeds", label: "Sunflower Seeds", field: "food_sunflower_seeds" },
  { key: "vegetables", label: "Vegetables", field: "food_vegetables" },
  { key: "vegLettuce", label: "Veg./Lettuce", field: "food_veg_lettuce" },
  { key: "starch", label: "Starch", field: "food_starch" },
  { key: "bread", label: "Bread", field: "food_bread" },
  { key: "fruit", label: "Fruit", field: "food_fruit" },
  // No "oils" category: the 8 Rules prohibit oil during the first 14 days of
  // Phase 2, and oils only appear for the first time on the Phase 3 Extended
  // Food List (phase3_mb_fat_oil, surfaced via phase3AdditionSections).
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

/**
 * Category keys a slot draws its options from.
 * A "Veg./Lettuce" slot offers both the client's Veg./Lettuce list and their
 * Vegetables list (one merged pool), so the optional variety pick can be a
 * genuinely different vegetable. A "Vegetables" slot is unchanged.
 */
export function categorySourceKeys(category: string): string[] {
  return category === "vegLettuce" ? ["vegLettuce", "vegetables"] : [category];
}

/** Foods approved for one plan-item category (falls back to an empty list). */
export function foodsForCategory(list: MbFoodListMap, category: string): string[] {
  return dedupe(categorySourceKeys(category).flatMap((k) => list[k] ?? []));
}


/* ------------------------------------------------------------------ */
/* Phase 3 additions — the extra foods layered on top of the Phase 2   */
/* base list. Stored separately from mb_food_list, in the legacy       */
/* phase3_* / phase3_mb_* columns. Display-only helper.                */
/* ------------------------------------------------------------------ */

export interface MbFoodSection {
  key: string;
  label: string;
  items: string[];
}

const PHASE3_MB_FIELDS: Array<[string, string]> = [
  ["phase3_mb_fish", "Fish"],
  ["phase3_mb_seafood", "Seafood"],
  ["phase3_mb_meat", "Meat"],
  ["phase3_mb_cheese", "Cheese"],
  ["phase3_mb_legumes", "Legumes"],
  ["phase3_mb_vegetables", "Vegetables"],
  ["phase3_mb_veg_lettuce", "Veg./Lettuce"],
  ["phase3_mb_sprouts", "Sprouts"],
  ["phase3_mb_fat_oil", "Oils (Cold-Pressed)"],
];

const PHASE3_CUSTOM_FIELDS: Array<[string, string]> = [
  ["phase3_meat", "Meat"],
  ["phase3_fish", "Fish"],
  ["phase3_vegetables", "Vegetables"],
  ["phase3_fruit", "Fruit"],
  ["phase3_starches", "Starches"],
  ["phase3_bread", "Bread"],
  ["phase3_dairy", "Dairy"],
  ["phase3_other", "Other"],
  ["phase3_additional_foods", "Additional Foods"],
];

const sectionsFor = (
  client: Record<string, unknown>,
  fields: Array<[string, string]>,
): MbFoodSection[] =>
  fields
    .map(([field, label]) => ({ key: field, label, items: dedupe(parseList(client[field])) }))
    .filter((s) => s.items.length > 0);

/**
 * The Phase 3 additional foods for this client, by category.
 * Reads the stored phase3_* columns only — never merges with, recalculates,
 * or duplicates the Phase 2 base list (clients.mb_food_list).
 */
export function phase3AdditionSections(
  client: Record<string, unknown> | null | undefined,
): MbFoodSection[] {
  if (!client) return [];
  const isMb = String(client.phase3_mode ?? "") === "mb_standard";
  const primary = sectionsFor(client, isMb ? PHASE3_MB_FIELDS : PHASE3_CUSTOM_FIELDS);
  if (primary.length > 0) return primary;
  // Some clients have their extras stored under the other mode's columns.
  return sectionsFor(client, isMb ? PHASE3_CUSTOM_FIELDS : PHASE3_MB_FIELDS);
}


/* ------------------------------------------------------------------ */
/* Pick pool — the ONE resolver every picker uses: the client's Phase 2 */
/* approved foods for a slot category, plus (Phase 3/4 only) their      */
/* Phase 3 additions for that same category. No standard-catalogue      */
/* fallback ever happens here: an empty column means "no additions".    */
/* ------------------------------------------------------------------ */

/** phase3_mb_* column → the Phase 2 slot category it feeds. */
export const PHASE3_MB_PICK_MAP: Record<string, string> = {
  phase3_mb_fish: "fish",
  phase3_mb_seafood: "seafood",
  phase3_mb_meat: "meat",
  phase3_mb_cheese: "cheese",
  phase3_mb_legumes: "legumes",
  phase3_mb_vegetables: "vegetables",
  phase3_mb_veg_lettuce: "vegLettuce",
  // Sprouts are a meal-plan-only line on the MB PDF, stored as one more
  // comma list — they fold into Vegetables, same merge as Veg./Lettuce.
  phase3_mb_sprouts: "vegetables",
  phase3_mb_fat_oil: "oils",
};

/** Practitioner-approved Phase 3 food requests, categorised at approval time. */
export interface Phase3ApprovedFood { food: string; category: string }

export function parsePhase3ApprovedFoods(raw: unknown): Phase3ApprovedFood[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => {
      const o = (r ?? {}) as Record<string, unknown>;
      return { food: String(o.food ?? "").trim(), category: String(o.category ?? "").trim() };
    })
    .filter((r) => r.food && r.category);
}

const isPhase3Plus = (client: Record<string, unknown> | null | undefined): boolean => {
  const p = String(client?.phase ?? "");
  return p === "phase3" || p === "phase4";
};

/**
 * The client's Phase 3 additions for one slot category. Phase 3/4 only.
 * Empty column → empty list (never the standard MB catalogue).
 */
export function phase3PickAdditions(
  client: Record<string, unknown> | null | undefined,
  category: string,
): string[] {
  if (!client || !isPhase3Plus(client)) return [];
  const wanted = new Set(categorySourceKeys(category));
  const out: string[] = [];
  for (const [field, cat] of Object.entries(PHASE3_MB_PICK_MAP)) {
    if (!wanted.has(cat)) continue;
    out.push(...parseList(client[field]));
  }
  for (const a of parsePhase3ApprovedFoods(client.phase3_approved_foods)) {
    if (wanted.has(a.category)) out.push(a.food);
  }
  return out;
}

const dedupeCI = (items: string[]): string[] => {
  const seen = new Set<string>();
  return items.filter((i) => {
    const k = i.trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

/**
 * The full selectable pool for a slot category: Phase 2 approved foods plus
 * Phase 3 additions for Phase 3/4 clients. Shared by the client run planner,
 * the practitioner mirror and the recipe-builder option builder.
 */
export function resolvePickPool(
  client: Record<string, unknown> | null | undefined,
  category: string,
): string[] {
  const base = foodsForCategory(resolveMbFoodList(client), category);
  return dedupeCI([...base, ...phase3PickAdditions(client, category)]);
}


export function categoryLabel(key: string): string {
  if (key === "oils") return "Oil";
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
  planRunAgainstLedger,
  ledgerRowsForRun,
  weekWindowFor,
  consumedFor,
  describeBlock,
  addDays,
  foldLedger,
  capTallyFor,
  emptyCapFold,
  capBlocksMeal,
  capUnitsForIngredient,
  capHeadroom,
  describeMealBlock,
} from "../../supabase/functions/_shared/mb-cap";
export type {
  CapViolation,
  CapConsumed,
  CapPlanResult,
  CapDayPlanResult,
  CapMealPlanResult,
  CapWeekWindow,
  CapFold,
  CapLedgerFoldRow,
  CapMealBlock,
  CapMealIngredient,
} from "../../supabase/functions/_shared/mb-cap";



