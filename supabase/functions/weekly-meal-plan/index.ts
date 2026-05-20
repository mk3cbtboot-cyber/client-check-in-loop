import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SelectionMap = z.record(z.string().min(1).max(80), z.string().min(1).max(200));

const Body = z.object({
  token: z.string().min(10).max(200),
  action: z.enum(["get", "save", "confirm", "reset"]),
  breakfast_meal_id: z.number().int().nullable().optional(),
  lunch_meal_id: z.number().int().nullable().optional(),
  dinner_meal_id: z.number().int().nullable().optional(),
  breakfast_selections: SelectionMap.optional(),
  lunch_selections: SelectionMap.optional(),
  dinner_selections: SelectionMap.optional(),
  breakfast_meal_id_alt: z.number().int().nullable().optional(),
  lunch_meal_id_alt: z.number().int().nullable().optional(),
  dinner_meal_id_alt: z.number().int().nullable().optional(),
  breakfast_selections_alt: SelectionMap.optional(),
  lunch_selections_alt: SelectionMap.optional(),
  dinner_selections_alt: SelectionMap.optional(),
  breakfast_primary_days: z.number().int().min(0).max(7).optional(),
  lunch_primary_days: z.number().int().min(0).max(7).optional(),
  dinner_primary_days: z.number().int().min(0).max(7).optional(),
});

function mondayOf(d: Date): string {
  const dt = new Date(d);
  const day = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - day);
  return dt.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "Invalid input" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const p = parsed.data;
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: client } = await admin.from("clients").select("id").eq("magic_token", p.token).maybeSingle();
    if (!client) {
      return new Response(JSON.stringify({ error: "Invalid link" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const week = mondayOf(new Date());

    if (p.action === "get") {
      const { data } = await admin
        .from("weekly_meal_plans")
        .select("*")
        .eq("client_id", client.id)
        .eq("week_start_date", week)
        .maybeSingle();
      return new Response(JSON.stringify({ plan: data ?? null, week_start_date: week }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (p.action === "reset") {
      await admin
        .from("weekly_meal_plans")
        .delete()
        .eq("client_id", client.id)
        .eq("week_start_date", week);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // save / confirm — upsert
    const { data: existing } = await admin
      .from("weekly_meal_plans")
      .select("*")
      .eq("client_id", client.id)
      .eq("week_start_date", week)
      .maybeSingle();

    const row = {
      client_id: client.id,
      week_start_date: week,
      breakfast_meal_id: p.breakfast_meal_id ?? existing?.breakfast_meal_id ?? null,
      lunch_meal_id: p.lunch_meal_id ?? existing?.lunch_meal_id ?? null,
      dinner_meal_id: p.dinner_meal_id ?? existing?.dinner_meal_id ?? null,
      breakfast_selections: p.breakfast_selections ?? existing?.breakfast_selections ?? {},
      lunch_selections: p.lunch_selections ?? existing?.lunch_selections ?? {},
      dinner_selections: p.dinner_selections ?? existing?.dinner_selections ?? {},
      breakfast_meal_id_alt: p.breakfast_meal_id_alt ?? existing?.breakfast_meal_id_alt ?? null,
      lunch_meal_id_alt: p.lunch_meal_id_alt ?? existing?.lunch_meal_id_alt ?? null,
      dinner_meal_id_alt: p.dinner_meal_id_alt ?? existing?.dinner_meal_id_alt ?? null,
      breakfast_selections_alt: p.breakfast_selections_alt ?? existing?.breakfast_selections_alt ?? {},
      lunch_selections_alt: p.lunch_selections_alt ?? existing?.lunch_selections_alt ?? {},
      dinner_selections_alt: p.dinner_selections_alt ?? existing?.dinner_selections_alt ?? {},
      breakfast_primary_days: p.breakfast_primary_days ?? existing?.breakfast_primary_days ?? 7,
      lunch_primary_days: p.lunch_primary_days ?? existing?.lunch_primary_days ?? 7,
      dinner_primary_days: p.dinner_primary_days ?? existing?.dinner_primary_days ?? 7,
      confirmed_at:
        p.action === "confirm" ? new Date().toISOString() : existing?.confirmed_at ?? null,
    };

    const { data: saved, error } = await admin
      .from("weekly_meal_plans")
      .upsert(row, { onConflict: "client_id,week_start_date" })
      .select()
      .single();

    if (error) throw error;

    return new Response(JSON.stringify({ plan: saved, week_start_date: week }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("weekly-meal-plan error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
