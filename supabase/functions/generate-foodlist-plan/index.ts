import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

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
    const slotLabelMap: Record<SlotKey, string> = {
      breakfast: "Breakfast (main)",
      morning_snack: "Morning Snack (snack)",
      lunch: "Lunch (main)",
      afternoon_snack: "Afternoon Snack (snack)",
      dinner: "Dinner (main)",
    };
    const activeDesc = activeSlots.map((s, i) => `${i + 1}. ${s} — ${slotLabelMap[s]}`).join("\n");

    const systemPrompt = `You are a clinical nutrition assistant generating a daily food list for one client.

OUTPUT FORMAT: Respond ONLY with JSON of this exact shape (omit keys for slots that are NOT in the active list):
{
  "breakfast": [{"name": string, "portion": string, "category": "Protein"|"Carbs"|"Veg"|"Fat"}],
  "morning_snack": [...],
  "lunch": [...],
  "afternoon_snack": [...],
  "dinner": [...]
}

RULES:
- Use ONLY whole, unprocessed foods (no protein powders, no bars, no packaged sauces).
- For each active meal slot, provide 3–4 specific food options per category (Protein, Carbs, Veg, Fat). Each option is a separate array entry with the same category value.
- Specific named foods only — "Chicken Breast", "Turkey Breast", "White Fish (cod, haddock)", "Brown Rice (cooked)" — NEVER generic terms like "Poultry", "Grain", "Vegetables".
- Portion is grams, formatted as "<number>g" (e.g. "120g"). Cooked weights for proteins and carbs.
- EXCEPTION: For oils and liquid fats (olive oil, coconut oil, avocado oil, sesame oil, flaxseed oil, butter, ghee, etc.), use teaspoons formatted as "<number> tsp" (e.g. "2 tsp") instead of grams. All other foods, including solid fats like nuts, seeds, and avocado, remain in grams.
- Snack slots receive roughly half the macros of a main meal. Distribute remaining macros evenly across main meals so totals across one option per category per slot approximate the daily macro targets.
- Snack slots typically need only Protein + Carbs (or Protein + Fat) — Veg/Fat optional for snacks; main meals should always include all four categories.
- Strictly exclude any food on the exclusions list (including variants).
- Honour the practitioner's additional preferences.`;

    const userPrompt = `Daily macro targets:
- Calories: ${calories} kcal
- Protein: ${protein_g} g
- Carbs: ${carbs_g} g
- Fat: ${fat_g} g

Meals per day: ${meals_per_day}
Active slots (in order):
${activeDesc}

Food exclusions (do not use any of these or close variants): ${exclusions.length ? exclusions.join(", ") : "(none)"}

Additional preferences: ${preferences || "(none)"}

Generate the food list now. Return JSON only.`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("AI gateway error", res.status, text);
      if (res.status === 429) return new Response(JSON.stringify({ error: "Rate limit, please retry shortly." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (res.status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ error: "AI generation failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const data = await res.json();
    const content: string = data?.choices?.[0]?.message?.content ?? "";
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(content); } catch {
      return new Response(JSON.stringify({ error: "AI returned invalid JSON" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const CATS = new Set(["Protein", "Carbs", "Veg", "Fat"]);
    const out = emptyList();
    for (const slot of activeSlots) {
      const arr = Array.isArray(parsed[slot]) ? (parsed[slot] as unknown[]) : [];
      out[slot] = arr.map((x) => {
        const o = (x ?? {}) as Record<string, unknown>;
        const cat = String(o.category ?? "");
        return {
          name: String(o.name ?? "").trim(),
          portion: String(o.portion ?? "").trim(),
          category: CATS.has(cat) ? cat : "Other",
        };
      }).filter((it) => it.name.length > 0);
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
