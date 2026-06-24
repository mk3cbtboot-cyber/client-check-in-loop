import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SLOT_KEYS = ["breakfast", "morning_snack", "lunch", "afternoon_snack", "dinner"] as const;

const SLOT_TO_MEAL_TYPE: Record<(typeof SLOT_KEYS)[number], string> = {
  breakfast: "breakfast",
  morning_snack: "snack",
  lunch: "lunch",
  afternoon_snack: "snack",
  dinner: "dinner",
};

const Body = z.object({
  token: z.string().min(10).max(200),
  assignment_id: z.string().uuid(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "Invalid input" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { token, assignment_id } = parsed.data;

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: c } = await admin.from("clients").select("id, meal_streak").eq("magic_token", token).maybeSingle();
    if (!c) return new Response(JSON.stringify({ error: "Invalid link" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: a } = await admin
      .from("client_recipe_assignments")
      .select("id, recipe_id, meal_slot, portion_overrides, client_id")
      .eq("id", assignment_id)
      .eq("client_id", c.id)
      .maybeSingle();
    if (!a) return new Response(JSON.stringify({ error: "Assignment not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: r } = await admin
      .from("practitioner_recipes")
      .select("name, ingredients, method")
      .eq("id", a.recipe_id)
      .maybeSingle();
    if (!r) return new Response(JSON.stringify({ error: "Recipe not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const overrides = Array.isArray(a.portion_overrides) ? (a.portion_overrides as Array<{ food: string; amount: string }>) : [];
    const baseIngs = Array.isArray(r.ingredients) ? (r.ingredients as Array<{ food: string; amount: string }>) : [];
    const ingredientLines = baseIngs.map((i) => {
      const ov = overrides.find((o) => o.food === i.food);
      const amt = ov?.amount ?? i.amount ?? "";
      return amt ? `${i.food} — ${amt}` : i.food;
    });
    const methodLines = typeof r.method === "string"
      ? r.method.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
      : [];

    const slot = a.meal_slot as (typeof SLOT_KEYS)[number];
    const mealType = SLOT_TO_MEAL_TYPE[slot] ?? "snack";

    const { error: insErr } = await admin.from("recipes").insert({
      client_id: c.id,
      name: r.name,
      meal_type: mealType,
      ingredients: ingredientLines,
      instructions: methodLines,
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
    console.error("log-recipe-meal error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
