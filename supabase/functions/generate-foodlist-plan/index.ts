import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  usdaCandidates,
  cookedSearchTerm,
  isWrongForm,
  matchesPrimaryKeyword,
  densityMacroKey,
  DENSITY_THRESHOLD,
  LEGUME_GRAIN_RE,
  EGG_PER100,
  EGG_USDA_DESC,
  OATS_PER100,
  OATS_USDA_DESC,
  isEggName,
  isOatsName,
  isOilName,
  isNicheVarietyHit,
  type Macros,
  type Category,
} from "../_shared/usda.ts";
import { withDensityModel } from "../_shared/food-macros.ts";

const SLOT_KEYS = ["breakfast", "morning_snack", "lunch", "afternoon_snack", "dinner"] as const;
type SlotKey = (typeof SLOT_KEYS)[number];

function slotsForMeals(n: number): SlotKey[] {
  if (n === 5) return ["breakfast", "morning_snack", "lunch", "afternoon_snack", "dinner"];
  if (n === 4) return ["breakfast", "lunch", "afternoon_snack", "dinner"];
  return ["breakfast", "lunch", "dinner"];
}

function emptyList() {
  return { breakfast: [], morning_snack: [], lunch: [], afternoon_snack: [], dinner: [] } as Record<SlotKey, unknown[]>;
}

type FoodItem = {
  name: string;
  portion: string;
  category: Category;
  est_macros?: Macros;
};

type DebugFood = {
  slot: string;
  slot_index: number;
  name: string;
  category: Category;
  usda_description?: string;
  density_macro?: string;
  density_value?: number;
  portion: string;
  estimated: boolean;
};

// Variant words that describe the same ingredient. Stripped from the canonical
// key so "Turkey Breast" and "Skinless Turkey Breast" collapse to one food, and
// "Chicken Breast" and "Chicken Breast, cooked" never appear as two entries.
const CANON_STOPWORDS = new Set([
  "estimated", "cooked", "raw", "fresh", "frozen", "canned", "dried",
  "skinless", "boneless", "skin", "less", "lean", "extra", "trimmed",
  "grilled", "roasted", "baked", "steamed", "boiled", "poached", "sauteed",
  "plain", "unsweetened", "unsalted", "natural", "organic", "meat", "only",
  "chopped", "sliced", "diced", "florets", "sticks", "strips", "pieces",
]);

