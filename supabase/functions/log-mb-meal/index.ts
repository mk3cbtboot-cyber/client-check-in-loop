import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { capTallyFor, foldLedger, weekWindowFor } from "../_shared/mb-cap.ts";


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

// Generic "does this ingredient match a limited food key?" test.
// Plural/singular tolerant; matches whole word.
function ingredientMatchesKey(label: string, key: string): boolean {
  const stem = key.toLowerCase().replace(/s$/, "");
  if (!stem) return false;
  return new RegExp(`\\b${stem}s?\\b`, "i").test(label);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "Invalid input" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { token, meal_type, option_label, ingredients, recipe, variant } = parsed.data;

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: c } = await admin.from("clients").select("*").eq("magic_token", token).maybeSingle();
    if (!c) return new Response(JSON.stringify({ error: "Invalid link" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const foodLimits = (c.food_limits ?? {}) as Record<string, number>;

    // For each limited food key, count how many times this meal would use it.
    // Default: +1 per meal if any ingredient label matches the key. Eggs are
    // counted by the number of eggs in the recipe (parsed from the recipe text).
    const eggsInMeal = countEggsInRecipe(recipe.recipe ?? [], ingredients);
    const usesByKey: Record<string, number> = {};
    for (const key of Object.keys(foodLimits)) {
      if (!Number(foodLimits[key])) continue;
      if (key.toLowerCase() === "eggs" || key.toLowerCase() === "egg") {
        if (eggsInMeal > 0) usesByKey[key] = eggsInMeal;
        continue;
      }
      const hit = ingredients.some((i) => ingredientMatchesKey(i.label, key));
      if (hit) usesByKey[key] = 1;
    }

    // ---- Weekly usage comes from the ledger (Phase 4) ----------------
    // committed = planned + eaten in the current cap window, minus any row
    // this same slot already planned for that food (the client's own plan must
    // not block them from logging the meal they committed to).
    const logDayIso = new Date().toISOString().slice(0, 10);
    const capAnchor = (c.phase2_strict_started_at as string | null)?.slice(0, 10) ?? null;
    const capWindow = weekWindowFor(capAnchor, logDayIso);
    const { data: capRowsRaw } = await admin
      .from("mb_cap_ledger")
      .select("day, meal, food, qty, status")
      .eq("client_id", c.id)
      .eq("week_start", capWindow.week_start);
    const capRows = (capRowsRaw ?? []) as Array<{ day: string; meal: string; food: string; qty: number; status: string }>;
    const capFold = foldLedger(capRows);
    const slotPlanned = foldLedger(
      capRows.filter((r) => r.day === logDayIso && r.meal === meal_type && r.status === "planned"),
    );
    /** Weekly usage that should count against a new log in this slot. */
    const ledgerUsed = (food: string): number =>
      Math.max(0, capTallyFor(food, capFold).committed - capTallyFor(food, slotPlanned).committed);

    // Every weekly cap is a HARD limit — eggs included. Selection-time gates
    // should have prevented this; this is defence-in-depth.
    for (const [key, uses] of Object.entries(usesByKey)) {
      const max = Number(foodLimits[key]);
      const used = ledgerUsed(key);
      if (used + uses > max) {
        return new Response(JSON.stringify({
          error: `You've reached your weekly limit for ${key}. Please choose a different option.`,
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    const eggsMax = Number(foodLimits.eggs ?? foodLimits.egg ?? 0) || null;
    let eggsUsedThisWeek = ledgerUsed(foodLimits.eggs != null ? "eggs" : "egg");


    const { data: insertedRecipe, error: insErr } = await admin.from("recipes").insert({
      client_id: c.id,
      name: recipe.recipe_title || option_label,
      meal_type,
      ingredients: recipe.recipe ?? [],
      instructions: recipe.method ?? [],
      prep_time: "",
      servings: "1",
      egg_count: eggsInMeal,
    }).select("id").single();
    if (insErr) throw insErr;

    // ---- Ledger annotation (Phase 5: the only consumption store) ----
    // Planned rows for today's slot get flipped to 'eaten' with the real logged
    // qty (set, never add — re-logging the same meal can't double-count).
    // Capped foods with no planned row insert an 'eaten'/'log' row instead.
    try {
      const todayIsoLedger = logDayIso;
      const week_start = capWindow.week_start;
      const recipeId = (insertedRecipe as { id: string } | null)?.id ?? null;

      // All rows for today's slot, planned first — matching an already-eaten
      // row (a re-log of the same meal) updates it instead of adding a second
      // debit for the same food.
      const { data: slotRows } = await admin
        .from("mb_cap_ledger")
        .select("id, food, qty, status")
        .eq("client_id", c.id)
        .eq("day", todayIsoLedger)
        .eq("meal", meal_type)
        .in("status", ["planned", "eaten"]);

      const nrm = (s: string) => String(s ?? "").trim().toLowerCase();
      const available = [...((slotRows ?? []) as Array<{ id: string; food: string; qty: number; status: string }>)]
        .sort((a, b) => (a.status === "planned" ? -1 : 0) - (b.status === "planned" ? -1 : 0));


      for (const [key, uses] of Object.entries(usesByKey)) {
        const k = nrm(key);
        let idx = available.findIndex((r) => nrm(r.food) === k);
        if (idx < 0) {
          idx = available.findIndex((r) => {
            const f = nrm(r.food);
            return f.includes(k) || k.includes(f);
          });
        }
        if (idx >= 0) {
          const row = available.splice(idx, 1)[0];
          const patch: Record<string, unknown> = {
            status: "eaten",
            logged_at: new Date().toISOString(),
            recipe_id: recipeId,
          };
          if (Number(row.qty) !== Number(uses)) patch.qty = uses;
          await admin.from("mb_cap_ledger").update(patch).eq("id", row.id);
          continue;
        }
        // Unplanned capped food — insert; on unique-key conflict update instead.
        const { error: ledInsErr } = await admin.from("mb_cap_ledger").insert({
          client_id: c.id,
          week_start,
          day: todayIsoLedger,
          meal: meal_type,
          food: key,
          qty: uses,
          status: "eaten",
          source: "log",
          logged_at: new Date().toISOString(),
          recipe_id: recipeId,
        });
        if (ledInsErr) {
          await admin
            .from("mb_cap_ledger")
            .update({ qty: uses, status: "eaten", logged_at: new Date().toISOString(), recipe_id: recipeId })
            .eq("client_id", c.id)
            .eq("day", todayIsoLedger)
            .eq("meal", meal_type)
            .eq("food", key);
        }
      }
    } catch (ledgerErr) {
      console.error("log-mb-meal ledger sync failed:", ledgerErr);
    }


    // Phase 5: the ledger is the only consumption store; food_limit_counts is no
    // longer written. Weekly committed eggs now include this meal.
    eggsUsedThisWeek = eggsUsedThisWeek + eggsInMeal;

    await admin.from("clients").update({
      meal_streak: (c.meal_streak ?? 0) + 1,
    }).eq("id", c.id);

    // Lock the recipe to this slot for the batch cooking window, and bump the primary log counter.
    let updatedPlan: unknown = null;
    const batchMode = (c.batch_cooking_mode ?? "3-day") as "3-day" | "off";
    if (variant && batchMode !== "off") {
      const today = new Date();
      const todayIso = today.toISOString().slice(0, 10);
      const monday = mondayOf(today).toISOString().slice(0, 10);
      const suffix = variant === "alt" ? "_alt" : "";
      const recipeCol = `${meal_type}_locked_recipe${suffix}`;
      const batchCol = `${meal_type}_batch_start_date${suffix}`;
      const countCol = `${meal_type}_primary_log_count`;

      const { data: planRow } = await admin
        .from("weekly_meal_plans")
        .select("*")
        .eq("client_id", c.id)
        .eq("week_start_date", monday)
        .maybeSingle();

      const batchActive = (start: string | null | undefined): boolean => {
        if (!start) return false;
        const s = new Date(start + "T00:00:00Z").getTime();
        const t = new Date(todayIso + "T00:00:00Z").getTime();
        const days = Math.floor((t - s) / 86_400_000);
        return days >= 0 && days < 3;
      };

      if (planRow) {
        const patch: Record<string, unknown> = {};
        const planRec = planRow as Record<string, unknown>;
        const hasActiveLock = planRec[recipeCol] != null && batchActive(planRec[batchCol] as string | null);
        if (!hasActiveLock) {
          patch[recipeCol] = recipe;
          patch[batchCol] = todayIso;
        }
        if (variant === "primary") {
          patch[countCol] = (Number(planRec[countCol]) || 0) + 1;
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
      } else {
        const insertRow: Record<string, unknown> = {
          client_id: c.id,
          week_start_date: monday,
          [recipeCol]: recipe,
          [batchCol]: todayIso,
        };
        if (variant === "primary") insertRow[countCol] = 1;
        const { data: created } = await admin
          .from("weekly_meal_plans")
          .upsert(insertRow, { onConflict: "client_id,week_start_date" })
          .select()
          .single();
        updatedPlan = created;
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      eggs_in_meal: eggsInMeal,
      eggs_used_this_week: eggsUsedThisWeek,
      eggs_max_per_week: eggsMax,
      plan: updatedPlan,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("log-mb-meal error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
