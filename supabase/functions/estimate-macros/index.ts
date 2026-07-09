import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { usdaMacros, usdaMacrosForCategory, type Category } from "../_shared/usda.ts";


type Item = { name: string; portion: string; category?: Category };
type Macros = { calories: number; protein_g: number; carbs_g: number; fat_g: number };

function zero(): Macros { return { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }; }

const ALLOWED_CATEGORIES: Category[] = ["Protein", "Carbs", "Veg", "Fat", "Other"];
function normalizeCategory(v: unknown): Category | undefined {
  if (typeof v !== "string") return undefined;
  return ALLOWED_CATEGORIES.includes(v as Category) ? (v as Category) : undefined;
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
    const items: Item[] = Array.isArray(body?.items)
      ? body.items.map((x: unknown) => {
          const o = (x ?? {}) as Record<string, unknown>;
          return {
            name: String(o.name ?? "").trim(),
            portion: String(o.portion ?? "").trim(),
            category: normalizeCategory(o.category),
          };
        }).filter((i: Item) => i.name.length > 0)
      : [];

    if (items.length === 0) {
      return new Response(JSON.stringify({ items: [], totals: zero() }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // USDA FoodData Central first. When the caller supplies a category we use
    // the same category-aware selection rules as the meal-plan generator
    // (cooked search term, raw/dry/mature-seeds rejection, primary-keyword
    // match, density threshold, egg/oats hard-codes). Without a category we
    // fall back to the legacy first-hit lookup for backwards compatibility.
    const usdaResults: (Macros | null)[] = await Promise.all(
      items.map((it) =>
        (it.category
          ? usdaMacrosForCategory(it.name, it.portion, it.category)
          : usdaMacros(it.name, it.portion)
        ).catch(() => null),
      ),
    );
    const missingIdx: number[] = [];
    usdaResults.forEach((r, i) => { if (!r) missingIdx.push(i); });

    let aiResults: Macros[] = [];
    if (missingIdx.length > 0) {
      aiResults = await aiEstimate(apiKey, missingIdx.map((i) => items[i]));
    }
    const outItems: Macros[] = items.map((_, i) => {
      const u = usdaResults[i];
      if (u) return u;
      const j = missingIdx.indexOf(i);
      return aiResults[j] ?? zero();
    });
    const totals = outItems.reduce<Macros>((acc, m) => ({
      calories: acc.calories + m.calories,
      protein_g: acc.protein_g + m.protein_g,
      carbs_g: acc.carbs_g + m.carbs_g,
      fat_g: acc.fat_g + m.fat_g,
    }), zero());
    return new Response(JSON.stringify({ items: outItems, totals }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("estimate-macros error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function aiEstimate(apiKey: string, items: Item[]): Promise<Macros[]> {
  if (items.length === 0) return [];
  const system = `You are a nutrition database. Estimate macros for each food item at the given portion. Cooked weights unless noted. Be reasonable; use common nutritional values. Return ONLY JSON of this shape: {"items":[{"calories":number,"protein_g":number,"carbs_g":number,"fat_g":number}]} with one entry per input item in the same order. Round to integers.`;
  const user = `Estimate macros for these items (return one entry per item, in order):\n${items.map((it, i) => `${i + 1}. ${it.name} — ${it.portion}`).join("\n")}`;
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    console.error("AI fallback error", res.status, await res.text());
    return items.map(() => zero());
  }
  const data = await res.json();
  const content: string = data?.choices?.[0]?.message?.content ?? "";
  let parsed: { items?: unknown[] } = {};
  try { parsed = JSON.parse(content); } catch { return items.map(() => zero()); }
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
  };
  return items.map((_, i) => {
    const o = (Array.isArray(parsed.items) ? parsed.items[i] : null) as Record<string, unknown> | null;
    return {
      calories: num(o?.calories),
      protein_g: num(o?.protein_g),
      carbs_g: num(o?.carbs_g),
      fat_g: num(o?.fat_g),
    };
  });
}
