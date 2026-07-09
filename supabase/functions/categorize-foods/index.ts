import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const Body = z.object({
  foods: z.array(z.string().min(1).max(100)).min(1).max(50),
});

const CATEGORIES = [
  "fish", "seafood", "poultry", "meat", "cheese", "legumes",
  "yogurt", "milkProducts", "vegetables", "vegLettuce", "fruit",
  "bread", "starch",
] as const;

const CATEGORY_GUIDE = `
- fish: finned fish (salmon, trout, cod, tuna, sea bass, sardines, mackerel, etc.)
- seafood: shellfish & molluscs (shrimp, prawns, clams, mussels, squid, octopus, scallops, crab, lobster)
- poultry: chicken, turkey, duck, goose
- meat: red meat & game (beef, lamb, pork, veal, venison, rabbit, ham, steak, bison)
- cheese: all cheeses (feta, mozzarella, ricotta, paneer, cottage cheese, cheddar, etc.)
- legumes: beans, lentils, chickpeas, peas, pulses, tofu, tempeh
- yogurt: yogurt and yoghurt-based products
- milkProducts: milk, kefir, buttermilk
- vegetables: cooked or raw veg that is not lettuce (carrots, broccoli, peppers, courgette, sweet potato, white potato, mushrooms, onion, squash, etc.)
- vegLettuce: salad leaves & raw salad veg (lettuce, rocket, cucumber, spinach leaves, radicchio)
- fruit: all fresh & dried fruit (berries, apple, pear, mango, banana, etc.)
- bread: breads, crackers, crispbreads, wraps, tortillas
- starch: grains, oats, rice, quinoa, pasta, buckwheat, millet, barley, couscous
`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "Invalid input" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { foods } = parsed.data;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3.5-flash",
        messages: [
          { role: "system", content: `You categorise food ingredients into a fixed set of recipe-builder categories. Use ONLY these category keys: ${CATEGORIES.join(", ")}.\n\nGuide:\n${CATEGORY_GUIDE}\n\nFor every food provided, return its single best category key. If a food does not clearly fit any category, choose the closest one (never invent new keys).` },
          { role: "user", content: `Categorise these foods:\n${foods.map((f) => `- ${f}`).join("\n")}` },
        ],
        tools: [{
          type: "function",
          function: {
            name: "return_categories",
            description: "Return a category for each food.",
            parameters: {
              type: "object",
              properties: {
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      food: { type: "string" },
                      category: { type: "string", enum: [...CATEGORIES] },
                    },
                    required: ["food", "category"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["items"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "return_categories" } },
      }),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429) return new Response(JSON.stringify({ error: "Rate limit" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (aiResp.status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const t = await aiResp.text();
      console.error("AI error", aiResp.status, t);
      throw new Error("AI categorisation failed");
    }

    const data = await aiResp.json();
    const tc = data.choices?.[0]?.message?.tool_calls?.[0];
    const args = tc ? JSON.parse(tc.function.arguments) : null;
    if (!args?.items) throw new Error("No categorisation returned");

    const map: Record<string, string> = {};
    for (const it of args.items) {
      if (typeof it.food === "string" && typeof it.category === "string") {
        map[it.food] = it.category;
      }
    }
    return new Response(JSON.stringify({ ok: true, map }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("categorize-foods error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
