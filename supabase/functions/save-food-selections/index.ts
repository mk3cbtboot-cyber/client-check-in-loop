import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SLOT_KEYS = ["breakfast", "morning_snack", "lunch", "afternoon_snack", "dinner"] as const;
const CATEGORIES = ["protein", "carbs", "veg", "fat"] as const;

const Body = z.object({
  token: z.string().min(10).max(200),
  slot_key: z.enum(SLOT_KEYS),
  selections: z.object({
    protein: z.string().nullable().optional(),
    carbs: z.string().nullable().optional(),
    veg: z.string().nullable().optional(),
    fat: z.string().nullable().optional(),
  }),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "Invalid input" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { token, slot_key, selections } = parsed.data;
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: c } = await admin.from("clients").select("id, client_food_selections").eq("magic_token", token).maybeSingle();
    if (!c) return new Response(JSON.stringify({ error: "Invalid link" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const cur = (c.client_food_selections ?? {}) as Record<string, Record<string, string | null>>;
    const clean: Record<string, string | null> = {};
    for (const cat of CATEGORIES) {
      const v = selections[cat];
      clean[cat] = typeof v === "string" && v.trim().length > 0 ? v : null;
    }
    const next = { ...cur, [slot_key]: clean };
    const { error } = await admin.from("clients").update({ client_food_selections: next }).eq("id", c.id);
    if (error) throw error;
    return new Response(JSON.stringify({ ok: true, client_food_selections: next }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("save-food-selections error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
