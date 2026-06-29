// Shared USDA FoodData Central lookup helper.
// Returns macros for a food item at the given portion string.
// Falls back to null on any failure so callers can use AI estimation.

export type Macros = { calories: number; protein_g: number; carbs_g: number; fat_g: number };
export type UsdaCandidate = { description: string; per100: Macros };

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

// Backward-compatible single-result lookup.
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
