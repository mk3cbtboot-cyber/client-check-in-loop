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

    const systemPrompt = `You generate practical, healthy recipes for a nutrition practitioner. Return a single recipe matching the brief.

Respond ONLY with JSON of shape:
{"name": string, "default_slot": "breakfast"|"morning_snack"|"lunch"|"afternoon_snack"|"dinner"|"any", "ingredients": [{"food": string, "amount": string}], "method": string, "notes": string}

Method requirements — write detailed, step-by-step instructions for a complete beginner with no prior cooking or knife skills:
- Numbered steps separated by newlines (e.g. "1. …\\n2. …"). Each step is ONE single action — prep, cook, assemble, or plate.
- Include specific cooking details where relevant: temperatures (°C), times (minutes), pan type (non-stick, cast iron, sheet pan), heat level (low, medium, medium-high, high).
- Assume the reader has never cut, trimmed, peeled, deveined, or otherwise prepped an ingredient before. For EVERY raw ingredient that needs prep before cooking (cutting, cubing, dicing, slicing, mincing, trimming, peeling, deveining, deseeding, etc.), add an explicit beginner-level step describing exactly how to do it — where to place it on the board, how to hold it safely, knife angle, target size, and what to discard. Examples: "Place the chicken breast flat on a cutting board. Using a sharp knife, slice it lengthways into strips about 2 cm wide, then cut across the strips to make 2 cm cubes.", "Hold the garlic clove flat under the side of your knife and press down firmly to loosen the skin, peel it off, then finely chop by rocking the knife back and forth until the pieces are the size of small grains.", "Stand the bell pepper upright, slice down each of the four sides to remove the flesh from the core, discard the core and seeds, then lay the pieces skin-side down and cut into 1 cm strips."
- Include seasoning steps inline within the method — do NOT put seasoning in a separate section.
- Aim for 8–14 steps for a main meal (breakfast, lunch, dinner), or 4–7 steps for a snack — the extra steps come from spelling out prep.
- Write in plain, direct language — second person, active voice ("Heat a pan over medium-high heat.", not "The pan should be heated.").

The "notes" field is optional free text for the practitioner (e.g. "Works well for meal prep", "Substitute chicken with turkey if preferred"). Return an empty string if there are no useful notes.`;

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
      notes: String(parsed.notes ?? ""),
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
