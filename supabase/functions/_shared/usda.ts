// Shared USDA FoodData Central lookup helper.
// Returns macros for a food item at the given portion string.
// Falls back to null on any failure so callers can use AI estimation.

export type Macros = { calories: number; protein_g: number; carbs_g: number; fat_g: number };
export type UsdaCandidate = { description: string; per100: Macros };
export type Category = "Protein" | "Carbs" | "Veg" | "Fat" | "Other";

const FDC_API = "https://api.nal.usda.gov/fdc/v1";

// Convert a portion string like "120g", "2 tsp", "1 tbsp", "1 cup" to grams.
// Returns null when the unit is unknown — caller should default to 100g.
export function portionToGrams(portion: string, name: string): number | null {
  const p = (portion || "").trim().toLowerCase();
  if (!p) return null;

  const g = p.match(/^([\d.]+)\s*g(?:ram)?s?\b/);
  if (g) return parseFloat(g[1]);

  const m = p.match(/^([\d.]+)\s*([a-z]+)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = m[2];

  const isOil = /\b(oil|butter|ghee|tallow|lard)\b/i.test(name);
  switch (unit) {
    case "tsp": case "teaspoon": case "teaspoons":
      return n * (isOil ? 4.5 : 5);
    case "tbsp": case "tablespoon": case "tablespoons":
      return n * (isOil ? 13.6 : 15);
    case "cup": case "cups":
      return n * 240;
    case "oz": case "ounce": case "ounces":
      return n * 28.35;
    case "ml": return n;
    case "kg": return n * 1000;
    case "lb": case "lbs": case "pound": case "pounds":
      return n * 453.6;
    default: return null;
  }
}

function cleanName(name: string): string {
  return name
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(cooked|raw|fresh|organic|grass[- ]fed|wild|skinless|boneless)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const candidateCache = new Map<string, UsdaCandidate[]>();

const PROCESSED_TERMS = /\b(protein powder|whey|isolate|concentrate|supplement|shake|protein bar|powder|fortified|enriched)\b/i;

function extractMacros(food: any): Macros {
  const nutrients: Array<{ nutrientId?: number; value?: number }> = Array.isArray(food?.foodNutrients) ? food.foodNutrients : [];
  const find = (id: number) => {
    const f = nutrients.find((x) => Number(x?.nutrientId) === id);
    const v = Number(f?.value);
    return Number.isFinite(v) ? v : 0;
  };
  return {
    calories: find(1008),
    protein_g: find(1003),
    carbs_g: find(1005),
    fat_g: find(1004),
  };
}

async function searchFdcAll(apiKey: string, query: string): Promise<UsdaCandidate[]> {
  const url = `${FDC_API}/foods/search?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(query)}&pageSize=10&dataType=${encodeURIComponent("Foundation,SR Legacy")}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error("USDA search failed", res.status, await res.text());
    return [];
  }
  const data = await res.json();
  const foods: any[] = Array.isArray(data?.foods) ? data.foods : [];
  return foods
    .filter((f) => {
      const desc = String(f?.description ?? "");
      return desc && !PROCESSED_TERMS.test(desc);
    })
    .map((f) => ({ description: String(f.description), per100: extractMacros(f) }));
}

// Return all whole-food USDA candidates (per 100g) for a search term.
export async function usdaCandidates(name: string): Promise<UsdaCandidate[]> {
  const apiKey = Deno.env.get("USDA_FDC_API_KEY");
  if (!apiKey) return [];
  const cleaned = cleanName(name);
  if (!cleaned) return [];
  const cacheKey = cleaned.toLowerCase();
  const cached = candidateCache.get(cacheKey);
  if (cached) return cached;
  let list: UsdaCandidate[] = [];
  try {
    list = await searchFdcAll(apiKey, cleaned);
  } catch (e) {
    console.error("USDA fetch error", e);
    list = [];
  }
  candidateCache.set(cacheKey, list);
  return list;
}

// ---------------------------------------------------------------------------
// Category-aware filtering (shared with generate-foodlist-plan).
// Keeps every USDA-consuming code path (generator, edit-modal macro
// re-estimate) on the same "cooked, whole-food" selection rules so that a
// grain like "white rice" never resolves to the raw/dry entry.
// ---------------------------------------------------------------------------

export function isOilName(name: string): boolean {
  return /\b(oil|ghee)\b/i.test(name);
}

const RAW_FOODS = /\b(cucumber|tomato|tomatoes|lettuce|spinach|arugula|rocket|bell pepper|peppers?|carrot sticks?|celery|radish|onion|avocado|olives?|salad)\b/i;

export function cookedSearchTerm(name: string, category: Category): string {
  const clean = name.trim();
  if (!clean) return clean;
  if (category === "Fat") return clean;
  if (/\bcooked\b/i.test(clean)) return clean;
  if (category === "Veg" && RAW_FOODS.test(clean)) return clean;
  if (category === "Protein" && /\begg/i.test(clean)) return "eggs, whole, cooked";
  return `${clean}, cooked`;
}

// Minimum macro density per 100g for the food's primary macro.
export const DENSITY_THRESHOLD: Record<Category, number> = {
  Protein: 15,
  Carbs: 15,
  Fat: 20,
  Veg: 0,
  Other: 0,
};

export function densityMacroKey(category: Category): keyof Macros {
  if (category === "Protein") return "protein_g";
  if (category === "Carbs") return "carbs_g";
  if (category === "Fat") return "fat_g";
  return "calories";
}

const WRONG_FORM_TERMS = /\b(dried|dehydrated|flour|powder|jerky|vegetarian|snack|snacks|imitation|substitute|extract|concentrate|souffl[eé]|casserole|stew|soup|salad|stir[- ]fry|curry|pie|baked dish|bake|mashed|canned|pickled|frozen meal|frozen|mixed dish|with sauce|stuffed|babyfood|strained|rice cake|cookies|puffs|bagels?|pancakes?)\b/i;

const DRY_STAPLE_RE = /\b(oat|oats|oatmeal|rice|lentil|lentils|bean|beans|chickpea|chickpeas|quinoa|barley|farro|bulgur|millet|pea|peas|legume|legumes)\b/i;

const BREAD_NAME_RE = /\b(bread|sourdough|bagel|baguette|ciabatta|focaccia|pita|tortilla|toast|roll|bun|loaf|brioche)\b/i;

// Legumes & grains that should always resolve to a cooked form — never raw / "mature seeds".
export const LEGUME_GRAIN_RE = /\b(black bean|kidney bean|chickpea|chickpeas|lentil|lentils|rice|quinoa|oat|oats|oatmeal|bean|beans)\b/i;

// Map a candidate food name to keyword(s) that MUST appear in any accepted USDA result description.
export function primaryKeywords(name: string): string[] {
  const lower = name.toLowerCase().trim();
  if (!lower) return [];
  if (/sweet ?potato/.test(lower)) return ["sweet potato", "sweetpotato"];
  if (/oatmeal|\boats?\b/.test(lower)) return ["oat"];
  if (/chickpea|garbanzo/.test(lower)) return ["chickpea", "garbanzo"];
  if (/black bean/.test(lower)) return ["black bean"];
  if (/kidney bean/.test(lower)) return ["kidney bean"];
  const STOP = new Set([
    "raw","cooked","fresh","organic","grass","fed","wild","skinless","boneless",
    "ground","whole","large","small","sliced","diced","with","and","lean","fillet",
    "fillets","steak","steaks","breast","thigh","leg","cut","cuts",
  ]);
  const tokens = lower.replace(/[^a-z\s]/g, " ").split(/\s+/).filter((t) => t && !STOP.has(t));
  if (tokens.length === 0) return [lower];
  return [tokens[tokens.length - 1]];
}

export function matchesPrimaryKeyword(description: string, candidateName: string): boolean {
  const d = description.toLowerCase();
  const keys = primaryKeywords(candidateName);
  if (keys.length === 0) return true;
  return keys.some((k) => d.includes(k));
}

export function isWrongForm(description: string, category: Category, candidateName: string): boolean {
  if (WRONG_FORM_TERMS.test(description)) return true;
  if (category === "Fat" && !isOilName(candidateName) && /\boil\b/i.test(description)) return true;
  if (DRY_STAPLE_RE.test(candidateName) && /\bdry\b/i.test(description)) return true;
  // Reject "bread" entries (e.g. "bread, oatmeal") unless the target food is itself a bread.
  if (!BREAD_NAME_RE.test(candidateName) && /\bbread\b/i.test(description)) return true;
  // Reject raw / "mature seeds" forms for legumes and grains — they must be cooked.
  if (LEGUME_GRAIN_RE.test(candidateName) && /\b(raw|mature seeds)\b/i.test(description)) return true;
  return false;
}

// Hard-coded macros for eggs (USDA Egg, whole, raw, large per 100g).
export const EGG_PER100: Macros = { calories: 143, protein_g: 12.6, carbs_g: 0.6, fat_g: 9.5 };
export const EGG_USDA_DESC = "Egg, whole, raw, large (hard-coded)";
export const isEggName = (n: string) => /\begg/i.test(n);

// Hard-coded macros for oats (per 100g dry weight).
export const OATS_PER100: Macros = { calories: 389, protein_g: 13.2, carbs_g: 67.7, fat_g: 6.5 };
export const OATS_USDA_DESC = "Oats, dry (hard-coded)";
export const isOatsName = (n: string) => /\b(oats?|oatmeal)\b/i.test(n);

// Narrow variety markers that USDA sometimes sorts to the top of a generic
// staple query (e.g. "white rice, cooked" → "Rice, white, glutinous, cooked").
// When the input name doesn't explicitly ask for one of these varieties we
// deprioritize (not reject) hits containing them, so a plain "white rice"
// resolves to long-/medium-grain rather than glutinous/sticky.
const NICHE_VARIETY_RE = /\b(glutinous|sticky|sweet rice|wild rice|basmati|jasmine|arborio|risotto|pearled|hulled|pearl barley|puffed)\b/i;

export function isNicheVarietyHit(description: string, candidateName: string): boolean {
  if (NICHE_VARIETY_RE.test(candidateName)) return false; // user asked for it
  return NICHE_VARIETY_RE.test(description);
}

// Pick the best per-100g USDA entry for a single food name + category, applying
// the same filters the meal-plan generator uses. Returns null when nothing
// passes so callers can fall back to AI estimation.
export async function pickUsdaForCategory(
  name: string,
  category: Category,
): Promise<{ per100: Macros; description: string } | null> {
  if (category === "Protein" && isEggName(name)) {
    return { per100: EGG_PER100, description: EGG_USDA_DESC };
  }
  if (category === "Carbs" && isOatsName(name)) {
    return { per100: OATS_PER100, description: OATS_USDA_DESC };
  }
  const threshold = DENSITY_THRESHOLD[category] ?? 0;
  const macroKey = densityMacroKey(category);
  const list = await usdaCandidates(cookedSearchTerm(name, category)).catch(() => []);

  // Two-pass: first accept only non-niche varieties (e.g. long-grain over
  // glutinous), then fall back to niche hits if nothing else qualifies.
  let nicheFallback: { per100: Macros; description: string } | null = null;
  for (const item of list) {
    if (isWrongForm(item.description, category, name)) continue;
    if (!matchesPrimaryKeyword(item.description, name)) continue;
    const value = Number(item.per100[macroKey] ?? 0);
    const passesDensity = category === "Veg" || category === "Other" || value >= threshold;
    if (!passesDensity) continue;
    if (isNicheVarietyHit(item.description, name)) {
      if (!nicheFallback) nicheFallback = { per100: item.per100, description: item.description };
      continue;
    }
    return { per100: item.per100, description: item.description };
  }
  return nicheFallback;
}


// Backward-compatible single-result lookup (no category-aware filtering).
export async function usdaMacros(name: string, portion: string): Promise<Macros | null> {
  const list = await usdaCandidates(name);
  const per100 = list[0]?.per100 ?? null;
  if (!per100) return null;
  const grams = portionToGrams(portion, name) ?? 100;
  const factor = grams / 100;
  return {
    calories: Math.round(per100.calories * factor),
    protein_g: Math.round(per100.protein_g * factor),
    carbs_g: Math.round(per100.carbs_g * factor),
    fat_g: Math.round(per100.fat_g * factor),
  };
}

// Category-aware macros lookup — mirrors the generator's selection rules
// (cooked search term, wrong-form/raw/dry rejection, primary-keyword match,
// density threshold, egg/oats hard-codes) so the edit modal and the generator
// agree on the same USDA entry for a given food.
export async function usdaMacrosForCategory(
  name: string,
  portion: string,
  category: Category,
): Promise<Macros | null> {
  const found = await pickUsdaForCategory(name, category);
  if (!found) return null;
  const grams = portionToGrams(portion, name) ?? 100;
  const factor = grams / 100;
  return {
    calories: Math.round(found.per100.calories * factor),
    protein_g: Math.round(found.per100.protein_g * factor),
    carbs_g: Math.round(found.per100.carbs_g * factor),
    fat_g: Math.round(found.per100.fat_g * factor),
  };
}
