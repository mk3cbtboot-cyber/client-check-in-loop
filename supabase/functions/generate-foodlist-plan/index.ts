import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { usdaMacros, type Macros } from "../_shared/usda.ts";

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
  category: "Protein" | "Carbs" | "Veg" | "Fat";
  est_macros?: Macros;
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

function fatPortionString(name: string, targetFatG: number): { portion: string; grams: number } {
  if (isOilName(name)) {
    // 1 tsp oil ≈ 4.5g
    const tsp = Math.max(1, Math.round(targetFatG / 4.5));
    return { portion: `${tsp} tsp`, grams: tsp * 4.5 };
  }
  return { portion: fmtPortionG(targetFatG / 0.5), grams: roundPortionG(targetFatG / 0.5) }; // approx; replaced after USDA lookup
}

// Foods typically eaten raw — skip the "cooked" suffix on USDA lookups.
const RAW_FOODS = /\b(cucumber|tomato|tomatoes|lettuce|spinach|arugula|rocket|bell pepper|peppers?|carrot sticks?|celery|radish|onion|avocado|olives?|salad)\b/i;

function cookedSearchTerm(name: string, category: "Protein" | "Carbs" | "Veg" | "Fat"): string {
  const clean = name.trim();
  if (!clean) return clean;
  if (category === "Fat") return clean; // oils/nuts/avocado — leave as-is
  if (/\bcooked\b/i.test(clean)) return clean;
  if (category === "Veg" && RAW_FOODS.test(clean)) return clean;
  if (category === "Protein" && /\begg/i.test(clean)) return "eggs, whole, cooked";
  return `${clean}, cooked`;
}

async function findUSDAFood(
  candidates: string[],
  used: Set<string>,
  category: "Protein" | "Carbs" | "Veg" | "Fat",
): Promise<{ name: string; per100: Macros } | null> {
  for (const cand of candidates) {
    const key = canon(cand);
    if (!key || used.has(key)) continue;
    const per100 = await usdaMacros(cookedSearchTerm(cand, category), "100g").catch(() => null);
    if (per100) return { name: cand, per100 };
  }
  return null;
}

const VEG_POOL = [
  "Broccoli", "Spinach", "Zucchini", "Bell Peppers", "Cucumber",
  "Tomato", "Asparagus", "Green Beans", "Kale", "Cauliflower",
];

