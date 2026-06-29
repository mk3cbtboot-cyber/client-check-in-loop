import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { usdaCandidates, type Macros } from "../_shared/usda.ts";

const SLOT_KEYS = ["breakfast", "morning_snack", "lunch", "afternoon_snack", "dinner"] as const;
type SlotKey = (typeof SLOT_KEYS)[number];
type Category = "Protein" | "Carbs" | "Veg" | "Fat";

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
    const list = await usdaCandidates(cookedSearchTerm(cand, category)).catch(() => []);
    const rejected: Array<{ desc: string; value: number }> = [];
    for (const item of list) {
      const value = Number(item.per100[macroKey] ?? 0);
      if (category === "Veg" || value >= threshold) {
        if (rejected.length > 0) {
          console.log(`[density] "${cand}" (${category}): rejected ${rejected.length} low-density entries before accepting "${item.description}" (${macroKey}=${value}g/100g)`);
          for (const r of rejected) console.log(`  rejected: "${r.desc}" (${macroKey}=${r.value}g/100g, threshold ${threshold})`);
        } else {
          console.log(`[density] "${cand}" (${category}): accepted "${item.description}" (${macroKey}=${value}g/100g)`);
        }
        return { name: cand, per100: item.per100, usdaDescription: item.description };
      }
      rejected.push({ desc: item.description, value });
    }
    if (rejected.length > 0) {
      console.log(`[density] "${cand}" (${category}): no USDA entry met threshold ${threshold}g/100g, rejected ${rejected.length} entries — falling back to next candidate`);
      for (const r of rejected) console.log(`  rejected: "${r.desc}" (${macroKey}=${r.value}g/100g)`);
    } else {
      console.log(`[density] "${cand}" (${category}): no USDA results`);
    }
  }
  return null;
}

