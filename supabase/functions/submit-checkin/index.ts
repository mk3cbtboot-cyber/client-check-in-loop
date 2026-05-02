import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
import { z } from "https://esm.sh/zod@3.23.8";

const BodySchema = z.object({
  token: z.string().min(10).max(200),
  feeling: z.number().int().min(1).max(5),
  water_glasses: z.number().int().min(0).max(50),
  notes: z.string().max(2000).optional().default(""),
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
    const { token, feeling, water_glasses, notes } = parsed.data;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Validate token -> client
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

    const { data: checkIn, error: insertErr } = await admin
      .from("check_ins")
      .insert({
        client_id: client.id,
        feeling,
        water_glasses,
        notes: notes || null,
      })
      .select()
      .single();
    if (insertErr) throw insertErr;

    // Look up practitioner email and notify (best-effort)
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
              feeling,
              waterGlasses: water_glasses,
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
