import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const Body = z.object({ token: z.string().min(10).max(200) });
const today = () => new Date().toISOString().slice(0, 10);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return new Response(JSON.stringify({ error: "invalid" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: c } = await admin.from("clients").select("id, water_today_litres, water_date").eq("magic_token", parsed.data.token).maybeSingle();
    if (!c) return new Response(JSON.stringify({ error: "invalid" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const td = today();
    const current = c.water_date === td ? Number(c.water_today_litres) : 0;
    const next = Math.round((current + 0.25) * 100) / 100;
    await admin.from("clients").update({ water_today_litres: next, water_date: td }).eq("id", c.id);
    return new Response(JSON.stringify({ water_today_litres: next }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
