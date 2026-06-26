import { z } from "https://esm.sh/zod@3.23.8";
import mammoth from "npm:mammoth@1.8.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const Body = z.object({
  filename: z.string().min(1).max(300),
  mime: z.string().min(1).max(200),
  data_base64: z.string().min(10),
  meals_per_day: z.union([z.literal(3), z.literal(4), z.literal(5)]).optional(),
});

const SLOTS = ["breakfast", "morning_snack", "lunch", "afternoon_snack", "dinner", "any"] as const;

function buildSystemPrompt(mealsPerDay?: number): string {
  const mappings: Record<number, string> = {
    3: `The client eats 3 meals per day. Numbered labels map to: Meal 1 = breakfast, Meal 2 = lunch, Meal 3 = dinner.`,
    4: `The client eats 4 meals per day. Numbered labels map to: Meal 1 = breakfast, Meal 2 = lunch, Meal 3 = afternoon_snack, Meal 4 = dinner.`,
    5: `The client eats 5 meals per day. Numbered labels map to: Meal 1 = breakfast, Meal 2 = morning_snack, Meal 3 = lunch, Meal 4 = afternoon_snack, Meal 5 = dinner.`,
  };
  const numberedRule = mealsPerDay && mappings[mealsPerDay]
    ? mappings[mealsPerDay]
    : `If the document uses numbered labels (Meal 1, Meal 2, …) and the client's meals-per-day is unknown, assume 5 meals: Meal 1 = breakfast, Meal 2 = morning_snack, Meal 3 = lunch, Meal 4 = afternoon_snack, Meal 5 = dinner.`;
  return `This document contains nutrition recipes. Extract every recipe you can find. For each recipe extract: the recipe name, the list of ingredients (each as a food name plus an amount/portion string), the method (preparation steps as plain text — combine numbered steps with line breaks), any free-text notes from the practitioner that accompany the recipe (e.g. "Works well for meal prep", "Substitute chicken with turkey if preferred", "Best served immediately." — empty string if there are none), and the meal slot it belongs to (one of: breakfast, morning_snack, lunch, afternoon_snack, dinner, any).

Recognise both named meal labels (Breakfast, Morning Snack, Lunch, Afternoon Snack, Dinner) and numbered meal labels (Meal 1, Meal 2, Meal 3, Meal 4, Meal 5). ${numberedRule} If the document uses neither named nor numbered labels and the slot is not clear, set meal_slot to "any".

Also extract any list of foods the client must avoid. The section may be labelled "Foods Not Included", "Foods to Avoid", "Excluded Foods", "Foods Not Included in This Plan", "Do Not Eat", or similar. Return each excluded food as a separate string in the "exclusions" array. If no such section exists, return an empty array.

Only include recipes that are clearly present. Do not invent recipes. Return the result as structured JSON.`;
}

const TOOL = {
  type: "function",
  function: {
    name: "return_recipes",
    description: "Return parsed recipes.",
    parameters: {
      type: "object",
      properties: {
        recipes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              meal_slot: { type: "string", enum: [...SLOTS] },
              method: { type: "string" },
              notes: { type: "string" },
              ingredients: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    food: { type: "string" },
                    amount: { type: "string" },
                  },
                  required: ["food", "amount"],
                  additionalProperties: false,
                },
              },
            },
            required: ["name", "meal_slot", "method", "notes", "ingredients"],
            additionalProperties: false,
          },
        },
        exclusions: { type: "array", items: { type: "string" } },
      },
      required: ["recipes", "exclusions"],
      additionalProperties: false,
    },
  },
};

function base64ToUint8Array(b64: string): Uint8Array {
  const clean = b64.replace(/^data:[^;]+;base64,/, "");
  const bin = atob(clean);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "Invalid input" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { filename, mime, data_base64, meals_per_day } = parsed.data;
    const systemPrompt = buildSystemPrompt(meals_per_day);
    const lower = filename.toLowerCase();
    const isPdf = mime.includes("pdf") || lower.endsWith(".pdf");
    const isDocx = mime.includes("officedocument.wordprocessingml") || lower.endsWith(".docx");
    if (!isPdf && !isDocx) {
      return new Response(JSON.stringify({ error: "Only .docx or .pdf files are supported." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    let userContent: unknown;
    if (isDocx) {
      const buf = base64ToUint8Array(data_base64);
      const result = await mammoth.extractRawText({ buffer: buf });
      const text = (result?.value ?? "").trim();
      if (!text) {
        return new Response(JSON.stringify({ error: "empty" }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      userContent = [{ type: "text", text: `${systemPrompt}\n\nDocument text:\n\n${text}` }];
    } else {
      const cleanB64 = data_base64.replace(/^data:[^;]+;base64,/, "");
      userContent = [
        { type: "text", text: systemPrompt },
        { type: "file", file: { filename, file_data: `data:application/pdf;base64,${cleanB64}` } },
      ];
    }

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: userContent }],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "return_recipes" } },
      }),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429) return new Response(JSON.stringify({ error: "Rate limit, please retry shortly." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (aiResp.status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const t = await aiResp.text();
      console.error("AI error", aiResp.status, t);
      throw new Error("AI parsing failed");
    }
    const data = await aiResp.json();
    const tc = data.choices?.[0]?.message?.tool_calls?.[0];
    const args = tc ? JSON.parse(tc.function.arguments) : null;
    if (!args) throw new Error("No structured output");

    const rawRecipes = Array.isArray(args.recipes) ? args.recipes : [];
    const recipes = rawRecipes
      .filter((r: { name?: string }) => r && typeof r.name === "string" && r.name.trim().length > 0)
      .map((r: { name: string; meal_slot?: string; method?: string; notes?: string; ingredients?: Array<{ food?: string; amount?: string }> }) => ({
        name: String(r.name).trim(),
        meal_slot: (SLOTS as readonly string[]).includes(String(r.meal_slot)) ? String(r.meal_slot) : "any",
        method: String(r.method ?? "").trim(),
        notes: String(r.notes ?? "").trim(),
        ingredients: Array.isArray(r.ingredients)
          ? r.ingredients
              .filter((i) => i && typeof i.food === "string" && i.food.trim().length > 0)
              .map((i) => ({ food: String(i.food).trim(), amount: String(i.amount ?? "").trim() }))
          : [],
      }));

    if (recipes.length === 0) {
      return new Response(JSON.stringify({ error: "empty" }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ ok: true, recipes }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("parse-recipes-document error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
