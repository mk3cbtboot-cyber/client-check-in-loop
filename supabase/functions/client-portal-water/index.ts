import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const Body = z.object({
  token: z.string().min(10).max(200),
  set_litres: z.number().min(0).max(20).optional(),
});
const today = () => new Date().toISOString().slice(0, 10);
const WATER_TARGET = 2.5;

function computeStreak(rows: { log_date: string; litres: number }[], todayStr: string): number {
  // rows sorted desc by log_date
  const map = new Map(rows.map(r => [r.log_date, Number(r.litres)]));
  let streak = 0;
  const d = new Date(todayStr + "T00:00:00Z");
  // If today already hit, count it; otherwise start from yesterday
  if ((map.get(todayStr) ?? 0) >= WATER_TARGET) {
    streak += 1;
  }
  d.setUTCDate(d.getUTCDate() - 1);
  while (true) {
    const key = d.toISOString().slice(0, 10);
    if ((map.get(key) ?? 0) >= WATER_TARGET) {
      streak += 1;
      d.setUTCDate(d.getUTCDate() - 1);
    } else break;
  }
  return streak;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return new Response(JSON.stringify({ error: "invalid" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: c } = await admin.from("clients").select("id, water_today_litres, water_date").eq("magic_token", parsed.data.token).maybeSingle();
    if (!c) return new Response(JSON.stringify({ error: "invalid" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const td = today();
    let next: number;
    if (parsed.data.set_litres !== undefined) {
      next = Math.round(parsed.data.set_litres * 100) / 100;
    } else {
      const current = c.water_date === td ? Number(c.water_today_litres) : 0;
      next = Math.round((current + 0.25) * 100) / 100;
    }
    const prev = c.water_date === td ? Number(c.water_today_litres) : 0;
    const justHit = prev < WATER_TARGET && next >= WATER_TARGET;

    await admin.from("clients").update({ water_today_litres: next, water_date: td }).eq("id", c.id);

    // Upsert daily water log
    await admin.from("daily_water_logs").upsert({
      client_id: c.id,
      log_date: td,
      litres: next,
      updated_at: new Date().toISOString(),
    }, { onConflict: "client_id,log_date" });

    // Compute streak from last 400 days
    const { data: rows } = await admin
      .from("daily_water_logs")
      .select("log_date, litres")
      .eq("client_id", c.id)
      .order("log_date", { ascending: false })
      .limit(400);
    const streak = computeStreak(rows ?? [], td);

    return new Response(JSON.stringify({ water_today_litres: next, water_streak: streak, just_hit_target: justHit }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