function canon(name: string): string {
  const words = String(name ?? "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z]+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w && !CANON_STOPWORDS.has(w))
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
  return words.sort().join(" ");
}

function titleCase(s: string): string {
  return s.replace(/\s+/g, " ").trim().split(" ")
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** Strip variant/preparation noise from a name for display purposes. */
function cleanDisplayName(raw: string): string {
  const base = String(raw ?? "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/,[^,]*$/, (m) => (/(cooked|raw|skinless|boneless|meat only|estimated)/i.test(m) ? " " : m))
    .replace(/\b(skinless|boneless|cooked|raw|estimated)\b/gi, " ")
    .replace(/[,\s]+/g, " ")
    .trim();
  return titleCase(base || String(raw ?? "").trim());
}

/**
 * One canonical display name per ingredient, shared across every meal slot.
 * First sighting wins, so the same food always reads identically in the plan.
 */
const canonicalNames = new Map<string, string>();
function canonicalName(raw: string): string {
  const key = canon(raw);
  const display = cleanDisplayName(raw);
  if (!key) return display;
  const existing = canonicalNames.get(key);
  if (existing) return existing;
  canonicalNames.set(key, display);
  return display;
}

function roundPortionG(g: number): number {
  if (g <= 0) return 0;
  if (g < 20) return Math.max(5, Math.round(g));
  if (g < 100) return Math.round(g / 5) * 5;
  return Math.round(g / 10) * 10;
}

function fmtPortionG(g: number): string {
  return `${roundPortionG(g)}g`;
}

// ---- Guaranteed-macro estimation ---------------------------------------
// No generated food may ever be stored with 0/0/0. When USDA has no match we
// ask the model, retry once, then fall back to a category-default density.
const CATEGORY_DEFAULT_PER100: Record<Category, Macros> = {
  Protein: { calories: 165, protein_g: 31, carbs_g: 0, fat_g: 3.6 },
  Carbs: { calories: 130, protein_g: 2.7, carbs_g: 28, fat_g: 0.3 },
  Veg: { calories: 35, protein_g: 2.5, carbs_g: 7, fat_g: 0.4 },
  Fat: { calories: 884, protein_g: 0, carbs_g: 0, fat_g: 100 },
  Other: { calories: 100, protein_g: 3, carbs_g: 15, fat_g: 2 },
} as Record<Category, Macros>;

function gramsFromPortion(portion: string): number {
  const p = String(portion ?? "");
  const g = /([\d.]+)\s*g\b/i.exec(p);
  if (g) return Number(g[1]);
  const tsp = /([\d.]+)\s*tsp/i.exec(p);
  if (tsp) return Number(tsp[1]) * 4.5;
  const tbsp = /([\d.]+)\s*tbsp/i.exec(p);
  if (tbsp) return Number(tbsp[1]) * 13.6;
  const egg = /([\d.]+)\s*eggs?/i.exec(p);
  if (egg) return Number(egg[1]) * 50;
  const n = /([\d.]+)/.exec(p);
  return n ? Number(n[1]) : 100;
}

function macrosAreReal(m: Macros | null | undefined): m is Macros {
  if (!m) return false;
  const vals = [m.calories, m.protein_g, m.carbs_g, m.fat_g].map(Number);
  if (!vals.every((v) => Number.isFinite(v) && v >= 0)) return false;
  return vals.slice(1).some((v) => v > 0) || Number(m.calories) > 0;
}

function scalePer100(per100: Macros, grams: number): Macros {
  const f = grams / 100;
  return {
    calories: per100.calories * f,
    protein_g: per100.protein_g * f,
    carbs_g: per100.carbs_g * f,
    fat_g: per100.fat_g * f,
  };
}


// USDA lookup helpers, category filters, egg/oats hard-codes, and the
// cooked-search-term/density rules live in ../_shared/usda.ts so the edit-modal
// macro re-estimate path uses the exact same selection logic.


async function findUSDAFood(
  candidates: string[],
  used: Set<string>,
  category: Category,
): Promise<{ name: string; per100: Macros; usdaDescription: string } | null> {
  const threshold = DENSITY_THRESHOLD[category];
  const macroKey = densityMacroKey(category);
  for (const cand of candidates) {
    const key = canon(cand);
    if (!key || used.has(key)) continue;
    // Hard-coded egg lookup — bypass USDA search.
    if (category === "Protein" && isEggName(cand)) {
      console.log(`[usda] "${cand}" (Protein): using hard-coded egg macros (12.6g protein per 100g)`);
      return { name: cand, per100: EGG_PER100, usdaDescription: EGG_USDA_DESC };
    }
    // Hard-coded oats lookup — bypass USDA search.
    if (category === "Carbs" && isOatsName(cand)) {
      console.log(`[usda] "${cand}" (Carbs): using hard-coded oats macros (67.7g carbs per 100g dry)`);
      return { name: "Oats", per100: OATS_PER100, usdaDescription: OATS_USDA_DESC };
    }
    const list = await usdaCandidates(cookedSearchTerm(cand, category)).catch(() => []);
    const rejected: Array<{ desc: string; value: number; reason: string }> = [];
    let nicheFallback: { item: typeof list[number]; value: number } | null = null;
    let accepted: { item: typeof list[number]; value: number } | null = null;
    for (const item of list) {
      if (isWrongForm(item.description, category, cand)) {
        rejected.push({ desc: item.description, value: 0, reason: "wrong-form" });
        continue;
      }
      if (!matchesPrimaryKeyword(item.description, cand)) {
        rejected.push({ desc: item.description, value: 0, reason: "primary-keyword-missing" });
        continue;
      }
      const value = Number(item.per100[macroKey] ?? 0);
      if (category !== "Veg" && value < threshold) {
        rejected.push({ desc: item.description, value, reason: "low-density" });
        continue;
      }
      if (isNicheVarietyHit(item.description, cand)) {
        if (!nicheFallback) nicheFallback = { item, value };
        rejected.push({ desc: item.description, value, reason: "niche-variety" });
        continue;
      }
      accepted = { item, value };
      break;
    }
    const chosen = accepted ?? nicheFallback;
    if (chosen) {
      if (rejected.length > 0) {
        console.log(`[usda] "${cand}" (${category}): rejected ${rejected.length} entries before accepting "${chosen.item.description}" (${macroKey}=${chosen.value}g/100g)`);
        for (const r of rejected) console.log(`  rejected (${r.reason}): "${r.desc}" (${macroKey}=${r.value}g/100g, threshold ${threshold})`);
      } else {
        console.log(`[usda] "${cand}" (${category}): accepted "${chosen.item.description}" (${macroKey}=${chosen.value}g/100g)`);
      }
      return { name: cand, per100: chosen.item.per100, usdaDescription: chosen.item.description };
    }

    if (rejected.length > 0) {
      console.log(`[usda] "${cand}" (${category}): no valid USDA entry, rejected ${rejected.length} entries — falling back to next candidate`);
      for (const r of rejected) console.log(`  rejected (${r.reason}): "${r.desc}" (${macroKey}=${r.value}g/100g)`);
    } else {
      console.log(`[usda] "${cand}" (${category}): no USDA results`);
    }
  }
  return null;
}

const VEG_POOL = [
  "Broccoli", "Spinach", "Zucchini", "Bell Peppers", "Cucumber",
  "Tomato", "Asparagus", "Green Beans", "Kale", "Cauliflower",
];

const EGG_PROTEIN_POOL = ["Eggs"];

// Legume detector — when the chosen carb source is a legume, pair it with a lean protein.
const LEGUME_PAIR_RE = /\b(black beans?|kidney beans?|chickpeas?|garbanzos?|lentils?|pinto beans?|cannellini( beans?)?|navy beans?)\b/i;
const LEAN_PROTEIN_POOL = ["Chicken Breast", "Turkey Breast", "Cod", "Haddock"];

// ---- Brand / proper-noun safety net -------------------------------------
// Maps known brand names to generic descriptions. Anything brand-like that is
// not mapped is rejected outright so it can never reach a client.
const BRAND_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bezekiel\b(\s+bread)?/i, "Whole Grain Bread"],
  [/\bweet[- ]?a?bix\b/i, "Whole Wheat Cereal"],
  [/\bshredded\s+wheat\b/i, "Whole Wheat Cereal"],
  [/\bcheerios\b/i, "Whole Grain Oat Cereal"],
  [/\bspecial\s*k\b/i, "Rice Cereal"],
  [/\ball[- ]bran\b/i, "Wheat Bran Cereal"],
  [/\balpen\b/i, "Muesli"],
  [/\bready\s*brek\b/i, "Oats"],
  [/\bquaker\b/i, "Oats"],
  [/\bkellogg'?s?\b/i, "Cereal"],
  [/\bnestl[eé]\b/i, "Cereal"],
  [/\bgeneral\s+mills\b/i, "Cereal"],
  [/\bmuller\s*light\b/i, "Greek Yoghurt"],
  [/\bfage\b/i, "Greek Yoghurt"],
  [/\bchobani\b/i, "Greek Yoghurt"],
  [/\byakult\b/i, "Yoghurt"],
  [/\balpro\b/i, "Soy Milk"],
  [/\boatly\b/i, "Oat Milk"],
  [/\bbabybel\b/i, "Cheese"],
  [/\bphiladelphia\b/i, "Cream Cheese"],
  [/\blaughing\s+cow\b/i, "Cheese"],
  [/\bheinz\b/i, "Canned Beans"],
  [/\bhellmann'?s?\b/i, "Mayonnaise"],
  [/\bnutella\b/i, "Nut Spread"],
  [/\bmarmite\b/i, "Yeast Extract"],
  [/\bvegemite\b/i, "Yeast Extract"],
  [/\bquorn\b/i, "Meat-Free Protein"],
  [/\bbeyond\s+(meat|burger)\b/i, "Plant-Based Protein"],
  [/\bimpossible\s+(meat|burger)\b/i, "Plant-Based Protein"],
  [/\btofurky\b/i, "Tofu"],
  [/\bbirds\s+eye\b/i, "Frozen Vegetables"],
  [/\buncle\s+ben'?s?\b/i, "Rice"],
  [/\btilda\b/i, "Rice"],
  [/\bbarilla\b/i, "Pasta"],
  [/\bwarburtons\b/i, "Bread"],
  [/\bhovis\b/i, "Bread"],
  [/\bkingsmill\b/i, "Bread"],
  [/\bwonder\s+bread\b/i, "Bread"],
  [/\bdave'?s\s+killer\s+bread\b/i, "Whole Grain Bread"],
  [/\bryvita\b/i, "Rye Crispbread"],
  [/\bwasa\b/i, "Rye Crispbread"],
  [/\btriscuit\b/i, "Whole Wheat Cracker"],
  [/\bskippy\b/i, "Peanut Butter"],
  [/\bjif\b/i, "Peanut Butter"],
  [/\bwhole\s+earth\b/i, "Peanut Butter"],
  [/\bhalo\s+top\b/i, "Yoghurt"],
  [/\bquest\b/i, ""],
  [/\bclif\b/i, ""],
  [/\bmyprotein\b/i, ""],
  [/\boptimum\s+nutrition\b/i, ""],
  [/\bgatorade\b/i, ""],
  [/\bhuel\b/i, ""],
  [/\bslimfast\b/i, ""],
];

// Generic brand-shape heuristics for anything not on the blocklist.
function looksBrandLike(name: string): boolean {
  if (/[®™©]/.test(name)) return true;
  if (/\b\w+['’]s\b/.test(name)) return true; // possessives: "Trader Joe's"
  if (/[a-z][A-Z]/.test(name)) return true; // inner caps: "PowerBar"
  if (/\b[A-Z]{2,}\b/.test(name)) return true; // ALLCAPS tokens
  if (/\b\w*\d+\w*\b/.test(name)) return true; // model-number style names
  return false;
}

/** Returns a safe generic name, or null if the name must be rejected. */
function sanitizeFoodName(raw: string): string | null {
  let name = String(raw ?? "").trim();
  if (!name) return null;
  for (const [re, replacement] of BRAND_REPLACEMENTS) {
    if (re.test(name)) {
      if (!replacement) {
        console.log(`[generate-foodlist-plan] rejected branded food: "${name}"`);
        return null;
      }
      console.log(`[generate-foodlist-plan] brand mapped: "${name}" -> "${replacement}"`);
      name = replacement;
      return name;
    }
  }
  if (looksBrandLike(name)) {
    console.log(`[generate-foodlist-plan] rejected proper-noun/brand-like food: "${name}"`);
    return null;
  }
  return name;
}

function sanitizeCandidateList(list: string[]): string[] {
  const out: string[] = [];
  for (const c of list) {
    const safe = sanitizeFoodName(c);
    if (safe && !out.some((x) => x.toLowerCase() === safe.toLowerCase())) out.push(safe);
  }
  return out;
}

async function aiCandidatesForSlot(

  apiKey: string,
  params: {
    slotKey: string;
    slotLabel: string;
    slotIndex: number;
    totalSlots: number;
    target: { calories: number; protein_g: number; carbs_g: number; fat_g: number };
    excludedFoods: string[];
    usedFats: string[];
    exclusions: string[];
    preferences: string;
  },
): Promise<{ protein: string[]; carbs: string[]; veg: string[]; fat: string[] }> {
  const system = `You produce ranked food candidate lists for a single meal slot. Use whole, specific foods (no protein powders, bars, packaged sauces). Do not choose any of the following: beef jerky, protein bars, deli meats, processed meats, canned fish in sauce, or any food that comes pre-packaged or heavily processed. Choose only whole, unprocessed foods — fresh meat, fish, poultry, eggs, vegetables, whole grains, legumes, nuts, seeds, and natural oils. Return ONLY JSON.`;
  const fatRotationHint = params.usedFats.length > 0
    ? `Rotate fat sources across slots. These fats were already used in earlier slots: ${params.usedFats.join(", ")}. Use a DIFFERENT fat source here (e.g. if Olive Oil was used, prefer Avocado Oil, Coconut Oil, or Avocado). Do NOT suggest nuts or seeds (almonds, cashews, walnuts, pecans, pistachios, peanuts, sunflower seeds, pumpkin seeds, etc.) as a fat source — they add unaccounted protein and carbohydrates. Preferred fat sources are oils (olive oil, avocado oil, coconut oil) and avocado.`
    : `Pick one whole-food fat source. Preferred fat sources are oils (olive oil, avocado oil, coconut oil) and avocado. Do NOT suggest nuts or seeds (almonds, cashews, walnuts, pecans, pistachios, peanuts, sunflower seeds, pumpkin seeds, etc.) as a fat source — they add unaccounted protein and carbohydrates.`;
  const user = `Meal slot ${params.slotIndex + 1} of ${params.totalSlots}: ${params.slotKey} (${params.slotLabel})
Target: ~${params.target.calories} kcal, P ${params.target.protein_g}g / C ${params.target.carbs_g}g / F ${params.target.fat_g}g

List 6 ranked candidate foods per macro category. Each candidate is a specific named food (e.g. "Chicken Breast", "Brown Rice", "Broccoli", "Olive Oil"). Avoid generic terms.

For vegetables, use simple names only — one or two words maximum. Do not append preparation descriptors such as "sticks", "strips", "florets", "diced", "sliced", "chopped", or "pieces" to vegetable names. Use "Carrots" not "Carrot Sticks". Use "Bell Peppers" not "Bell Pepper Strips". Simple names produce accurate USDA matches.

Use only generic whole-food descriptions. Never use brand names, trademarks, proper nouns, product names, or proprietary/specialty product names of any kind. Every name must be a plain generic food description that has a realistic chance of matching a USDA Foundation or SR Legacy entry (for example a type of bread should be described by its grain, not by any product name).

Do NOT suggest pork or any pork cut as a protein source. This includes pork loin, pork tenderloin, pork chops, pork belly, pork shoulder, ham, bacon, prosciutto, pancetta, or any other pork-derived meat. Never include these in the "protein" list.

${params.slotIndex === 0
  ? `Eggs and egg-based proteins (whole eggs, egg whites, liquid eggs, omelettes, frittatas, etc.) are permitted as a protein source for this slot (Meal 1 / breakfast).`
  : `Do NOT suggest eggs or any egg-based protein (whole eggs, egg whites, liquid eggs, omelettes, frittatas, egg-based dishes, etc.) as a protein source. Eggs are only valid for Meal 1 (breakfast). For this slot, select from fish, poultry, or other lean proteins only. Never include eggs in the "protein" list.`}

Do not use any of the following foods in this slot: ${params.excludedFoods.length ? params.excludedFoods.join(", ") : "(none)"}

${fatRotationHint}

Dietary exclusions (never suggest): ${params.exclusions.length ? params.exclusions.join(", ") : "(none)"}
Additional preferences: ${params.preferences || "(none)"}

Return JSON of this exact shape:
{
  "protein": ["...","...","...","...","...","..."],
  "carbs":   ["...","...","...","...","...","..."],
  "veg":     ["...","...","...","...","...","..."],
  "fat":     ["...","...","...","...","...","..."]
}`;
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
    body: JSON.stringify({
      model: "google/gemini-3.5-flash",
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      response_format: { type: "json_object" },
      max_tokens: 1500,
    }),
  });
  if (!res.ok) throw new Error(`AI candidate fetch failed: ${res.status}`);
  const data = await res.json();
  const content: string = data?.choices?.[0]?.message?.content ?? "{}";
  try {
    const parsed = JSON.parse(content);
    return {
      protein: sanitizeCandidateList(Array.isArray(parsed.protein) ? parsed.protein : []),
      carbs: sanitizeCandidateList(Array.isArray(parsed.carbs) ? parsed.carbs : []),
      veg: sanitizeCandidateList(Array.isArray(parsed.veg) ? parsed.veg : []),
      fat: sanitizeCandidateList(Array.isArray(parsed.fat) ? parsed.fat : []),
    };

  } catch {
    return { protein: [], carbs: [], veg: [], fat: [] };
  }
}

async function aiEstimateMacros(apiKey: string, name: string, portion: string): Promise<Macros | null> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
    body: JSON.stringify({
      model: "google/gemini-3.5-flash",
      messages: [
        { role: "system", content: `Return ONLY JSON {"calories":number,"protein_g":number,"carbs_g":number,"fat_g":number} for the given food + portion. Cooked weights unless noted. Integers.` },
        { role: "user", content: `${name} — ${portion}` },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  try {
    const o = JSON.parse(data?.choices?.[0]?.message?.content ?? "{}");
    const fields = ["calories", "protein_g", "carbs_g", "fat_g"] as const;
    // A reply missing (or non-numeric on) any field is a FAILURE, never a 0.
    for (const f of fields) {
      const n = Number(o?.[f]);
      if (o?.[f] === undefined || o?.[f] === null || !Number.isFinite(n) || n < 0) return null;
    }
    const parsed: Macros = {
      calories: Math.round(Number(o.calories)),
      protein_g: Math.round(Number(o.protein_g) * 10) / 10,
      carbs_g: Math.round(Number(o.carbs_g) * 10) / 10,
      fat_g: Math.round(Number(o.fat_g) * 10) / 10,
    };
    return macrosAreReal(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Always returns real, non-zero macros plus the per-100g density behind them.
 * One AI retry, then a category-default density. Never yields 0/0/0.
 */
async function estimateMacrosGuaranteed(
  apiKey: string,
  name: string,
  portion: string,
  category: Category,
): Promise<{ macros: Macros; per100: Macros; usedDefault: boolean }> {
  const grams = Math.max(1, gramsFromPortion(portion));
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const est = await aiEstimateMacros(apiKey, name, portion).catch(() => null);
    if (macrosAreReal(est)) {
      const f = 100 / grams;
      return {
        macros: est,
        per100: {
          calories: est.calories * f,
          protein_g: est.protein_g * f,
          carbs_g: est.carbs_g * f,
          fat_g: est.fat_g * f,
        },
        usedDefault: false,
      };
    }
    console.log(`[generate-foodlist-plan] AI macro estimate failed for "${name}" (${portion}) — attempt ${attempt + 1}`);
  }
  const per100 = CATEGORY_DEFAULT_PER100[category] ?? CATEGORY_DEFAULT_PER100.Other;
  console.log(`[generate-foodlist-plan] using ${category} default density for "${name}" (${portion})`);
  return { macros: scalePer100(per100, grams), per100, usedDefault: true };
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Missing LOVABLE_API_KEY" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const macros = body?.macros ?? {};
    const calories = Number(macros.calories);
    const protein_g = Number(macros.protein_g);
    const carbs_g = Number(macros.carbs_g);
    const fat_g = Number(macros.fat_g);
    if (![calories, protein_g, carbs_g, fat_g].every((v) => Number.isFinite(v) && v > 0)) {
      return new Response(JSON.stringify({ error: "Valid macros are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const meals_per_day = [3, 4, 5].includes(Number(body?.meals_per_day)) ? Number(body.meals_per_day) : 3;
    const exclusions: string[] = Array.isArray(body?.exclusions)
      ? body.exclusions.map((x: unknown) => String(x ?? "").trim()).filter((x: string) => x.length > 0)
      : [];
    const preferences = typeof body?.preferences === "string" ? body.preferences.trim() : "";
    const activeSlots = slotsForMeals(meals_per_day);

    const MEAL_KEYS = ["meal_1", "meal_2", "meal_3", "meal_4", "meal_5"] as const;
    const allocRaw = (body?.macro_allocation ?? null) as Record<string, { calories?: number; protein_g?: number; carbs_g?: number; fat_g?: number }> | null;
    function perMealTarget(i: number) {
      const fromAlloc = allocRaw?.[MEAL_KEYS[i]];
      if (fromAlloc && [fromAlloc.calories, fromAlloc.protein_g, fromAlloc.carbs_g, fromAlloc.fat_g].some((v) => Number(v) > 0)) {
        return {
          calories: Math.round(Number(fromAlloc.calories ?? 0)),
          protein_g: Math.round(Number(fromAlloc.protein_g ?? 0)),
          carbs_g: Math.round(Number(fromAlloc.carbs_g ?? 0)),
          fat_g: Math.round(Number(fromAlloc.fat_g ?? 0)),
        };
      }
      return {
        calories: Math.round(calories / meals_per_day),
        protein_g: Math.round(protein_g / meals_per_day),
        carbs_g: Math.round(carbs_g / meals_per_day),
        fat_g: Math.round(fat_g / meals_per_day),
      };
    }

    const slotLabelMap: Record<SlotKey, string> = {
      breakfast: "Breakfast", morning_snack: "Morning Snack", lunch: "Lunch",
      afternoon_snack: "Afternoon Snack", dinner: "Dinner",
    };

    const usedProtein = new Set<string>();
    const usedCarbs = new Set<string>();
    const usedFat = new Set<string>();
    const usedVeg = new Set<string>();
    const excludedFoods: string[] = [];
    const usedFatNames: string[] = [];

    const out = emptyList() as Record<SlotKey, FoodItem[]>;
    const debugTargets: Array<{ slot: string; slot_index: number; calories: number; protein_g: number; carbs_g: number; fat_g: number }> = [];
    const debugFoods: DebugFood[] = [];

    const VALID_CATEGORIES: Category[] = ["Protein", "Carbs", "Veg", "Fat"];
    function isValidFoodEntry(name: unknown, category: unknown, per100?: Macros | null): boolean {
      if (typeof name !== "string" || !name.trim()) return false;
      if (typeof category !== "string" || !VALID_CATEGORIES.includes(category as Category)) return false;
      if (per100 && category !== "Veg") {
        const key = densityMacroKey(category as Category);
        const density = Number(per100[key] ?? 0);
        if (!Number.isFinite(density) || density <= 0) return false;
      }
      return true;
    }
    function pushDebugFromUsda(slot: string, slotIndex: number, name: string, category: Category, per100: Macros, usdaDescription: string, portion: string) {
      if (!isValidFoodEntry(name, category, per100)) {
        console.log(`[generate-foodlist-plan] discarding invalid USDA debug entry: name="${name}" category="${category}" usda="${usdaDescription}"`);
        return;
      }
      if (typeof usdaDescription !== "string" || !usdaDescription.trim()) {
        console.log(`[generate-foodlist-plan] discarding USDA debug entry with missing description: name="${name}"`);
        return;
      }
      const key = densityMacroKey(category);
      const macroLabel = category === "Protein" ? "protein" : category === "Carbs" ? "carbs" : category === "Fat" ? "fat" : "calories";
      debugFoods.push({
        slot, slot_index: slotIndex, name, category,
        usda_description: usdaDescription,
        density_macro: macroLabel,
        density_value: Number(per100[key] ?? 0),
        portion,
        estimated: false,
      });
    }
    function pushDebugEstimated(slot: string, slotIndex: number, name: string, category: Category, portion: string) {
      if (!isValidFoodEntry(name, category)) {
        console.log(`[generate-foodlist-plan] discarding invalid estimated debug entry: name="${name}" category="${category}"`);
        return;
      }
      debugFoods.push({ slot, slot_index: slotIndex, name, category, portion, estimated: true });
    }
    function pushItem(items: FoodItem[], item: FoodItem, per100?: Macros | null): boolean {
      if (!isValidFoodEntry(item?.name, item?.category, per100 ?? null)) {
        console.log(`[generate-foodlist-plan] discarding invalid food item: name="${item?.name}" category="${item?.category}"`);
        return false;
      }
      items.push(item);
      return true;
    }

    // Pre-fetch AI candidates for every slot in parallel — biggest wall-clock win.
    const candidatesPerSlot = await Promise.all(
      activeSlots.map((slot, i) =>
        aiCandidatesForSlot(apiKey, {
          slotKey: slot,
          slotLabel: slotLabelMap[slot],
          slotIndex: i,
          totalSlots: activeSlots.length,
          target: perMealTarget(i),
          excludedFoods,           // empty at this point — kept for prompt shape
          usedFats: usedFatNames,  // empty at this point — kept for prompt shape
          exclusions,
          preferences,
        }).catch((e) => {
          console.error("aiCandidatesForSlot failed", slot, e);
          return { protein: [], carbs: [], veg: [], fat: [] };
        }),
      ),
    );

    for (let i = 0; i < activeSlots.length; i += 1) {
      const slot = activeSlots[i];
      const target = perMealTarget(i);
      console.log(`[generate-foodlist-plan] Slot ${i + 1} (${slot}): protein=${target.protein_g}g carbs=${target.carbs_g}g fat=${target.fat_g}g calories=${target.calories}`);
      debugTargets.push({ slot, slot_index: i, ...target });
      const cands = candidatesPerSlot[i];

      cands.veg = [...(cands.veg ?? []), ...VEG_POOL];
      if (i === 0) {
        cands.protein = [...EGG_PROTEIN_POOL];
      }
      const items: FoodItem[] = [];

      // Running totals — every food contributes to all three macros and reduces all remaining targets.
      let remainingProtein = target.protein_g;
      let remainingCarbs = target.carbs_g;
      let remainingFat = target.fat_g;
      let proteinWasFatty = false;

      // Actual accumulator — raw (unrounded) contributions, including hard-coded foods
      // (Whole Egg, Egg White, Liquid Egg Whites, Oats) and USDA-fetched foods alike.
      const actual = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
      const addActual = (m: Macros) => {
        actual.calories += m.calories || 0;
        actual.protein_g += m.protein_g || 0;
        actual.carbs_g += m.carbs_g || 0;
        actual.fat_g += m.fat_g || 0;
      };
      const rawContributionAt = (per100: Macros, grams: number): Macros => {
        const factor = grams / 100;
        return {
          calories: per100.calories * factor,
          protein_g: per100.protein_g * factor,
          carbs_g: per100.carbs_g * factor,
          fat_g: per100.fat_g * factor,
        };
      };

      const contributionAt = (per100: Macros, grams: number): Macros => {
        const raw = rawContributionAt(per100, grams);
        addActual(raw);
        return {
          calories: Math.round(raw.calories),
          protein_g: Math.round(raw.protein_g),
          carbs_g: Math.round(raw.carbs_g),
          fat_g: Math.round(raw.fat_g),
        };
      };
      const subtract = (m: Macros) => {
        remainingProtein -= m.protein_g;
        remainingCarbs -= m.carbs_g;
        remainingFat -= m.fat_g;
      };
      // isEggName is defined at module scope.

      // Step 2 — VEG first (fixed 100g, 2 servings).
      const vegCount = 2;
      for (let v = 0; v < vegCount; v += 1) {
        const found = await findUSDAFood(cands.veg ?? [], usedVeg, "Veg");
        const grams = 100;
        const portion = fmtPortionG(grams);
        if (found) {
          usedVeg.add(canon(found.name));
          const contrib = contributionAt(found.per100, grams);
          subtract(contrib);
          items.push({ name: canonicalName(found.name), portion, category: "Veg", est_macros: contrib });
          pushDebugFromUsda(slot, i, found.name, "Veg", found.per100, found.usdaDescription, portion);
        } else {
          const fallbackName = (cands.veg ?? []).find((n) => !usedVeg.has(canon(n)));
          if (!fallbackName) break;
          const { macros: est } = await estimateMacrosGuaranteed(apiKey, fallbackName, portion, "Veg");
          subtract(est); addActual(est);
          usedVeg.add(canon(fallbackName));
          items.push({ name: canonicalName(fallbackName), portion, category: "Veg", est_macros: est });
          pushDebugEstimated(slot, i, fallbackName, "Veg", portion);
        }

      }

      // Step 3 — sizing order per slot: carbs → protein → fat (veggies already done above).
      if (i === 0) {
        // Meal 1 — order: Oats first, then dynamic egg formula.
        // Hard-coded macros (no USDA calls).
        const WHOLE = { protein_g: 6.3, carbs_g: 0.3, fat_g: 4.75, calories: 70 }; // per 50g egg
        const WHITE = { protein_g: 3.6, carbs_g: 0.1, fat_g: 0.05, calories: 17 }; // per 33g white
        const LIQUID_PER100 = { protein_g: 11, carbs_g: 0.7, fat_g: 0.2, calories: 52 };

        // Meal 1 carb source — always Oats, sized FIRST from remaining carbs (after veggies).
        if (remainingCarbs > 0) {
          const rawGrams = (remainingCarbs / OATS_PER100.carbs_g) * 100;
          const oatsGrams = Math.max(5, Math.round(rawGrams / 5) * 5);
          const factor = oatsGrams / 100;
          const oatsContrib = {
            calories: Math.round(OATS_PER100.calories * factor),
            protein_g: Math.round(OATS_PER100.protein_g * factor * 10) / 10,
            carbs_g: Math.round(OATS_PER100.carbs_g * factor * 10) / 10,
            fat_g: Math.round(OATS_PER100.fat_g * factor * 10) / 10,
          };
          remainingProtein -= OATS_PER100.protein_g * factor;
          remainingCarbs -= OATS_PER100.carbs_g * factor;
          remainingFat -= OATS_PER100.fat_g * factor;
          addActual({
            calories: OATS_PER100.calories * factor,
            protein_g: OATS_PER100.protein_g * factor,
            carbs_g: OATS_PER100.carbs_g * factor,
            fat_g: OATS_PER100.fat_g * factor,
          });
          items.push({
            name: "Oats",
            portion: `${oatsGrams}g`,
            category: "Carbs",
            est_macros: oatsContrib,
          });
          pushDebugFromUsda(slot, i, "Oats", "Carbs", OATS_PER100, OATS_USDA_DESC, `${oatsGrams}g`);
          usedCarbs.add(canon("Oats"));
        }

        // Step 1 — whole egg count from the slot's original fat target.
        let wholeCount = Math.floor(Math.max(0, target.fat_g) / 4.75);
        wholeCount = Math.min(wholeCount, 3);
        wholeCount = Math.max(wholeCount, 1);

        // Step 2 — subtract whole eggs.
        const wholeContrib = {
          calories: Math.round(WHOLE.calories * wholeCount),
          protein_g: Math.round(WHOLE.protein_g * wholeCount * 10) / 10,
          carbs_g: Math.round(WHOLE.carbs_g * wholeCount * 10) / 10,
          fat_g: Math.round(WHOLE.fat_g * wholeCount * 100) / 100,
        };
        remainingProtein -= WHOLE.protein_g * wholeCount;
        remainingCarbs -= WHOLE.carbs_g * wholeCount;
        remainingFat -= WHOLE.fat_g * wholeCount;
        addActual({
          calories: WHOLE.calories * wholeCount,
          protein_g: WHOLE.protein_g * wholeCount,
          carbs_g: WHOLE.carbs_g * wholeCount,
          fat_g: WHOLE.fat_g * wholeCount,
        });
        items.push({
          name: "Whole Egg",
          portion: `${wholeCount} ${wholeCount === 1 ? "egg" : "eggs"}`,
          category: "Protein",
          est_macros: wholeContrib,
        });
        pushDebugFromUsda(slot, i, "Whole Egg", "Protein", { calories: 143, protein_g: 12.6, carbs_g: 0.6, fat_g: 9.5 }, "Whole Egg (hard-coded, 50g)", `${wholeCount} ${wholeCount === 1 ? "egg" : "eggs"}`);

        // Step 3 — (removed) previously subtracted `wholeCount` separate egg whites.
        // We now fold that protein into the liquid-egg-whites portion below so the
        // client doesn't buy extra whole eggs just to discard the yolks. Leaving
        // `remainingProtein` untouched here means Step 4 naturally picks up the
        // ~3.6g protein per egg white at the 11g/100g liquid density (~33g per
        // egg white), rounded to the nearest 5g with the rest of the gap.



        // Step 4 — liquid egg whites fill remaining protein.
        const rawLiquid = Math.max(0, remainingProtein) / 11 * 100;
        const liquidGrams = Math.max(0, Math.round(rawLiquid / 5) * 5);
        if (liquidGrams > 0) {
          const factor = liquidGrams / 100;
          const liquidContrib = {
            calories: Math.round(LIQUID_PER100.calories * factor),
            protein_g: Math.round(LIQUID_PER100.protein_g * factor * 10) / 10,
            carbs_g: Math.round(LIQUID_PER100.carbs_g * factor * 10) / 10,
            fat_g: Math.round(LIQUID_PER100.fat_g * factor * 100) / 100,
          };
          remainingProtein -= LIQUID_PER100.protein_g * factor;
          remainingCarbs -= LIQUID_PER100.carbs_g * factor;
          remainingFat -= LIQUID_PER100.fat_g * factor;
          addActual({
            calories: LIQUID_PER100.calories * factor,
            protein_g: LIQUID_PER100.protein_g * factor,
            carbs_g: LIQUID_PER100.carbs_g * factor,
            fat_g: LIQUID_PER100.fat_g * factor,
          });
          items.push({
            name: "Liquid Egg Whites",
            portion: `${liquidGrams}g`,
            category: "Protein",
            est_macros: liquidContrib,
          });
          pushDebugFromUsda(slot, i, "Liquid Egg Whites", "Protein", LIQUID_PER100, "Liquid Egg Whites (hard-coded, per 100g)", `${liquidGrams}g`);
        }
        usedProtein.add(canon("Eggs"));
      } else {


        // Pre-fetch the carb candidate to detect legume pairing before sizing protein.
        const carbFound = remainingCarbs > 0
          ? await findUSDAFood(cands.carbs ?? [], usedCarbs, "Carbs")
          : null;
        const carbIsLegume = !!carbFound && (
          LEGUME_PAIR_RE.test(carbFound.name) || LEGUME_PAIR_RE.test(carbFound.usdaDescription)
        );

        const placeProtein = async (candidates: string[]) => {
          const found = await findUSDAFood(candidates, usedProtein, "Protein");
          if (found) {
            const fatPer100 = Number(found.per100.fat_g ?? 0);
            const proteinPer100 = Math.max(1, found.per100.protein_g);
            let grams: number;
            if (fatPer100 > 7) {
              proteinWasFatty = true;
              const fromProtein = (Math.max(0, remainingProtein) * 100) / proteinPer100;
              const fromFat = (Math.max(0, remainingFat) * 100) / fatPer100;
              grams = roundPortionG(Math.min(fromProtein, fromFat));
              console.log(`[generate-foodlist-plan] fatty-protein cap on "${found.name}" (fat ${fatPer100}g/100g): fromProtein=${fromProtein.toFixed(1)}g fromFat=${fromFat.toFixed(1)}g → ${grams}g`);
            } else {
              grams = roundPortionG((Math.max(0, remainingProtein) * 100) / proteinPer100);
            }
            let portion: string;
            if (isEggName(found.name)) {
              const count = Math.max(1, Math.round(grams / 50));
              grams = count * 50;
              portion = `${count} ${count === 1 ? "egg" : "eggs"}`;
            } else {
              portion = fmtPortionG(grams);
            }
            const contrib = contributionAt(found.per100, grams);
            subtract(contrib);
            usedProtein.add(canon(found.name));
            items.push({ name: canonicalName(found.name), portion, category: "Protein", est_macros: contrib });
            pushDebugFromUsda(slot, i, found.name, "Protein", found.per100, found.usdaDescription, portion);
          } else {
            const fallbackName = candidates.find((n) => !usedProtein.has(canon(n))) ?? "Chicken Breast";
            let portion: string;
            if (isEggName(fallbackName)) {
              const count = Math.max(1, Math.round(remainingProtein / 6));
              portion = `${count} ${count === 1 ? "egg" : "eggs"}`;
            } else {
              portion = fmtPortionG((remainingProtein * 100) / 30);
            }
            const { macros: est } = await estimateMacrosGuaranteed(apiKey, fallbackName, portion, "Protein");
            subtract(est); addActual(est);
            usedProtein.add(canon(fallbackName));
            items.push({ name: canonicalName(fallbackName), portion, category: "Protein", est_macros: est });
            pushDebugEstimated(slot, i, fallbackName, "Protein", portion);
          }

        };

        const placeCarbFromFound = (found: { name: string; per100: Macros; usdaDescription: string }) => {
          const grams = roundPortionG((Math.max(0, remainingCarbs) * 100) / Math.max(1, found.per100.carbs_g));
          const portion = fmtPortionG(grams);
          const contrib = contributionAt(found.per100, grams);
          subtract(contrib);
          usedCarbs.add(canon(found.name));
          items.push({ name: canonicalName(found.name), portion, category: "Carbs", est_macros: contrib });
          pushDebugFromUsda(slot, i, found.name, "Carbs", found.per100, found.usdaDescription, portion);
        };

        if (carbIsLegume && carbFound) {
          // Legume pairing — Step 1: size legume to carb target, subtract ALL macros (incl. protein).
          placeCarbFromFound(carbFound);
          // Step 2/3 — force lean protein sized to REMAINING protein.
          if (remainingProtein > 0) await placeProtein(LEAN_PROTEIN_POOL);
        } else {
          // Standard order: carbs first (subtract all macros incl. protein), then protein
          // sized to what remains — prevents protein overage from carb-side protein.
          if (carbFound) {
            placeCarbFromFound(carbFound);
          } else if (remainingCarbs > 0) {
            const fallbackName = (cands.carbs ?? []).find((n) => !usedCarbs.has(canon(n))) ?? "Brown Rice";
            const portion = fmtPortionG((remainingCarbs * 100) / 25);
            const { macros: est } = await estimateMacrosGuaranteed(apiKey, fallbackName, portion, "Carbs");
            subtract(est); addActual(est);
            usedCarbs.add(canon(fallbackName));
            items.push({ name: canonicalName(fallbackName), portion, category: "Carbs", est_macros: est });
            pushDebugEstimated(slot, i, fallbackName, "Carbs", portion);
          }
          if (remainingProtein > 0) await placeProtein(cands.protein ?? []);
        }
      }


      // Step 5 — FAT sized to remaining fat. No deadband: any meal still short on
      // fat gets a fat source sized to cover the remainder.
      if (remainingFat > 0) {
        const found = await findUSDAFood(cands.fat ?? [], usedFat, "Fat");
        const foundFatPer100 = Number(found?.per100?.fat_g ?? 0);
        const foundValid = !!found && Number.isFinite(foundFatPer100) && foundFatPer100 > 0;
        if (foundValid && found) {
          let grams: number;
          let portion: string;
          if (isOilName(found.name)) {
            const tsp = Math.max(1, Math.round(remainingFat / 4.5));
            grams = tsp * 4.5;
            portion = `${tsp} tsp`;
          } else {
            grams = roundPortionG((Math.max(0, remainingFat) * 100) / foundFatPer100);
            portion = fmtPortionG(grams);
          }
          const contrib = contributionAt(found.per100, grams);
          subtract(contrib);
          usedFat.add(canon(found.name));
          items.push({ name: canonicalName(found.name), portion, category: "Fat", est_macros: contrib });
          pushDebugFromUsda(slot, i, found.name, "Fat", found.per100, found.usdaDescription, portion);
        } else {
          if (found && !foundValid) {
            console.log(`[generate-foodlist-plan] Fat USDA result for "${found.name}" had invalid fat density (${foundFatPer100}g/100g) — falling back to hard-coded olive oil.`);
          } else {
            console.log(`[generate-foodlist-plan] Fat USDA lookup returned no valid match for ${slot} — falling back to hard-coded olive oil.`);
          }
          // Hard-coded olive oil fallback — ensures fat target is always met.
          const OLIVE_OIL_PER100: Macros = { calories: 884, protein_g: 0, carbs_g: 0, fat_g: 100 };
          const tsp = Math.max(1, Math.round(remainingFat / 4.5));
          const grams = tsp * 4.5;
          const portion = `${tsp} tsp`;
          const contrib = rawContributionAt(OLIVE_OIL_PER100, grams);
          subtract(contrib);
          addActual(contrib);
          usedFat.add(canon("Olive Oil"));
          items.push({ name: "Olive Oil (estimated)", portion, category: "Fat", est_macros: {
            calories: Math.round(contrib.calories),
            protein_g: Math.round(contrib.protein_g),
            carbs_g: Math.round(contrib.carbs_g),
            fat_g: Math.round(contrib.fat_g),
          } });
          pushDebugEstimated(slot, i, "Olive Oil", "Fat", portion);
        }
      }

      // Step 6 — Validate: use live `actual` accumulator (includes hard-coded foods
      // — Whole Egg, Egg White, Liquid Egg Whites, Oats — and AI estimates).
      const actualRounded = {
        calories: Math.round(actual.calories),
        protein_g: Math.round(actual.protein_g * 10) / 10,
        carbs_g: Math.round(actual.carbs_g * 10) / 10,
        fat_g: Math.round(actual.fat_g * 10) / 10,
      };
      const variance = {
        protein_g: Math.round((actualRounded.protein_g - target.protein_g) * 10) / 10,
        carbs_g: Math.round((actualRounded.carbs_g - target.carbs_g) * 10) / 10,
        fat_g: Math.round((actualRounded.fat_g - target.fat_g) * 10) / 10,
      };
      const fmtDelta = (n: number) => `${n >= 0 ? "+" : ""}${n}`;
      const varianceLine = `Meal ${i + 1} — Target: P${target.protein_g}g C${target.carbs_g}g F${target.fat_g}g | Actual: P${actualRounded.protein_g}g C${actualRounded.carbs_g}g F${actualRounded.fat_g}g | Variance: P${fmtDelta(variance.protein_g)}g C${fmtDelta(variance.carbs_g)}g F${fmtDelta(variance.fat_g)}g`;
      console.log(`[generate-foodlist-plan] ${varianceLine}`);
      debugFoods.push({
        slot, slot_index: i, name: varianceLine, category: "Variance",
        portion: "", estimated: false, variance: true,
      } as never);

      out[slot] = items.map((it) => {
        const m = it.est_macros;
        // Final safety net: never let a brand name reach a client.
        let safeName = it.name;
        for (const [re, replacement] of BRAND_REPLACEMENTS) {
          if (re.test(safeName)) {
            const generic = replacement || "Food";
            console.log(`[generate-foodlist-plan] final brand scrub: "${safeName}" -> "${generic}"`);
            safeName = safeName.replace(re, generic).replace(/\s+/g, " ").trim();
            break;
          }
        }
        const rest: Record<string, unknown> = { name: safeName, portion: it.portion, category: it.category };

        if (m) {
          rest.est_calories = Math.round(Number(m.calories) || 0);
          rest.est_protein_g = Math.round((Number(m.protein_g) || 0) * 10) / 10;
          rest.est_carbs_g = Math.round((Number(m.carbs_g) || 0) * 10) / 10;
          rest.est_fat_g = Math.round((Number(m.fat_g) || 0) * 10) / 10;
        }
        // Persist the density model so portion edits scale macros downstream.
        return withDensityModel(rest as never) as typeof it;
      });

      for (const it of items) {
        const cleanName = it.name.replace(/\s*\(estimated\)\s*$/i, "").trim();
        if (it.category === "Protein" || it.category === "Carbs") {
          if (!excludedFoods.includes(cleanName)) excludedFoods.push(cleanName);
        }
        if (it.category === "Fat") {
          if (!usedFatNames.includes(cleanName)) usedFatNames.push(cleanName);
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, food_list: out, debug_targets: debugTargets, debug_foods: debugFoods }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-foodlist-plan error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
