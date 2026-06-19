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
    const { token, meal_type, option_label, ingredients: rawIngredients, oil } = parsed.data;

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: c } = await admin.from("clients").select("*").eq("magic_token", token).maybeSingle();
    if (!c) return new Response(JSON.stringify({ error: "Invalid link" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    if (c.phase === "phase1") {
      return new Response(JSON.stringify({ error: "The recipe builder is not available during Phase 1." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Phase 3 lunch portion bonuses — applied to protein and carb/bread ingredients on lunch only.
    // Egg-based lunch meals: skip the protein bonus (eggs come in whole units; the carb bonus still applies).
    const isEggLunch = meal_type === "lunch" && rawIngredients.some((i) => /egg/i.test(i.label));
    const proteinBonus = c.phase === "phase3" && meal_type === "lunch" && !isEggLunch ? Number(c.phase3_lunch_protein_bonus ?? 0) : 0;
    const carbBonus = c.phase === "phase3" && meal_type === "lunch" ? Number(c.phase3_lunch_carb_bonus ?? 0) : 0;
    const PROTEIN_LABELS = /^(poultry|fish( or seafood)?|seafood|meat|cheese|legumes)\b/i;
    const CARB_LABELS = /^(bread|starches?)\b/i;
    const bumpQty = (qty: string, add: number): string => {
      if (!add) return qty;
      const m = qty.match(/^(\d+(?:\.\d+)?)\s*g\b(.*)$/i);
      if (m) return `${Math.round(parseFloat(m[1]) + add)}g${m[2] ?? ""}`;
      return `${qty} (+${add}g)`;
    };
    const ingredients = rawIngredients.map((i) => {
      if (proteinBonus && PROTEIN_LABELS.test(i.label)) return { ...i, qty: bumpQty(i.qty, proteinBonus) };
      if (carbBonus && CARB_LABELS.test(i.label)) return { ...i, qty: bumpQty(i.qty, carbBonus) };
      return i;
    });

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const oilAllowed = c.phase === "phase3" || c.phase === "phase4";
    const phaseDescriptor =
      c.phase === "phase2_strict" ? "Phase 2 Strict — Strict Conversion (NO oil at all, no substitutions)" :
      c.phase === "phase2_extended" ? "Phase 2 Extended — Treat Meals (NO oil at all; one treat meal allowed per week)" :
      c.phase === "phase3" ? "Phase 3 — Relaxed Conversion, up to 1 tbsp cold-pressed oil per meal is allowed (optional)" :
      c.phase === "phase4" ? "Phase 4 — Maintenance, cold-pressed oil allowed in moderation" :
      "Phase 2 Strict (no oil)";

    const ingredientList = ingredients.map((i) => `- ${i.label}: ${i.qty}`).join("\n");

    const systemPrompt = `You are a Metabolic Balance recipe assistant writing for COMPLETE BEGINNERS who have never cooked from scratch before.

You must return THREE DISTINCT recipe variations using the same provided ingredients. Each variation should differ meaningfully — different cooking methods, flavour profiles, or preparation styles — while still respecting every rule below.

INGREDIENT RULES (non-negotiable, apply to ALL three variations):
- Use EVERY ingredient in the provided list. Do not omit, substitute, or merge any item.
- Use the EXACT quantity specified for each ingredient — verbatim, no rounding, no scaling.
- If two vegetables are listed (Vegetable 1 AND Vegetable 2), BOTH must appear in the RECIPE list with their own gram amounts AND each must have at least one dedicated preparation step in the METHOD.
- The Metabolic Balance protocol is a nutritional prescription — every gram is calculated for this client's macro/micronutrient needs.
- Phase rules for THIS client: ${oilAllowed ? (oil && oil !== "none" ? `the client HAS CONFIRMED ${oil} for this meal (up to 1 tablespoon / 15ml). Treat the oil as a CONFIRMED, REQUIRED ingredient — not optional. Include it in the RECIPE list as "Oil: ${oil} — up to 1 tablespoon (15ml)". Add a clear METHOD step using DIRECT, IMPERATIVE language stating the exact amount. DO NOT use conditional language like "if using", "if you choose to", "optionally", "you can", or "you may" anywhere in connection with the oil.` : "the client has chosen NOT to include oil for this meal. Do NOT mention oil anywhere — not in the recipe, not in the method, not in the notes. Use water, broth, or dry-pan techniques only.") : "absolutely NO oil of any kind. Do not add oil. Use water, broth, or dry-pan techniques only."}
- Always prepare the protein first.

SEASONING RULES (apply to ALL three variations — recipes MUST taste good):
- Every recipe MUST include appropriate seasonings, fresh or dried herbs, and spices that complement the protein and vegetables. Bland recipes are not acceptable.
- Add seasonings to the RECIPE ingredients list with specific quantities (e.g. "Sea salt — 1/4 tsp", "Freshly ground black pepper — 1/8 tsp", "Fresh parsley — 1 tbsp chopped", "Sweet paprika — 1/2 tsp", "Dried thyme — 1/2 tsp", "Fresh lemon juice — 1 tsp", "Garlic — 1 clove minced", "Fresh ginger — 1 tsp grated").
- Add explicit METHOD steps describing when and how to apply each seasoning (e.g. season the protein before cooking, add aromatics at the right moment, finish with fresh herbs).
- Vary the herb/spice profile across the three variations so each tastes distinct (e.g. Mediterranean, North African, Asian-inspired) while still respecting MB rules.
- MB-COMPLIANT ONLY. Allowed: sea salt, black/white pepper, fresh and dried herbs (parsley, basil, thyme, oregano, rosemary, dill, mint, coriander/cilantro, chives, sage, bay leaf), spices (paprika, cumin, coriander seed, turmeric, cinnamon, nutmeg, cardamom, caraway, fennel seed, mustard powder, chili flakes, cayenne), fresh garlic, fresh ginger, fresh chili, lemon/lime juice and zest, apple cider vinegar, white wine vinegar.
- STRICTLY FORBIDDEN: sugar, honey, maple syrup, agave or any sweetener; soy sauce, tamari, fish sauce, oyster sauce, Worcestershire, ketchup, mustard pastes, mayonnaise, stock cubes, bouillon powder, ready-made spice blends with additives, balsamic vinegar, wine, or any processed/bottled sauce or marinade. Do not mention these anywhere.

METHOD RULES (write for someone who has never turned on a stove):
- Number each step. Keep each step to one clear action.
- Include exact temperatures in BOTH °C and °F.
- Include exact timings, visual cues, smell cues, equipment, prep instructions, beginner mistakes to avoid, and safety basics where relevant.
- If two vegetables are used, give each its own clearly labelled prep + cook step.

OUTPUT: Call the provided tool with an array of EXACTLY THREE distinct options. Each option has RECIPE (every ingredient with exact quantity), METHOD (numbered beginner-friendly steps), NOTES (3-5 MB compliance reminders).`;

    const userPrompt = `Client phase: ${phaseDescriptor}\nMeal: ${meal_type} — ${option_label}\nIngredients (use exactly):\n${ingredientList}\n\nReturn three distinct recipe variations.`;

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
            name: "return_mb_recipes",
            description: "Return three distinct MB recipe variations.",
            parameters: {
              type: "object",
              properties: {
                options: {
                  type: "array",
                  minItems: 3,
                  maxItems: 3,
                  items: {
                    type: "object",
                    properties: {
                      recipe_title: { type: "string" },
                      recipe: { type: "array", items: { type: "string" } },
                      method: { type: "array", items: { type: "string" } },
                      notes: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 5 },
                    },
                    required: ["recipe_title", "recipe", "method", "notes"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["options"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "return_mb_recipes" } },
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
    if (!args?.options || !Array.isArray(args.options) || args.options.length < 1) throw new Error("No recipes returned");

    // Return options without persisting — the client confirms via "I Ate This" which calls log-mb-meal.
    return new Response(JSON.stringify({ ok: true, options: args.options.slice(0, 3) }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("generate-mb-recipe error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
