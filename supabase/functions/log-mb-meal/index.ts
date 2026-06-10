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
  recipe: z.object({
    recipe_title: z.string(),
    recipe: z.array(z.string()),
    method: z.array(z.string()),
    notes: z.array(z.string()),
  }),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "Invalid input" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { token, meal_type, option_label, ingredients, recipe } = parsed.data;

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: c } = await admin.from("clients").select("*").eq("magic_token", token).maybeSingle();
    if (!c) return new Response(JSON.stringify({ error: "Invalid link" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Counter logic, mirrors the original generate flow.
    const avocadoUses = ingredients.filter((i) => /avocado/i.test(i.label)).length;
    if ((c.avocado_count_week ?? 0) + avocadoUses > 3) {
      return new Response(JSON.stringify({ error: "Avocado limit (3/week) reached." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const eggsAdded = meal_type === "lunch" && /Eggs/i.test(option_label) ? 2 : 0;

    const { error: insErr } = await admin.from("recipes").insert({
      client_id: c.id,
      name: recipe.recipe_title || option_label,
      meal_type,
      ingredients: recipe.recipe ?? [],
      instructions: recipe.method ?? [],
      prep_time: "",
      servings: "1",
    });
    if (insErr) throw insErr;

    await admin.from("clients").update({
      avocado_count_week: (c.avocado_count_week ?? 0) + avocadoUses,
      egg_count_week: (c.egg_count_week ?? 0) + eggsAdded,
      meal_streak: (c.meal_streak ?? 0) + 1,
    }).eq("id", c.id);

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("log-mb-meal error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
