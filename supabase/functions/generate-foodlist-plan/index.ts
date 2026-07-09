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
  type Macros,
  type Category,
} from "../_shared/usda.ts";

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

function canon(name: string): string {
  return name.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-z]+/g, " ").trim();
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

function isOilName(name: string): boolean {
  return /\b(oil|ghee)\b/i.test(name);
}

const RAW_FOODS = /\b(cucumber|tomato|tomatoes|lettuce|spinach|arugula|rocket|bell pepper|peppers?|carrot sticks?|celery|radish|onion|avocado|olives?|salad)\b/i;

function cookedSearchTerm(name: string, category: Category): string {
  const clean = name.trim();
  if (!clean) return clean;
  if (category === "Fat") return clean;
  if (/\bcooked\b/i.test(clean)) return clean;
  if (category === "Veg" && RAW_FOODS.test(clean)) return clean;
  if (category === "Protein" && /\begg/i.test(clean)) return "eggs, whole, cooked";
  return `${clean}, cooked`;
}

// Minimum macro density per 100g for the food's primary macro.
const DENSITY_THRESHOLD: Record<Category, number> = {
  Protein: 15,
  Carbs: 15,
  Fat: 20,
  Veg: 0,
};

function densityMacroKey(category: Category): keyof Macros {
  if (category === "Protein") return "protein_g";
  if (category === "Carbs") return "carbs_g";
  if (category === "Fat") return "fat_g";
  return "calories";
}

const WRONG_FORM_TERMS = /\b(dried|dehydrated|flour|powder|jerky|vegetarian|snack|snacks|imitation|substitute|extract|concentrate|souffl[eé]|casserole|stew|soup|salad|stir[- ]fry|curry|pie|baked dish|bake|mashed|canned|pickled|frozen meal|frozen|mixed dish|with sauce|stuffed|babyfood|strained|rice cake|cookies|puffs|bagels?|pancakes?)\b/i;

const DRY_STAPLE_RE = /\b(oat|oats|oatmeal|rice|lentil|lentils|bean|beans|chickpea|chickpeas|quinoa|barley|farro|bulgur|millet|pea|peas|legume|legumes)\b/i;

const BREAD_NAME_RE = /\b(bread|sourdough|bagel|baguette|ciabatta|focaccia|pita|tortilla|toast|roll|bun|loaf|brioche)\b/i;

// Legumes & grains that should always resolve to a cooked form — never raw / "mature seeds".
const LEGUME_GRAIN_RE = /\b(black bean|kidney bean|chickpea|chickpeas|lentil|lentils|rice|quinoa|oat|oats|oatmeal|bean|beans)\b/i;

