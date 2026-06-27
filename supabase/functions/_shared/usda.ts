// Shared USDA FoodData Central lookup helper.
// Returns macros for a food item at the given portion string.
// Falls back to null on any failure so callers can use AI estimation.

export type Macros = { calories: number; protein_g: number; carbs_g: number; fat_g: number };

const FDC_API = "https://api.nal.usda.gov/fdc/v1";

// Convert a portion string like "120g", "2 tsp", "1 tbsp", "1 cup" to grams.
// Returns null when the unit is unknown — caller should default to 100g.
export function portionToGrams(portion: string, name: string): number | null {
  const p = (portion || "").trim().toLowerCase();
  if (!p) return null;

  // Pure grams
  const g = p.match(/^([\d.]+)\s*g(?:ram)?s?\b/);
  if (g) return parseFloat(g[1]);

  // Number + unit
  const m = p.match(/^([\d.]+)\s*([a-z]+)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = m[2];

  // Approximate gram weights per common unit. Oils ≈ 4.5g/tsp, 13.6g/tbsp.
  const isOil = /\b(oil|butter|ghee|tallow|lard)\b/i.test(name);
  switch (unit) {
    case "tsp":
    case "teaspoon":
    case "teaspoons":
      return n * (isOil ? 4.5 : 5);
    case "tbsp":
    case "tablespoon":
    case "tablespoons":
      return n * (isOil ? 13.6 : 15);
    case "cup":
    case "cups":
      return n * 240;
    case "oz":
    case "ounce":
    case "ounces":
      return n * 28.35;
    case "ml":
      return n;
    case "kg":
      return n * 1000;
    case "lb":
    case "lbs":
    case "pound":
    case "pounds":
      return n * 453.6;
    default:
      return null;
  }
}

// Strip parentheticals + extra qualifiers so the search query is the core food name.
function cleanName(name: string): string {
  return name
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(cooked|raw|fresh|organic|grass[- ]fed|wild|skinless|boneless)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const cache = new Map<string, Macros | null>();

async function searchFdc(apiKey: string, query: string): Promise<Macros | null> {
  const url = `${FDC_API}/foods/search?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(query)}&pageSize=1&dataType=${encodeURIComponent("Foundation,SR Legacy")}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error("USDA search failed", res.status, await res.text());
    return null;
  }
  const data = await res.json();
  const food = Array.isArray(data?.foods) && data.foods.length > 0 ? data.foods[0] : null;
  if (!food) return null;
  const nutrients: Array<{ nutrientId?: number; value?: number }> = Array.isArray(food.foodNutrients) ? food.foodNutrients : [];
  const find = (id: number) => {
    const f = nutrients.find((x) => Number(x?.nutrientId) === id);
    const v = Number(f?.value);
    return Number.isFinite(v) ? v : 0;
  };
  // Values are per 100g.
  return {
    calories: find(1008),
    protein_g: find(1003),
    carbs_g: find(1005),
    fat_g: find(1004),
  };
}

// Lookup USDA macros for a name + portion. Returns null on miss/error.
export async function usdaMacros(name: string, portion: string): Promise<Macros | null> {
  const apiKey = Deno.env.get("USDA_FDC_API_KEY");
  if (!apiKey) return null;
  const cleaned = cleanName(name);
  if (!cleaned) return null;

  let per100: Macros | null | undefined = cache.get(cleaned.toLowerCase());
  if (per100 === undefined) {
    try {
      per100 = await searchFdc(apiKey, cleaned);
    } catch (e) {
      console.error("USDA fetch error", e);
      per100 = null;
    }
    cache.set(cleaned.toLowerCase(), per100);
  }
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
