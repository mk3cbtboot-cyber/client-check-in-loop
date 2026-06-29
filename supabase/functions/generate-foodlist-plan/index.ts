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

async function findUSDAFood(
  candidates: string[],
  used: Set<string>,
): Promise<{ name: string; per100: Macros } | null> {
  for (const cand of candidates) {
    const key = canon(cand);
    if (!key || used.has(key)) continue;
    const per100 = await usdaMacros(cand, "100g").catch(() => null);
    if (per100) return { name: cand, per100 };
  }
  return null;
}

async function aiCandidates(
  apiKey: string,
  params: {
    slotsDesc: string;
    exclusions: string[];
    preferences: string;
  },
): Promise<Record<SlotKey, { protein: string[]; carbs: string[]; veg: string[]; fat: string[] }>> {
  const system = `You produce ranked food candidate lists for a daily meal plan. Use whole, specific foods (no protein powders, bars, packaged sauces). Return ONLY JSON.`;
  const user = `For each meal slot below, list 6 ranked candidate foods per macro category. Each candidate is a specific named food (e.g. "Chicken Breast", "Brown Rice", "Broccoli", "Olive Oil"). Avoid generic terms. Respect exclusions.

Slots (in order):
${params.slotsDesc}

Exclusions: ${params.exclusions.length ? params.exclusions.join(", ") : "(none)"}
Additional preferences: ${params.preferences || "(none)"}

Return JSON of this exact shape (omit keys for slots not in the list):
{
  "<slot_key>": {
    "protein": ["...","...","...","...","...","..."],
    "carbs":   ["...","...","...","...","...","..."],
    "veg":     ["...","...","...","...","...","..."],
    "fat":     ["...","...","...","...","...","..."]
  }
}`;
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      response_format: { type: "json_object" },
      max_tokens: 4000,
    }),
  });
  if (!res.ok) throw new Error(`AI candidate fetch failed: ${res.status}`);
  const data = await res.json();
  const content: string = data?.choices?.[0]?.message?.content ?? "{}";
  try {
    return JSON.parse(content);
  } catch {
    return {} as Record<SlotKey, { protein: string[]; carbs: string[]; veg: string[]; fat: string[] }>;
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
    const slotsDesc = activeSlots.map((s, i) => {
      const t = perMealTarget(i);
      return `- ${s} (${slotLabelMap[s]}): ~${t.calories} kcal, P ${t.protein_g}g / C ${t.carbs_g}g / F ${t.fat_g}g`;
    }).join("\n");

    let candidatesBySlot: Record<string, { protein: string[]; carbs: string[]; veg: string[]; fat: string[] }> = {};
    try {
      candidatesBySlot = await aiCandidates(apiKey, { slotsDesc, exclusions, preferences });
    } catch (e) {
      console.error("aiCandidates failed", e);
    }

    const usedProtein = new Set<string>();
    const usedCarbs = new Set<string>();
    const usedFat = new Set<string>();
    const usedVeg = new Set<string>();

    const out = emptyList() as Record<SlotKey, FoodItem[]>;

    for (let i = 0; i < activeSlots.length; i += 1) {
      const slot = activeSlots[i];
      const target = perMealTarget(i);
      const cands = candidatesBySlot[slot] ?? { protein: [], carbs: [], veg: [], fat: [] };
      const items: FoodItem[] = [];

      // PROTEIN — always one
      if (target.protein_g > 0) {
        const found = await findUSDAFood(cands.protein ?? [], usedProtein);
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
          const fallbackName = (cands.protein ?? []).find((n) => !usedProtein.has(canon(n))) ?? "Chicken Breast";
          const portion = fmtPortionG((target.protein_g * 100) / 30); // assume ~30g protein per 100g
          const est = await aiEstimateMacros(apiKey, fallbackName, portion);
          usedProtein.add(canon(fallbackName));
          items.push({ name: `${fallbackName} (estimated)`, portion, category: "Protein", est_macros: est ?? undefined });
        }
      }

      // CARBS — only if allocation > 0
      if (target.carbs_g > 0) {
        const found = await findUSDAFood(cands.carbs ?? [], usedCarbs);
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
        const found = await findUSDAFood(cands.veg ?? [], usedVeg);
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
        const found = await findUSDAFood(cands.fat ?? [], usedFat);
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
