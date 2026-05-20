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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return new Response(JSON.stringify({ valid: false }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: c } = await admin.from("clients").select("*").eq("magic_token", parsed.data.token).maybeSingle();
    if (!c) return new Response(JSON.stringify({ valid: false }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const updates: Record<string, unknown> = {};
    const monday = mondayOf(new Date());
    if (c.week_reset_date !== monday) {
      updates.week_reset_date = monday;
      updates.avocado_count_week = 0;
      updates.egg_count_week = 0;
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

    return new Response(JSON.stringify({
      valid: true,
      client: {
        id: c.id, name: c.name, phase: c.phase,
        avocado_count_week: c.avocado_count_week, egg_count_week: c.egg_count_week,
        water_today_litres: Number(c.water_today_litres), meal_streak: c.meal_streak,
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
        phase3_mb_cheese: c.phase3_mb_cheese ?? "",
        phase3_mb_legumes: c.phase3_mb_legumes ?? "",
        phase3_mb_vegetables: c.phase3_mb_vegetables ?? "",
        phase3_mb_fat_oil: c.phase3_mb_fat_oil ?? "",
        show_rules: c.show_rules === true,
        weight_unit: c.weight_unit === "lbs" ? "lbs" : "kg",
        length_unit: c.length_unit === "in" ? "in" : "cm",
        height_cm: c.height_cm != null ? Number(c.height_cm) : null,
        phase2_strict_started_at: c.phase2_strict_started_at ?? null,
        phase2_strict_extra_days: c.phase2_strict_extra_days ?? 0,
        phase2_food_list: c.phase2_food_list ?? null,
        weekly_food_limits: c.weekly_food_limits ?? {},
      },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ valid: false, error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
