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

    const systemPrompt = `You write practical, beginner-friendly whole-food recipes. You will receive a fixed list of approved foods with portions for one meal slot. You must:

- Use ONLY the approved foods listed for this meal slot. Do not introduce other proteins, carbs, vegetables, fats, dairy, or fruit beyond what is provided.
- Respect the portions provided exactly — do not scale, round, or omit them.
- You MAY add herbs, dried/fresh spices, sea salt, black pepper, garlic, ginger, fresh chili, lemon/lime juice, vinegar, and water. Use seasoning generously so the recipes taste good.
- Use the practitioner's slot notes (if any) as additional instruction context.
- Vary the three options meaningfully — different cooking methods, flavour profiles, or preparation styles.

METHOD RULES:
- Number each step. One clear action per step.
- Include exact temperatures in both °C and °F where relevant.
- Include exact timings, visual cues, equipment, and basic safety where relevant.

OUTPUT: Call the provided tool with EXACTLY THREE distinct options. Each option has RECIPE (every approved food with its exact portion, plus seasonings), METHOD (numbered beginner-friendly steps), and NOTES (3-5 short cooking or substitution-friendly tips).`;

    const userPrompt = `Meal slot: ${slotLabel}\nApproved foods (use exactly):\n${ingredientList}\n\nPractitioner notes for this slot: ${slotNote || "(none)"}\n\nReturn three distinct recipe variations using only these foods.`;

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
