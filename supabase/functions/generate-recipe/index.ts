import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SLOTS = ["breakfast", "morning_snack", "lunch", "afternoon_snack", "dinner", "any"] as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Missing LOVABLE_API_KEY" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { brief } = await req.json();
    if (!brief || typeof brief !== "string") {
      return new Response(JSON.stringify({ error: "brief required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `You generate practical, healthy recipes for a nutrition practitioner. Return a single recipe matching the brief. Respond ONLY with JSON of shape: {"name": string, "default_slot": "breakfast"|"morning_snack"|"lunch"|"afternoon_snack"|"dinner"|"any", "ingredients": [{"food": string, "amount": string}], "method": string}. The method should be plain text steps separated by newlines.`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: brief },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return new Response(JSON.stringify({ error: `AI gateway error: ${res.status}`, detail: text }), {
        status: res.status === 429 || res.status === 402 ? res.status : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content ?? "{}";
    let parsed: any;
    try {
      parsed = typeof content === "string" ? JSON.parse(content) : content;
    } catch {
      parsed = {};
    }

    const recipe = {
      name: String(parsed.name ?? "Untitled recipe"),
      default_slot: SLOTS.includes(parsed.default_slot) ? parsed.default_slot : "any",
      ingredients: Array.isArray(parsed.ingredients)
        ? parsed.ingredients
            .map((i: any) => ({ food: String(i?.food ?? ""), amount: String(i?.amount ?? "") }))
            .filter((i: any) => i.food)
        : [],
      method: String(parsed.method ?? ""),
    };

    return new Response(JSON.stringify({ recipe }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