// Meal 1 is always breakfast — proteins limited to eggs.
// Meal 1 is always breakfast — protein is always eggs.
const EGG_PROTEIN_POOL = ["Eggs"];

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
  const system = `You produce ranked food candidate lists for a single meal slot. Use whole, specific foods (no protein powders, bars, packaged sauces). Return ONLY JSON.`;
  const fatRotationHint = params.usedFats.length > 0
    ? `Rotate fat sources across slots. These fats were already used in earlier slots: ${params.usedFats.join(", ")}. Use a DIFFERENT fat source here (e.g. if Olive Oil was used, prefer Avocado, Coconut Oil, Ghee, Butter, Nuts, or Seeds).`
    : `Pick one whole-food fat source (e.g. Olive Oil, Avocado, Coconut Oil, Ghee, Butter, Almonds, Walnuts).`;
  const user = `Meal slot ${params.slotIndex + 1} of ${params.totalSlots}: ${params.slotKey} (${params.slotLabel})
Target: ~${params.target.calories} kcal, P ${params.target.protein_g}g / C ${params.target.carbs_g}g / F ${params.target.fat_g}g

List 6 ranked candidate foods per macro category. Each candidate is a specific named food (e.g. "Chicken Breast", "Brown Rice", "Broccoli", "Olive Oil"). Avoid generic terms.

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
    const excludedFoods: string[] = []; // protein + carb names used in earlier slots
    const usedFatNames: string[] = [];

    const out = emptyList() as Record<SlotKey, FoodItem[]>;

    for (let i = 0; i < activeSlots.length; i += 1) {
      const slot = activeSlots[i];
      const target = perMealTarget(i);
      let cands: { protein: string[]; carbs: string[]; veg: string[]; fat: string[] } = { protein: [], carbs: [], veg: [], fat: [] };
      try {
        cands = await aiCandidatesForSlot(apiKey, {
          slotKey: slot,
          slotLabel: slotLabelMap[slot],
          slotIndex: i,
          totalSlots: activeSlots.length,
          target,
          excludedFoods,
          usedFats: usedFatNames,
          exclusions,
          preferences,
        });
      } catch (e) {
        console.error("aiCandidatesForSlot failed", slot, e);
      }
      // Always include VEG_POOL as fallback candidates (filtered by used)
      cands.veg = [...(cands.veg ?? []), ...VEG_POOL];
      // Meal 1 is always breakfast — restrict protein to eggs only.
      if (i === 0) {
        cands.protein = [...EGG_PROTEIN_POOL];
      }
      const items: FoodItem[] = [];


      // PROTEIN — always one
      if (target.protein_g > 0) {
        const found = await findUSDAFood(cands.protein ?? [], usedProtein, "Protein");
        if (found) {
          const grams = roundPortionG((target.protein_g * 100) / Math.max(1, found.per100.protein_g));
          const factor = grams / 100;
          usedProtein.add(canon(found.name));
          items.push({
            name: found.name,
            portion: fmtPortionG(grams),
            category: "Protein",
            est_macros: {
              calories: Math.round(found.per100.calories * factor),
              protein_g: Math.round(found.per100.protein_g * factor),
              carbs_g: Math.round(found.per100.carbs_g * factor),
              fat_g: Math.round(found.per100.fat_g * factor),
            },
          });
        } else {
          const fallbackName = (cands.protein ?? []).find((n) => !usedProtein.has(canon(n))) ?? (i === 0 ? "Eggs" : "Chicken Breast, cooked");
          const portion = fmtPortionG((target.protein_g * 100) / 30); // assume ~30g protein per 100g
          const est = await aiEstimateMacros(apiKey, fallbackName, portion);
          usedProtein.add(canon(fallbackName));
          items.push({ name: `${fallbackName} (estimated)`, portion, category: "Protein", est_macros: est ?? undefined });
        }
      }

      // CARBS — only if allocation > 0
      if (target.carbs_g > 0) {
        const found = await findUSDAFood(cands.carbs ?? [], usedCarbs, "Carbs");
        if (found) {
          const grams = roundPortionG((target.carbs_g * 100) / Math.max(1, found.per100.carbs_g));
          const factor = grams / 100;
          usedCarbs.add(canon(found.name));
          items.push({
            name: found.name,
            portion: fmtPortionG(grams),
            category: "Carbs",
            est_macros: {
              calories: Math.round(found.per100.calories * factor),
              protein_g: Math.round(found.per100.protein_g * factor),
              carbs_g: Math.round(found.per100.carbs_g * factor),
              fat_g: Math.round(found.per100.fat_g * factor),
            },
          });
        } else {
          const fallbackName = (cands.carbs ?? []).find((n) => !usedCarbs.has(canon(n))) ?? "Brown Rice (cooked)";
          const portion = fmtPortionG((target.carbs_g * 100) / 25);
          const est = await aiEstimateMacros(apiKey, fallbackName, portion);
          usedCarbs.add(canon(fallbackName));
          items.push({ name: `${fallbackName} (estimated)`, portion, category: "Carbs", est_macros: est ?? undefined });
        }
      }

      // VEG — include 2 vegetables, avoid repeats across slots
      const vegCount = 2;
      for (let v = 0; v < vegCount; v += 1) {
        const found = await findUSDAFood(cands.veg ?? [], usedVeg, "Veg");
        const grams = 100;
        if (found) {
          const factor = grams / 100;
          usedVeg.add(canon(found.name));
          items.push({
            name: found.name,
            portion: fmtPortionG(grams),
            category: "Veg",
            est_macros: {
              calories: Math.round(found.per100.calories * factor),
              protein_g: Math.round(found.per100.protein_g * factor),
              carbs_g: Math.round(found.per100.carbs_g * factor),
              fat_g: Math.round(found.per100.fat_g * factor),
            },
          });
        } else {
          const fallbackName = (cands.veg ?? []).find((n) => !usedVeg.has(canon(n)));
          if (!fallbackName) break;
          const est = await aiEstimateMacros(apiKey, fallbackName, `${grams}g`);
          usedVeg.add(canon(fallbackName));
          items.push({ name: `${fallbackName} (estimated)`, portion: `${grams}g`, category: "Veg", est_macros: est ?? undefined });
        }
      }

      // FAT — only if allocation > 0
      if (target.fat_g > 0) {
        const found = await findUSDAFood(cands.fat ?? [], usedFat, "Fat");
        if (found) {
          if (isOilName(found.name)) {
            const tsp = Math.max(1, Math.round(target.fat_g / 4.5));
            const grams = tsp * 4.5;
            const factor = grams / 100;
            usedFat.add(canon(found.name));
            items.push({
              name: found.name,
              portion: `${tsp} tsp`,
              category: "Fat",
              est_macros: {
                calories: Math.round(found.per100.calories * factor),
                protein_g: Math.round(found.per100.protein_g * factor),
                carbs_g: Math.round(found.per100.carbs_g * factor),
                fat_g: Math.round(found.per100.fat_g * factor),
              },
            });
          } else {
            const grams = roundPortionG((target.fat_g * 100) / Math.max(1, found.per100.fat_g));
            const factor = grams / 100;
            usedFat.add(canon(found.name));
            items.push({
              name: found.name,
              portion: fmtPortionG(grams),
              category: "Fat",
              est_macros: {
                calories: Math.round(found.per100.calories * factor),
                protein_g: Math.round(found.per100.protein_g * factor),
                carbs_g: Math.round(found.per100.carbs_g * factor),
                fat_g: Math.round(found.per100.fat_g * factor),
              },
            });
          }
        } else {
          const fallbackName = (cands.fat ?? []).find((n) => !usedFat.has(canon(n))) ?? "Olive Oil";
          const isOil = isOilName(fallbackName);
          const portion = isOil
            ? `${Math.max(1, Math.round(target.fat_g / 4.5))} tsp`
            : fatPortionString(fallbackName, target.fat_g).portion;
          const est = await aiEstimateMacros(apiKey, fallbackName, portion);
          usedFat.add(canon(fallbackName));
          items.push({ name: `${fallbackName} (estimated)`, portion, category: "Fat", est_macros: est ?? undefined });
        }
      }

      out[slot] = items;

      // Progressively grow excluded lists for next slot's prompt.
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


    return new Response(JSON.stringify({ ok: true, food_list: out }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-foodlist-plan error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
