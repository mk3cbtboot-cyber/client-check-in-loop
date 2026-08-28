import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { planInstructionsHash } from "../_shared/plan-instructions-hash.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const Body = z.object({ token: z.string().min(10).max(200) });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "invalid" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: c } = await admin
      .from("clients")
      .select("id, plan_instructions")
      .eq("magic_token", parsed.data.token)
      .maybeSingle();
    if (!c) {
      return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const hash = planInstructionsHash(c.plan_instructions);
    if (!hash) {
      return new Response(JSON.stringify({ ok: true, needs_instructions_ack: false, plan_instructions_acked_at: null }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const acked_at = new Date().toISOString();
    const { error } = await admin
      .from("clients")
      .update({ plan_instructions_acked_hash: hash, plan_instructions_acked_at: acked_at })
      .eq("id", c.id);
    if (error) throw error;
    return new Response(JSON.stringify({ ok: true, needs_instructions_ack: false, plan_instructions_acked_at: acked_at }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