// Map a candidate food name to keyword(s) that MUST appear in any accepted USDA result description.
function primaryKeywords(name: string): string[] {
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

function matchesPrimaryKeyword(description: string, candidateName: string): boolean {
  const d = description.toLowerCase();
  const keys = primaryKeywords(candidateName);
  if (keys.length === 0) return true;
  return keys.some((k) => d.includes(k));
}

function isWrongForm(description: string, category: Category, candidateName: string): boolean {
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
const EGG_PER100: Macros = { calories: 143, protein_g: 12.6, carbs_g: 0.6, fat_g: 9.5 };
const EGG_USDA_DESC = "Egg, whole, raw, large (hard-coded)";
const isEggName = (n: string) => /\begg/i.test(n);

// Hard-coded macros for oats (per 100g dry weight).
const OATS_PER100: Macros = { calories: 389, protein_g: 13.2, carbs_g: 67.7, fat_g: 6.5 };
const OATS_USDA_DESC = "Oats, dry (hard-coded)";
const isOatsName = (n: string) => /\b(oats?|oatmeal)\b/i.test(n);

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
      if (category === "Veg" || value >= threshold) {
        if (rejected.length > 0) {
          console.log(`[usda] "${cand}" (${category}): rejected ${rejected.length} entries before accepting "${item.description}" (${macroKey}=${value}g/100g)`);
          for (const r of rejected) console.log(`  rejected (${r.reason}): "${r.desc}" (${macroKey}=${r.value}g/100g, threshold ${threshold})`);
        } else {
          console.log(`[usda] "${cand}" (${category}): accepted "${item.description}" (${macroKey}=${value}g/100g)`);
        }
        return { name: cand, per100: item.per100, usdaDescription: item.description };
      }
      rejected.push({ desc: item.description, value, reason: "low-density" });
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

Do not suggest brand names, proprietary foods, or specialty product names. Use only generic, USDA-compatible names that have a realistic chance of matching a USDA Foundation or SR Legacy entry. Examples: instead of "Ezekiel bread" use "whole grain bread"; instead of "Weetabix" use "whole wheat cereal"; skip items like "Quest bar" entirely. No trademarked or branded products.

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
      model: "google/gemini-2.5-flash",
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
      protein: Array.isArray(parsed.protein) ? parsed.protein : [],
      carbs: Array.isArray(parsed.carbs) ? parsed.carbs : [],
      veg: Array.isArray(parsed.veg) ? parsed.veg : [],
      fat: Array.isArray(parsed.fat) ? parsed.fat : [],
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
      model: "google/gemini-2.5-flash",
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
    return {
      calories: Math.round(Number(o.calories) || 0),
      protein_g: Math.round(Number(o.protein_g) || 0),
      carbs_g: Math.round(Number(o.carbs_g) || 0),
      fat_g: Math.round(Number(o.fat_g) || 0),
    };
  } catch {
    return null;
  }
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
          items.push({ name: found.name, portion, category: "Veg", est_macros: contrib });
          pushDebugFromUsda(slot, i, found.name, "Veg", found.per100, found.usdaDescription, portion);
        } else {
          const fallbackName = (cands.veg ?? []).find((n) => !usedVeg.has(canon(n)));
          if (!fallbackName) break;
          const est = await aiEstimateMacros(apiKey, fallbackName, portion);
          if (est) { subtract(est); addActual(est); }
          usedVeg.add(canon(fallbackName));
          items.push({ name: `${fallbackName} (estimated)`, portion, category: "Veg", est_macros: est ?? undefined });
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
            items.push({ name: found.name, portion, category: "Protein", est_macros: contrib });
            pushDebugFromUsda(slot, i, found.name, "Protein", found.per100, found.usdaDescription, portion);
          } else {
            const fallbackName = candidates.find((n) => !usedProtein.has(canon(n))) ?? "Chicken Breast, cooked";
            let portion: string;
            if (isEggName(fallbackName)) {
              const count = Math.max(1, Math.round(remainingProtein / 6));
              portion = `${count} ${count === 1 ? "egg" : "eggs"}`;
            } else {
              portion = fmtPortionG((remainingProtein * 100) / 30);
            }
            const est = await aiEstimateMacros(apiKey, fallbackName, portion);
            if (est) { subtract(est); addActual(est); }
            usedProtein.add(canon(fallbackName));
            items.push({ name: `${fallbackName} (estimated)`, portion, category: "Protein", est_macros: est ?? undefined });
            pushDebugEstimated(slot, i, fallbackName, "Protein", portion);
          }
        };

        const placeCarbFromFound = (found: { name: string; per100: Macros; usdaDescription: string }) => {
          const grams = roundPortionG((Math.max(0, remainingCarbs) * 100) / Math.max(1, found.per100.carbs_g));
          const portion = fmtPortionG(grams);
          const contrib = contributionAt(found.per100, grams);
          subtract(contrib);
          usedCarbs.add(canon(found.name));
          items.push({ name: found.name, portion, category: "Carbs", est_macros: contrib });
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
            const fallbackName = (cands.carbs ?? []).find((n) => !usedCarbs.has(canon(n))) ?? "Brown Rice (cooked)";
            const portion = fmtPortionG((remainingCarbs * 100) / 25);
            const est = await aiEstimateMacros(apiKey, fallbackName, portion);
            if (est) { subtract(est); addActual(est); }
            usedCarbs.add(canon(fallbackName));
            items.push({ name: `${fallbackName} (estimated)`, portion, category: "Carbs", est_macros: est ?? undefined });
            pushDebugEstimated(slot, i, fallbackName, "Carbs", portion);
          }
          if (remainingProtein > 0) await placeProtein(cands.protein ?? []);
        }
      }


      // Step 5 — FAT sized to remaining fat.
      if (remainingFat > 6) {
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
          items.push({ name: found.name, portion, category: "Fat", est_macros: contrib });
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
        const rest: Record<string, unknown> = { name: it.name, portion: it.portion, category: it.category };
        if (m) {
          rest.est_calories = Math.round(Number(m.calories) || 0);
          rest.est_protein_g = Math.round((Number(m.protein_g) || 0) * 10) / 10;
          rest.est_carbs_g = Math.round((Number(m.carbs_g) || 0) * 10) / 10;
          rest.est_fat_g = Math.round((Number(m.fat_g) || 0) * 10) / 10;
        }
        return rest as typeof it;
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