const VEG_POOL = [
  "Broccoli", "Spinach", "Zucchini", "Bell Peppers", "Cucumber",
  "Tomato", "Asparagus", "Green Beans", "Kale", "Cauliflower",
];

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
    const excludedFoods: string[] = [];
    const usedFatNames: string[] = [];

    const out = emptyList() as Record<SlotKey, FoodItem[]>;
    const debugTargets: Array<{ slot: string; slot_index: number; calories: number; protein_g: number; carbs_g: number; fat_g: number }> = [];
    const debugFoods: DebugFood[] = [];

    function pushDebugFromUsda(slot: string, slotIndex: number, name: string, category: Category, per100: Macros, usdaDescription: string, portion: string) {
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
      debugFoods.push({ slot, slot_index: slotIndex, name, category, portion, estimated: true });
    }

    for (let i = 0; i < activeSlots.length; i += 1) {
      const slot = activeSlots[i];
      const target = perMealTarget(i);
      console.log(`[generate-foodlist-plan] Slot ${i + 1} (${slot}): protein=${target.protein_g}g carbs=${target.carbs_g}g fat=${target.fat_g}g calories=${target.calories}`);
      debugTargets.push({ slot, slot_index: i, ...target });
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
      cands.veg = [...(cands.veg ?? []), ...VEG_POOL];
      if (i === 0) {
        cands.protein = [...EGG_PROTEIN_POOL];
      }
      const items: FoodItem[] = [];

      // PROTEIN
      if (target.protein_g > 0) {
        const found = await findUSDAFood(cands.protein ?? [], usedProtein, "Protein");
        if (found) {
          const grams = roundPortionG((target.protein_g * 100) / Math.max(1, found.per100.protein_g));
          const factor = grams / 100;
          const portion = fmtPortionG(grams);
          usedProtein.add(canon(found.name));
          items.push({
            name: found.name,
            portion,
            category: "Protein",
            est_macros: {
              calories: Math.round(found.per100.calories * factor),
              protein_g: Math.round(found.per100.protein_g * factor),
              carbs_g: Math.round(found.per100.carbs_g * factor),
              fat_g: Math.round(found.per100.fat_g * factor),
            },
          });
          pushDebugFromUsda(slot, i, found.name, "Protein", found.per100, found.usdaDescription, portion);
        } else {
          const fallbackName = (cands.protein ?? []).find((n) => !usedProtein.has(canon(n))) ?? (i === 0 ? "Eggs" : "Chicken Breast, cooked");
          const portion = fmtPortionG((target.protein_g * 100) / 30);
          const est = await aiEstimateMacros(apiKey, fallbackName, portion);
          usedProtein.add(canon(fallbackName));
          items.push({ name: `${fallbackName} (estimated)`, portion, category: "Protein", est_macros: est ?? undefined });
          pushDebugEstimated(slot, i, fallbackName, "Protein", portion);
        }
      }

      // CARBS
      if (target.carbs_g > 0) {
        const found = await findUSDAFood(cands.carbs ?? [], usedCarbs, "Carbs");
        if (found) {
          const grams = roundPortionG((target.carbs_g * 100) / Math.max(1, found.per100.carbs_g));
          const factor = grams / 100;
          const portion = fmtPortionG(grams);
          usedCarbs.add(canon(found.name));
          items.push({
            name: found.name,
            portion,
            category: "Carbs",
            est_macros: {
              calories: Math.round(found.per100.calories * factor),
              protein_g: Math.round(found.per100.protein_g * factor),
              carbs_g: Math.round(found.per100.carbs_g * factor),
              fat_g: Math.round(found.per100.fat_g * factor),
            },
          });
          pushDebugFromUsda(slot, i, found.name, "Carbs", found.per100, found.usdaDescription, portion);
        } else {
          const fallbackName = (cands.carbs ?? []).find((n) => !usedCarbs.has(canon(n))) ?? "Brown Rice (cooked)";
          const portion = fmtPortionG((target.carbs_g * 100) / 25);
          const est = await aiEstimateMacros(apiKey, fallbackName, portion);
          usedCarbs.add(canon(fallbackName));
          items.push({ name: `${fallbackName} (estimated)`, portion, category: "Carbs", est_macros: est ?? undefined });
          pushDebugEstimated(slot, i, fallbackName, "Carbs", portion);
        }
      }

      // VEG — 2 vegetables, no density check
      const vegCount = 2;
      for (let v = 0; v < vegCount; v += 1) {
        const found = await findUSDAFood(cands.veg ?? [], usedVeg, "Veg");
        const grams = 100;
        const portion = fmtPortionG(grams);
        if (found) {
          const factor = grams / 100;
          usedVeg.add(canon(found.name));
          items.push({
            name: found.name,
            portion,
            category: "Veg",
            est_macros: {
              calories: Math.round(found.per100.calories * factor),
              protein_g: Math.round(found.per100.protein_g * factor),
              carbs_g: Math.round(found.per100.carbs_g * factor),
              fat_g: Math.round(found.per100.fat_g * factor),
            },
          });
          pushDebugFromUsda(slot, i, found.name, "Veg", found.per100, found.usdaDescription, portion);
        } else {
          const fallbackName = (cands.veg ?? []).find((n) => !usedVeg.has(canon(n)));
          if (!fallbackName) break;
          const est = await aiEstimateMacros(apiKey, fallbackName, portion);
          usedVeg.add(canon(fallbackName));
          items.push({ name: `${fallbackName} (estimated)`, portion, category: "Veg", est_macros: est ?? undefined });
          pushDebugEstimated(slot, i, fallbackName, "Veg", portion);
        }
      }

      // FAT
      if (target.fat_g > 0) {
        const found = await findUSDAFood(cands.fat ?? [], usedFat, "Fat");
        if (found) {
          if (isOilName(found.name)) {
            const tsp = Math.max(1, Math.round(target.fat_g / 4.5));
            const grams = tsp * 4.5;
            const factor = grams / 100;
            const portion = `${tsp} tsp`;
            usedFat.add(canon(found.name));
            items.push({
              name: found.name,
              portion,
              category: "Fat",
              est_macros: {
                calories: Math.round(found.per100.calories * factor),
                protein_g: Math.round(found.per100.protein_g * factor),
                carbs_g: Math.round(found.per100.carbs_g * factor),
                fat_g: Math.round(found.per100.fat_g * factor),
              },
            });
            pushDebugFromUsda(slot, i, found.name, "Fat", found.per100, found.usdaDescription, portion);
          } else {
            const grams = roundPortionG((target.fat_g * 100) / Math.max(1, found.per100.fat_g));
            const factor = grams / 100;
            const portion = fmtPortionG(grams);
            usedFat.add(canon(found.name));
            items.push({
              name: found.name,
              portion,
              category: "Fat",
              est_macros: {
                calories: Math.round(found.per100.calories * factor),
                protein_g: Math.round(found.per100.protein_g * factor),
                carbs_g: Math.round(found.per100.carbs_g * factor),
                fat_g: Math.round(found.per100.fat_g * factor),
              },
            });
            pushDebugFromUsda(slot, i, found.name, "Fat", found.per100, found.usdaDescription, portion);
          }
        } else {
          const fallbackName = (cands.fat ?? []).find((n) => !usedFat.has(canon(n))) ?? "Olive Oil";
          const isOil = isOilName(fallbackName);
          const portion = isOil
            ? `${Math.max(1, Math.round(target.fat_g / 4.5))} tsp`
            : fmtPortionG(target.fat_g / 0.5);
          const est = await aiEstimateMacros(apiKey, fallbackName, portion);
          usedFat.add(canon(fallbackName));
          items.push({ name: `${fallbackName} (estimated)`, portion, category: "Fat", est_macros: est ?? undefined });
          pushDebugEstimated(slot, i, fallbackName, "Fat", portion);
        }
      }

      out[slot] = items;

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
