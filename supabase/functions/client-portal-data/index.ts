import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const Body = z.object({ token: z.string().min(10).max(200) });

function mondayOf(d: Date): string {
  const dt = new Date(d);
  const day = (dt.getUTCDay() + 6) % 7; // 0=Mon
  dt.setUTCDate(dt.getUTCDate() - day);
  return dt.toISOString().slice(0, 10);
}
const today = () => new Date().toISOString().slice(0, 10);

function normalizeGender(value: unknown): "female" | "male" | "unspecified" | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "female" || normalized === "male" || normalized === "unspecified") {
    return normalized;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return new Response(JSON.stringify({ valid: false }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: c } = await admin.from("clients").select("*").eq("magic_token", parsed.data.token).maybeSingle();
    if (!c) return new Response(JSON.stringify({ valid: false }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (c.archived_at) return new Response(JSON.stringify({ valid: false, archived: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Practitioner first name for portal display
    let practitionerFirstName = "your practitioner";
    if (c.practitioner_id) {
      const { data: prof } = await admin
        .from("profiles")
        .select("email, display_name")
        .eq("id", c.practitioner_id)
        .maybeSingle();
      const fromName = (prof?.display_name ?? "").trim().split(/\s+/)[0];
      const fromEmail = (() => {
        const local = (prof?.email ?? "").split("@")[0] ?? "";
        const letters = local.replace(/[^A-Za-z]/g, "");
        return letters ? letters.charAt(0).toUpperCase() + letters.slice(1).toLowerCase() : "";
      })();
      practitionerFirstName = fromName || fromEmail || practitionerFirstName;
    }

    const updates: Record<string, unknown> = {};
    const monday = mondayOf(new Date());
    if (c.week_reset_date !== monday) {
      updates.week_reset_date = monday;
      updates.food_limit_counts = {};
    }
    const td = today();
    if (c.water_date !== td) {
      updates.water_date = td;
      updates.water_today_litres = 0;
    }
    if (Object.keys(updates).length) {
      await admin.from("clients").update(updates).eq("id", c.id);
      Object.assign(c, updates);
    }

    const { data: latestCheckIn } = await admin
      .from("check_ins")
      .select("weight_kg")
      .eq("client_id", c.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Sync today's water into daily_water_logs and compute streak
    const WATER_TARGET = 2.5;
    const todayLitres = c.water_date === td ? Number(c.water_today_litres) : 0;
    if (c.water_date === td) {
      await admin.from("daily_water_logs").upsert({
        client_id: c.id, log_date: td, litres: todayLitres, updated_at: new Date().toISOString(),
      }, { onConflict: "client_id,log_date" });
    }
    const { data: waterRows } = await admin
      .from("daily_water_logs")
      .select("log_date, litres")
      .eq("client_id", c.id)
      .order("log_date", { ascending: false })
      .limit(400);
    const wmap = new Map((waterRows ?? []).map((r: { log_date: string; litres: number }) => [r.log_date, Number(r.litres)]));
    let waterStreak = 0;
    const d = new Date(td + "T00:00:00Z");
    if ((wmap.get(td) ?? 0) >= WATER_TARGET) waterStreak += 1;
    d.setUTCDate(d.getUTCDate() - 1);
    while (true) {
      const k = d.toISOString().slice(0, 10);
      if ((wmap.get(k) ?? 0) >= WATER_TARGET) { waterStreak += 1; d.setUTCDate(d.getUTCDate() - 1); }
      else break;
    }

    // Phase 4 — upcoming scheduled appointments (used to gate the check-in window)
    let phase4Appointments: Array<{ id: string; title: string; scheduled_at: string; status: string | null }> = [];
    if (c.phase === "phase4") {
      const { data: appts } = await admin
        .from("appointments")
        .select("id, title, scheduled_at, status")
        .eq("client_id", c.id)
        .order("scheduled_at", { ascending: true });
      phase4Appointments = (appts ?? []) as typeof phase4Appointments;
    }

    return new Response(JSON.stringify({
      valid: true,
      client: {
        id: c.id, name: c.name, phase: c.phase,
        food_limits: c.food_limits ?? {},
        food_limit_counts: c.food_limit_counts ?? {},
        water_today_litres: Number(c.water_today_litres), meal_streak: c.meal_streak,
        water_streak: waterStreak,
        mb_pdf_path: c.mb_pdf_path ?? null,
        phase3_additional_foods: c.phase3_additional_foods ?? "",
        phase3_meat: c.phase3_meat ?? "",
        phase3_fish: c.phase3_fish ?? "",
        phase3_vegetables: c.phase3_vegetables ?? "",
        phase3_fruit: c.phase3_fruit ?? "",
        phase3_starches: c.phase3_starches ?? "",
        phase3_bread: c.phase3_bread ?? "",
        phase3_dairy: c.phase3_dairy ?? "",
        phase3_other: c.phase3_other ?? "",
        phase3_mode: c.phase3_mode === "mb_standard" ? "mb_standard" : "practitioner_custom",
        phase3_mb_fish: c.phase3_mb_fish ?? "",
        phase3_mb_seafood: c.phase3_mb_seafood ?? "",
        phase3_mb_meat: c.phase3_mb_meat ?? "",
        phase3_mb_cheese: c.phase3_mb_cheese ?? "",
        phase3_mb_legumes: c.phase3_mb_legumes ?? "",
        phase3_mb_vegetables: c.phase3_mb_vegetables ?? "",
        phase3_mb_veg_lettuce: c.phase3_mb_veg_lettuce ?? "",
        phase3_mb_sprouts: c.phase3_mb_sprouts ?? "",
        phase3_mb_fat_oil: c.phase3_mb_fat_oil ?? "",
        show_8_rules: c.show_8_rules === true,
        weight_unit: c.weight_unit === "lbs" ? "lbs" : "kg",
        length_unit: c.length_unit === "in" ? "in" : "cm",
        height_cm: c.height_cm != null ? Number(c.height_cm) : null,
        phase2_strict_started_at: c.phase2_strict_started_at ?? null,
        phase2_strict_mode: c.phase2_strict_mode === "practitioner_custom" ? "practitioner_custom" : "mb_standard",
        phase2_food_list: c.phase2_food_list ?? null,
        food_fish: c.food_fish ?? "",
        food_seafood: c.food_seafood ?? "",
        food_milk_products: c.food_milk_products ?? "",
        food_yogurt: c.food_yogurt ?? "",
        food_nuts: c.food_nuts ?? "",
        food_meat: c.food_meat ?? "",
        food_poultry: c.food_poultry ?? "",
        food_cheese: c.food_cheese ?? "",
        food_legumes: c.food_legumes ?? "",
        food_pumpkin_seeds: c.food_pumpkin_seeds ?? "",
        food_sunflower_seeds: c.food_sunflower_seeds ?? "",
        food_vegetables: c.food_vegetables ?? "",
        food_veg_lettuce: c.food_veg_lettuce ?? "",
        food_starch: c.food_starch ?? "",
        food_bread: c.food_bread ?? "",
        food_fruit: c.food_fruit ?? "",
        latest_weight_kg: latestCheckIn?.weight_kg != null ? Number(latestCheckIn.weight_kg) : null,
        system_mode: c.system_mode === "own_practice" ? "own_practice" : "mb",
        gender: normalizeGender(c.gender),
        batch_cooking_mode: c.batch_cooking_mode === "off" ? "off" : "3-day",
        welcome_seen: c.welcome_seen === true,
        practitioner_first_name: practitionerFirstName,
        phase4_start_date: c.phase4_start_date ?? null,
        phase4_appointments: phase4Appointments,
        phase3_lunch_protein_bonus: Number(c.phase3_lunch_protein_bonus ?? 0),
        phase3_lunch_carb_bonus: Number(c.phase3_lunch_carb_bonus ?? 0),
        phase3_portions_confirmed: c.phase3_portions_confirmed === true,
        phase3_lunch_prompt_last_dismissed_on: c.phase3_lunch_prompt_last_dismissed_on ?? null,
        client_type: c.client_type === "custom" ? "custom" : "mb",
        plan_format: typeof c.plan_format === "string" ? c.plan_format : "recipe",
        food_list: c.food_list ?? {},
        food_list_notes: c.food_list_notes ?? {},
        meals_per_day: Number(c.meals_per_day ?? 3),
      },

    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    return new Response(JSON.stringify({ valid: false, error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
