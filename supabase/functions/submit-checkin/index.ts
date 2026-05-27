import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
import { z } from "https://esm.sh/zod@3.23.8";

const rating = z.number().int().min(1).max(5).optional();

const BodySchema = z.object({
  token: z.string().min(10).max(200),
  feeling: z.number().int().min(1).max(5).optional(),
  water_litres: z.number().min(0).max(20).optional(),
  notes: z.string().max(2000).optional().default(""),
  weight_kg: z.number().min(0).max(500).optional(),
  general_wellbeing: rating,
  fatigue: rating,
  sleep: rating,
  headache: rating,
  pain: rating,
  joint_pain: rating,
  acid_reflux: rating,
  digestion: rating,
  allergy_skin: rating,
  body_fat_pct: z.number().min(0).max(100).optional(),
  waist_cm: z.number().min(0).max(500).optional(),
  hip_cm: z.number().min(0).max(500).optional(),
  chest_cm: z.number().min(0).max(500).optional(),
  upper_thigh_cm: z.number().min(0).max(500).optional(),
  is_weekly: z.boolean().optional(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "Invalid input" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { token, notes, ...rest } = parsed.data;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: client, error: clientErr } = await admin
      .from("clients")
      .select("id, name, email, practitioner_id")
      .eq("magic_token", token)
      .maybeSingle();
    if (clientErr || !client) {
      return new Response(JSON.stringify({ error: "Invalid link" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const insertRow: Record<string, unknown> = {
      client_id: client.id,
      notes: notes || null,
    };
    for (const [k, v] of Object.entries(rest)) {
      if (v !== undefined) insertRow[k] = v;
    }

    const { data: checkIn, error: insertErr } = await admin
      .from("check_ins")
      .insert(insertRow)
      .select()
      .single();
    if (insertErr) throw insertErr;

    // Sync home-screen water tracker if water_litres provided
    if (rest.water_litres !== undefined) {
      const td = new Date().toISOString().slice(0, 10);
      await admin.from("clients").update({
        water_today_litres: rest.water_litres,
        water_date: td,
      }).eq("id", client.id);
    }

    try {
      const { data: prof } = await admin
        .from("profiles")
        .select("email")
        .eq("id", client.practitioner_id)
        .maybeSingle();
      if (prof?.email) {
        await admin.functions.invoke("send-transactional-email", {
          body: {
            templateName: "checkin-notification",
            recipientEmail: prof.email,
            idempotencyKey: `checkin-notify-${checkIn.id}`,
            templateData: {
              clientName: client.name,
              feeling: rest.feeling ?? null,
              waterLitres: rest.water_litres ?? null,
              notes: notes || "",
            },
          },
        });
      }
    } catch (emailErr) {
      console.warn("Notification email failed (non-fatal):", emailErr);
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("submit-checkin error:", err);
    return new Response(JSON.stringify({ error: err.message ?? "Server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
