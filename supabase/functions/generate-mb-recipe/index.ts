import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const Body = z.object({
  token: z.string().min(10).max(200),
  meal_type: z.enum(["breakfast", "lunch", "dinner"]),
  option_label: z.string().min(2).max(200),
  ingredients: z.array(z.object({ label: z.string(), qty: z.string() })).min(1).max(20),
  phase_variant: z.enum(["strict", "extended"]).optional(), // for phase 2
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "Invalid input" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { token, meal_type, option_label, ingredients, phase_variant } = parsed.data;

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: c } = await admin.from("clients").select("*").eq("magic_token", token).maybeSingle();
    if (!c) return new Response(JSON.stringify({ error: "Invalid link" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Count avocado / egg usage from this meal
    const avocadoUses = ingredients.filter((i) => /avocado/i.test(i.label)).length;
    if ((c.avocado_count_week ?? 0) + avocadoUses > 3) {
      return new Response(JSON.stringify({ error: "Avocado limit (3/week) reached." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const eggsAdded = meal_type === "lunch" && /Eggs/i.test(option_label) ? 2 : 0;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const phaseDescriptor =
      c.phase === 1 ? "Phase 1 (preparation)" :
      c.phase === 3 ? "Phase 3 (maintenance) — small amount of cold-pressed oil allowed" :
      phase_variant === "extended" ? "Phase 2 extended — small amount of cold-pressed oil allowed" :
      "Phase 2 strict (first 14 days) — NO oil at all";

    const ingredientList = ingredients.map((i) => `- ${i.label}: ${i.qty}`).join("\n");

    const systemPrompt = `You are a Metabolic Balance recipe assistant. Generate a recipe using EXACTLY the ingredients provided, at EXACTLY the quantities specified. Do not substitute, omit, or adjust any ingredient or quantity. The Metabolic Balance protocol is a nutritional prescription — every ingredient is calculated for this client's specific macro and micro nutrient requirements. If the client is in Phase 2 strict (first 14 days), do not include any oil. If in Phase 2 extended or Phase 3, a small amount of cold-pressed oil may be used. Always structure the recipe so the protein is prepared first. Output three sections: RECIPE (list all ingredients with exact quantities), METHOD (numbered cooking steps, clear and practical), NOTES (3-5 MB compliance reminders relevant to this meal). Return ONLY by calling the provided tool.`;

    const userPrompt = `Client phase: ${phaseDescriptor}\nMeal: ${meal_type} — ${option_label}\nIngredients (use exactly):\n${ingredientList}`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "return_mb_recipe",
            description: "Return MB recipe with three sections.",
            parameters: {
              type: "object",
              properties: {
                recipe_title: { type: "string" },
                recipe: { type: "array", items: { type: "string" }, description: "Ingredient lines with exact quantities" },
                method: { type: "array", items: { type: "string" }, description: "Numbered cooking steps in order" },
                notes: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 5 },
              },
              required: ["recipe_title", "recipe", "method", "notes"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "return_mb_recipe" } },
      }),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429) return new Response(JSON.stringify({ error: "Rate limit, please retry shortly." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (aiResp.status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const t = await aiResp.text();
      console.error("AI error", aiResp.status, t);
      throw new Error("AI generation failed");
    }
    const data = await aiResp.json();
    const tc = data.choices?.[0]?.message?.tool_calls?.[0];
    const args = tc ? JSON.parse(tc.function.arguments) : null;
    if (!args) throw new Error("No recipe returned");

    // Update counters + meal streak
    await admin.from("clients").update({
      avocado_count_week: (c.avocado_count_week ?? 0) + avocadoUses,
      egg_count_week: (c.egg_count_week ?? 0) + eggsAdded,
      meal_streak: (c.meal_streak ?? 0) + 1,
    }).eq("id", c.id);

    return new Response(JSON.stringify({ ok: true, ...args }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("generate-mb-recipe error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
