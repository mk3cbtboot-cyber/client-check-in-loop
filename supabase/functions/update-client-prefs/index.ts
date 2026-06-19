import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const Body = z.object({
  token: z.string().min(10).max(200),
  weight_unit: z.enum(["kg", "lbs"]).optional(),
  length_unit: z.enum(["cm", "in"]).optional(),
  welcome_seen: z.boolean().optional(),
  phase3_lunch_action: z.enum(["accept", "confirm", "defer"]).optional(),
});

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "invalid" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { token, phase3_lunch_action, ...rest } = parsed.data;
    const updates: Record<string, unknown> = { ...rest };

    if (phase3_lunch_action) {
      const { data: c } = await admin
        .from("clients")
        .select("phase3_lunch_protein_bonus, phase3_lunch_carb_bonus")
        .eq("magic_token", token)
        .maybeSingle();
      if (!c) {
        return new Response(JSON.stringify({ error: "not_found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (phase3_lunch_action === "accept") {
        updates.phase3_lunch_protein_bonus = Number(c.phase3_lunch_protein_bonus ?? 0) + 5;
        updates.phase3_lunch_carb_bonus = Number(c.phase3_lunch_carb_bonus ?? 0) + 5;
        updates.phase3_lunch_prompt_last_dismissed_on = todayIso();
      } else if (phase3_lunch_action === "confirm") {
        updates.phase3_portions_confirmed = true;
        updates.phase3_lunch_prompt_last_dismissed_on = todayIso();
      } else if (phase3_lunch_action === "defer") {
        updates.phase3_lunch_prompt_last_dismissed_on = todayIso();
      }
    }

    if (Object.keys(updates).length === 0) {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data, error } = await admin
      .from("clients")
      .update(updates)
      .eq("magic_token", token)
      .select("phase3_lunch_protein_bonus, phase3_lunch_carb_bonus, phase3_portions_confirmed, phase3_lunch_prompt_last_dismissed_on")
      .maybeSingle();
    if (error) throw error;
    return new Response(JSON.stringify({ ok: true, client: data ?? null }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
