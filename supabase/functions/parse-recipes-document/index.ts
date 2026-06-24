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
});

const SLOTS = ["breakfast", "morning_snack", "lunch", "afternoon_snack", "dinner", "any"] as const;

const SYSTEM_PROMPT = `This document contains nutrition recipes. Extract every recipe you can find. For each recipe extract: the recipe name, the list of ingredients (each as a food name plus an amount/portion string), the method (preparation steps as plain text — combine numbered steps with line breaks), and the meal slot it belongs to (one of: breakfast, morning_snack, lunch, afternoon_snack, dinner, any — use "any" if the slot isn't clear from the document). Only include recipes that are clearly present. Do not invent recipes. Return the result as structured JSON.`;

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
            required: ["name", "meal_slot", "method", "ingredients"],
            additionalProperties: false,
          },
        },
      },
      required: ["recipes"],
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
    const { filename, mime, data_base64 } = parsed.data;
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
      userContent = [{ type: "text", text: `${SYSTEM_PROMPT}\n\nDocument text:\n\n${text}` }];
    } else {
      const cleanB64 = data_base64.replace(/^data:[^;]+;base64,/, "");
      userContent = [
        { type: "text", text: SYSTEM_PROMPT },
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
      .map((r: { name: string; meal_slot?: string; method?: string; ingredients?: Array<{ food?: string; amount?: string }> }) => ({
        name: String(r.name).trim(),
        meal_slot: (SLOTS as readonly string[]).includes(String(r.meal_slot)) ? String(r.meal_slot) : "any",
        method: String(r.method ?? "").trim(),
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
