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
  phase_variant: z.enum(["strict", "extended"]).optional(), // legacy, ignored
  oil: z.string().max(60).optional(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "Invalid input" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { token, meal_type, option_label, ingredients, phase_variant, oil } = parsed.data;

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: c } = await admin.from("clients").select("*").eq("magic_token", token).maybeSingle();
    if (!c) return new Response(JSON.stringify({ error: "Invalid link" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    if (c.phase === "phase1") {
      return new Response(JSON.stringify({ error: "The recipe builder is not available during Phase 1." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Count avocado / egg usage from this meal
    const avocadoUses = ingredients.filter((i) => /avocado/i.test(i.label)).length;
    if ((c.avocado_count_week ?? 0) + avocadoUses > 3) {
      return new Response(JSON.stringify({ error: "Avocado limit (3/week) reached." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const eggsAdded = meal_type === "lunch" && /Eggs/i.test(option_label) ? 2 : 0;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const oilAllowed = c.phase === "phase2_extended" || c.phase === "phase3" || c.phase === "phase4";
    const phaseDescriptor =
      c.phase === "phase2_strict" ? "Phase 2 Strict — Strict Conversion (NO oil at all, no substitutions)" :
      c.phase === "phase2_extended" ? "Phase 2 Extended — up to 1 tbsp cold-pressed oil per meal is allowed (optional)" :
      c.phase === "phase3" ? "Phase 3 — Relaxed Conversion, up to 1 tbsp cold-pressed oil per meal is allowed (optional)" :
      c.phase === "phase4" ? "Phase 4 — Maintenance, cold-pressed oil allowed in moderation" :
      "Phase 2 Strict (no oil)";

    const ingredientList = ingredients.map((i) => `- ${i.label}: ${i.qty}`).join("\n");

    const systemPrompt = `You are a Metabolic Balance recipe assistant writing for COMPLETE BEGINNERS who have never cooked from scratch before.

INGREDIENT RULES (non-negotiable):
- Use EVERY ingredient in the provided list. Do not omit, substitute, or merge any item.
- Use the EXACT quantity specified for each ingredient — verbatim, no rounding, no scaling.
- If two vegetables are listed (Vegetable 1 AND Vegetable 2), BOTH must appear in the RECIPE list with their own gram amounts AND each must have at least one dedicated preparation step in the METHOD.
- The Metabolic Balance protocol is a nutritional prescription — every gram is calculated for this client's macro/micronutrient needs.
- Phase rules for THIS client: ${oilAllowed ? "cold-pressed oil is OPTIONAL — you may suggest up to 1 tablespoon (15ml) of cold-pressed oil (olive, flax, or similar) per meal if it improves the dish; never exceed 1 tbsp per meal." : "absolutely NO oil of any kind. Do not add oil. Use water, broth, or dry-pan techniques only."}
- Always prepare the protein first.

METHOD RULES (write for someone who has never turned on a stove):
- Number each step. Keep each step to one clear action.
- Include exact temperatures in BOTH °C and °F (e.g. "medium heat, about 180°C / 350°F").
- Include exact timings (e.g. "cook for 4 minutes").
- Include visual cues (colour, texture: "until golden brown and the edges look crisp").
- Include smell cues where relevant ("you'll smell a nutty, toasted aroma when it's ready").
- Specify the equipment needed (e.g. "non-stick frying pan", "sharp knife and chopping board", "small saucepan with lid", "digital kitchen scale", "wooden spoon").
- Tell them HOW to prep (e.g. "wash the spinach under cold running water, then shake off excess water", "slice the carrots into thin coins about the thickness of a £1 coin / quarter").
- Call out common beginner mistakes to avoid ("do not overcrowd the pan or the chicken will steam instead of brown", "do not flip the fish too early — wait until it releases easily from the pan").
- Mention safety basics where relevant (washing hands after raw chicken, checking fish flakes easily with a fork, etc.).
- If two vegetables are used, give each its own clearly labelled prep + cook step.

OUTPUT: Return ONLY by calling the provided tool with RECIPE (every ingredient with exact quantity), METHOD (numbered beginner-friendly steps as described above), NOTES (3-5 MB compliance reminders).`;

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
