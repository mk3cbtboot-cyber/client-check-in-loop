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
  force: z.boolean().optional(),
  variant: z.enum(["primary", "alt"]).optional(),
});

function eggsFromString(s: string): number {
  if (!s || !/egg/i.test(s)) return 0;
  let m = s.match(/(\d+)\s+(?:large|medium|small|extra[\s-]?large|whole|free[\s-]?range|organic)?\s*eggs?\b/i);
  if (m) return parseInt(m[1], 10);
  m = s.match(/eggs?\b[^0-9]{0,20}(\d+)/i);
  if (m) return parseInt(m[1], 10);
  m = s.match(/^\s*(\d+)/);
  if (m && /egg/i.test(s)) return parseInt(m[1], 10);
  return 0;
}

function countEggsInRecipe(recipeLines: string[], ingredients: Array<{ label: string; qty: string }>): number {
  let total = 0;
  for (const line of recipeLines ?? []) total += eggsFromString(line);
  if (total > 0) return total;
  // Fallback to MB ingredient list
  for (const it of ingredients ?? []) {
    const s = `${it.qty} ${it.label}`;
    if (/egg/i.test(s)) total += eggsFromString(s);
  }
  return total;
}

function mondayOf(d: Date): Date {
  const dt = new Date(d);
  const day = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - day);
  dt.setUTCHours(0, 0, 0, 0);
  return dt;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "Invalid input" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { token, meal_type, option_label, ingredients, recipe, force, variant } = parsed.data;

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: c } = await admin.from("clients").select("*").eq("magic_token", token).maybeSingle();
    if (!c) return new Response(JSON.stringify({ error: "Invalid link" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Counter logic, mirrors the original generate flow.
    const avocadoUses = ingredients.filter((i) => /avocado/i.test(i.label)).length;
    if ((c.avocado_count_week ?? 0) + avocadoUses > 3) {
      return new Response(JSON.stringify({ error: "Avocado limit (3/week) reached." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Egg counting — parse the actual recipe and enforce against the client's MB plan limit.
    const eggsInMeal = countEggsInRecipe(recipe.recipe ?? [], ingredients);
    const eggsMax = (c.eggs_max_per_week ?? null) as number | null;

    // Sum eggs already logged this calendar week (Mon..Sun, UTC).
    let eggsUsedThisWeek = 0;
    if (eggsMax != null && eggsMax > 0) {
      const monday = mondayOf(new Date());
      const nextMonday = new Date(monday);
      nextMonday.setUTCDate(nextMonday.getUTCDate() + 7);
      const { data: weekRows } = await admin
        .from("recipes")
        .select("egg_count, created_at")
        .eq("client_id", c.id)
        .gte("created_at", monday.toISOString())
        .lt("created_at", nextMonday.toISOString());
      eggsUsedThisWeek = (weekRows ?? []).reduce((s: number, r: { egg_count?: number }) => s + (Number(r.egg_count) || 0), 0);

      if (!force && eggsInMeal > 0 && eggsUsedThisWeek + eggsInMeal > eggsMax) {
        return new Response(JSON.stringify({
          requires_confirmation: true,
          reason: "eggs_over_limit",
          eggs_in_meal: eggsInMeal,
          eggs_used_this_week: eggsUsedThisWeek,
          eggs_max_per_week: eggsMax,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    const { error: insErr } = await admin.from("recipes").insert({
      client_id: c.id,
      name: recipe.recipe_title || option_label,
      meal_type,
      ingredients: recipe.recipe ?? [],
      instructions: recipe.method ?? [],
      prep_time: "",
      servings: "1",
      egg_count: eggsInMeal,
    });
    if (insErr) throw insErr;

    await admin.from("clients").update({
      avocado_count_week: (c.avocado_count_week ?? 0) + avocadoUses,
      egg_count_week: (c.egg_count_week ?? 0) + eggsInMeal,
      meal_streak: (c.meal_streak ?? 0) + 1,
    }).eq("id", c.id);

    // Lock the recipe to this week's plan slot, and bump the primary log counter.
    let updatedPlan: any = null;
    if (variant) {
      const monday = mondayOf(new Date()).toISOString().slice(0, 10);
      const { data: planRow } = await admin
        .from("weekly_meal_plans")
        .select("*")
        .eq("client_id", c.id)
        .eq("week_start_date", monday)
        .maybeSingle();
      if (planRow) {
        const suffix = variant === "alt" ? "_alt" : "";
        const recipeCol = `${meal_type}_locked_recipe${suffix}`;
        const countCol = `${meal_type}_primary_log_count`;
        const patch: Record<string, unknown> = {};
        if (planRow[recipeCol] == null) patch[recipeCol] = recipe;
        if (variant === "primary") {
          patch[countCol] = (Number(planRow[countCol]) || 0) + 1;
        }
        if (Object.keys(patch).length) {
          const { data: saved } = await admin
            .from("weekly_meal_plans")
            .update(patch)
            .eq("id", planRow.id)
            .select()
            .single();
          updatedPlan = saved;
        } else {
          updatedPlan = planRow;
        }
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      eggs_in_meal: eggsInMeal,
      eggs_used_this_week: eggsUsedThisWeek + eggsInMeal,
      eggs_max_per_week: eggsMax,
      plan: updatedPlan,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("log-mb-meal error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
