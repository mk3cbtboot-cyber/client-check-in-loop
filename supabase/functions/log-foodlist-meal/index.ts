import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SLOT_KEYS = ["breakfast", "morning_snack", "lunch", "afternoon_snack", "dinner"] as const;

// Maps food-list slot keys to the recipes table meal_type values.
const SLOT_TO_MEAL_TYPE: Record<(typeof SLOT_KEYS)[number], string> = {
  breakfast: "breakfast",
  morning_snack: "snack",
  lunch: "lunch",
  afternoon_snack: "snack",
  dinner: "dinner",
};

const Body = z.object({
  token: z.string().min(10).max(200),
  slot_key: z.enum(SLOT_KEYS),
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
    const { token, slot_key, recipe } = parsed.data;

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: c } = await admin.from("clients").select("*").eq("magic_token", token).maybeSingle();
    if (!c) return new Response(JSON.stringify({ error: "Invalid link" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { error: insErr } = await admin.from("recipes").insert({
      client_id: c.id,
      name: recipe.recipe_title,
      meal_type: SLOT_TO_MEAL_TYPE[slot_key],
      ingredients: recipe.recipe ?? [],
      instructions: recipe.method ?? [],
      prep_time: "",
      servings: "1",
      egg_count: 0,
    });
    if (insErr) throw insErr;

    await admin.from("clients").update({
      meal_streak: (c.meal_streak ?? 0) + 1,
    }).eq("id", c.id);

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("log-foodlist-meal error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
