import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const Body = z.object({
  token: z.string().min(10).max(200),
  action: z.enum(["get", "log"]),
  description: z.string().max(500).optional(),
  eaten_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

function mondayOf(dateStr: string): string {
  const dt = new Date(dateStr + "T00:00:00Z");
  const day = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - day);
  return dt.toISOString().slice(0, 10);
}
const todayStr = () => new Date().toISOString().slice(0, 10);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "invalid" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { token, action, description, eaten_on } = parsed.data;

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: c } = await admin.from("clients").select("id, phase").eq("magic_token", token).maybeSingle();
    if (!c) return new Response(JSON.stringify({ error: "invalid_token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (c.phase !== "phase2_extended" && c.phase !== "phase3") {
      return new Response(JSON.stringify({ error: "phase_not_allowed" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const weekStart = mondayOf(todayStr());

    if (action === "get") {
      const { data } = await admin.from("treat_meals").select("id, description, eaten_on, week_start, created_at")
        .eq("client_id", c.id).eq("week_start", weekStart).maybeSingle();
      return new Response(JSON.stringify({ treat_meal: data ?? null }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // log
    const date = eaten_on ?? todayStr();
    if (mondayOf(date) !== weekStart) {
      return new Response(JSON.stringify({ error: "date_outside_week" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { data, error } = await admin.from("treat_meals")
      .insert({ client_id: c.id, description: (description ?? "").trim(), eaten_on: date, week_start: weekStart })
      .select("id, description, eaten_on, week_start, created_at")
      .maybeSingle();
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ treat_meal: data }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
