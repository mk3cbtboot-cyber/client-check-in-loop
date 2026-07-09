import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SLOT_KEYS = ["breakfast", "morning_snack", "lunch", "afternoon_snack", "dinner"] as const;

const Body = z.object({
  token: z.string().min(10).max(200),
  slot_key: z.enum(SLOT_KEYS),
});

const SLOT_LABELS: Record<(typeof SLOT_KEYS)[number], string> = {
  breakfast: "Breakfast",
  morning_snack: "Morning Snack",
  lunch: "Lunch",
  afternoon_snack: "Afternoon Snack",
  dinner: "Dinner",
};

interface FoodItem {
  name: string;
  portion: string;
  category: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "Invalid input" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { token, slot_key } = parsed.data;

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: c } = await admin.from("clients").select("*").eq("magic_token", token).maybeSingle();
    if (!c) return new Response(JSON.stringify({ error: "Invalid link" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const list = (c.food_list ?? {}) as Record<string, FoodItem[]>;
    const notesAll = (c.food_list_notes ?? {}) as Record<string, string>;
    const foods = Array.isArray(list[slot_key]) ? list[slot_key] : [];
    const slotNote = typeof notesAll[slot_key] === "string" ? notesAll[slot_key] : "";

    if (foods.length === 0) {
      return new Response(JSON.stringify({ error: "No foods set for this slot." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const slotLabel = SLOT_LABELS[slot_key];
    const ingredientList = foods
      .map((f) => `- ${f.name}${f.portion ? `: ${f.portion}` : ""}${f.category ? ` (${f.category})` : ""}`)
      .join("\n");

    const systemPrompt = `You write practical, whole-food recipes for COMPLETE BEGINNERS who have never cooked from scratch before and have no prior knife skills. You will receive a fixed list of approved foods with portions for one meal slot. You must:

- Use ONLY the approved foods listed for this meal slot. Do not introduce other proteins, carbs, vegetables, fats, dairy, or fruit beyond what is provided.
- Respect the portions provided exactly — do not scale, round, or omit them.
- You MAY add herbs, dried/fresh spices, sea salt, black pepper, garlic, ginger, fresh chili, lemon/lime juice, vinegar, and water. Use seasoning generously so the recipes taste good.
- ABSOLUTELY DO NOT add any oil, butter, ghee, coconut oil, olive oil, avocado oil, cooking spray, tallow, lard, or ANY other fat/cooking-fat — measured OR "as needed" OR "for the pan" — unless that specific fat appears in the approved foods list above. This applies to all three options equally. If no fat is listed, cook using dry-heat methods (non-stick pan with water/broth splash, oven-bake, grill, steam, poach, air-fry) and say so explicitly in the method.
- Use the practitioner's slot notes (if any) as additional instruction context.
- Vary the three options meaningfully — different cooking methods, flavour profiles, or preparation styles.

METHOD RULES (write for someone who has never turned on a stove):
- Number each step. One clear action per step (prep, cook, assemble, or plate).
- NEVER present ingredients as pre-prepped. Do not write "thinly sliced chicken", "diced onion", or "minced garlic" as if it's already done. For EVERY raw ingredient that needs prep before cooking (cutting, cubing, dicing, slicing, mincing, trimming, peeling, deveining, deseeding, checking produce for damage, rinsing, patting dry, etc.), add an explicit beginner-level step describing exactly how to do it — where to place it on the board, how to hold it safely, knife angle, target size, and what to discard. Examples: "Place the chicken breast flat on a cutting board. Using a sharp knife, slice it lengthways into strips about 1 cm wide, then cut across the strips to make bite-sized pieces.", "Hold the garlic clove flat under the side of your knife and press down firmly to loosen the skin, peel it off, then finely chop by rocking the knife back and forth until the pieces are the size of small grains.", "Stand the bell pepper upright, slice down each of the four sides to remove the flesh from the core, discard the core and seeds, then lay the pieces skin-side down and cut into 1 cm strips."
- Include produce checks (inspect for bruising/damage, rinse under cold water, pat dry) where relevant.
- Include exact temperatures in BOTH °C and °F, exact timings, visual cues, smell cues, equipment (non-stick pan, cast iron, sheet pan, tongs, spatula), heat level (low/medium/medium-high/high), pan temperature checks (e.g. water droplet test), doneness cues (internal temperature, colour, firmness), resting time, and basic safety (raw-meat board separation, hand washing).
- Include seasoning inline within the numbered steps — not a separate section.
- Write in plain, direct language — second person, active voice ("Heat a pan over medium-high heat.", not "The pan should be heated.").
- Aim for 8–14 steps for a main meal, 4–7 for a snack — extra steps come from spelling out prep.

OUTPUT: Call the provided tool with EXACTLY THREE distinct options. Each option has RECIPE (every approved food with its exact portion, plus seasonings), METHOD (numbered beginner-friendly steps as described above), and NOTES (3-5 short cooking or substitution-friendly tips).`;

    const userPrompt = `Meal slot: ${slotLabel}\nApproved foods (use exactly):\n${ingredientList}\n\nPractitioner notes for this slot: ${slotNote || "(none)"}\n\nReturn three distinct recipe variations using only these foods.`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "return_recipes",
            description: "Return three distinct recipe variations.",
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
        tool_choice: { type: "function", function: { name: "return_recipes" } },
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

    return new Response(JSON.stringify({ ok: true, options: args.options.slice(0, 3) }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("generate-foodlist-recipe error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
