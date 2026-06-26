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

const SYSTEM_PROMPT = `This is a nutrition meal plan document. Extract the foods listed for each meal. For each food identify: the meal slot it belongs to (Breakfast, Morning Snack, Lunch, Afternoon Snack, or Dinner), the food name, the portion size or amount, and the food category (Protein, Carbs, Veg, Fat, or Other — use your best judgement if not specified). Return the result as structured JSON. Only include foods that are clearly listed in the document. If a slot is not mentioned, return an empty array for it.

Also extract any list of foods the client must avoid. The section may be labelled "Foods Not Included", "Foods to Avoid", "Excluded Foods", "Foods Not Included in This Plan", "Do Not Eat", or similar. Return each excluded food as a separate string in the "exclusions" array. If no such section exists, return an empty array.

In addition, identify each of the following sections by purpose (not by exact heading wording — practitioners use varied labels):
- "keys_to_success": any section containing guidelines, tips, habits, or recommendations for the client to follow their plan successfully. Return the full text content verbatim (preserve line breaks). Empty string if absent.
- "digestion_protocol": any section containing instructions, timing, or guidance specifically about digestion, eating pace, meal timing, or gut health. Return the full text content verbatim. Empty string if absent.
- "recommended_supplements": any section listing supplements, vitamins, minerals, or products the practitioner recommends. Return the full text content verbatim. Empty string if absent.
Only include content clearly serving each purpose. Do not invent or paraphrase.`;

const TOOL = {
  type: "function",
  function: {
    name: "return_food_list",
    description: "Return parsed foods grouped by meal slot.",
    parameters: {
      type: "object",
      properties: {
        breakfast: { type: "array", items: foodItemSchema() },
        morning_snack: { type: "array", items: foodItemSchema() },
        lunch: { type: "array", items: foodItemSchema() },
        afternoon_snack: { type: "array", items: foodItemSchema() },
        dinner: { type: "array", items: foodItemSchema() },
        exclusions: { type: "array", items: { type: "string" } },
        keys_to_success: { type: "string" },
        digestion_protocol: { type: "string" },
        recommended_supplements: { type: "string" },
      },
      required: ["breakfast", "morning_snack", "lunch", "afternoon_snack", "dinner", "exclusions", "keys_to_success", "digestion_protocol", "recommended_supplements"],
      additionalProperties: false,
    },
  },
};

function foodItemSchema() {
  return {
    type: "object",
    properties: {
      name: { type: "string" },
      portion: { type: "string" },
      category: { type: "string", enum: ["Protein", "Carbs", "Veg", "Fat", "Other"] },
    },
    required: ["name", "portion", "category"],
    additionalProperties: false,
  };
}

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
      userContent = [
        { type: "text", text: `${SYSTEM_PROMPT}\n\nDocument text:\n\n${text}` },
      ];
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
        tool_choice: { type: "function", function: { name: "return_food_list" } },
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

    const slots = ["breakfast", "morning_snack", "lunch", "afternoon_snack", "dinner"] as const;
    const out: Record<string, Array<{ name: string; portion: string; category: string }>> = {};
    let total = 0;
    for (const k of slots) {
      const arr = Array.isArray(args[k]) ? args[k] : [];
      out[k] = arr
        .filter((x: { name?: string }) => x && typeof x.name === "string" && x.name.trim().length > 0)
        .map((x: { name: string; portion?: string; category?: string }) => ({
          name: String(x.name).trim(),
          portion: String(x.portion ?? "").trim(),
          category: ["Protein", "Carbs", "Veg", "Fat", "Other"].includes(String(x.category)) ? String(x.category) : "Other",
        }));
      total += out[k].length;
    }

    if (total === 0) {
      return new Response(JSON.stringify({ error: "empty" }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const exclusionsRaw = Array.isArray(args.exclusions) ? args.exclusions : [];
    const exclusions = exclusionsRaw
      .map((x: unknown) => (typeof x === "string" ? x.trim() : ""))
      .filter((x: string) => x.length > 0);

    const trimOrNull = (v: unknown): string | null => {
      const s = typeof v === "string" ? v.trim() : "";
      return s.length > 0 ? s : null;
    };
    const keys_to_success = trimOrNull(args.keys_to_success);
    const digestion_protocol = trimOrNull(args.digestion_protocol);
    const recommended_supplements = trimOrNull(args.recommended_supplements);

    return new Response(JSON.stringify({ ok: true, food_list: out, exclusions, keys_to_success, digestion_protocol, recommended_supplements }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("parse-foodlist-document error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
