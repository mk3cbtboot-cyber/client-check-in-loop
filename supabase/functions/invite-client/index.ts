import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
import { z } from "https://esm.sh/zod@3.23.8";

const BodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(255),
  system_mode: z.enum(["mb", "own_practice"]).optional(),
  gender: z.enum(["male", "female", "unspecified"]).optional(),
  height_cm: z.number().positive().max(300).optional(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify caller (practitioner)
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const practitionerId = userData.user.id;

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "Invalid input" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { name, email, system_mode, gender, height_cm } = parsed.data;

    const admin = createClient(supabaseUrl, serviceKey);

    const insertRow: Record<string, unknown> = { practitioner_id: practitionerId, name, email };
    if (system_mode) insertRow.system_mode = system_mode;
    if (gender) insertRow.gender = gender;
    if (height_cm != null) insertRow.height_cm = height_cm;
    const { data: client, error: insertErr } = await admin
      .from("clients")
      .insert(insertRow)
      .select()
      .single();
    if (insertErr) throw insertErr;

    // Build magic link from request origin
    const origin = req.headers.get("origin") ?? req.headers.get("referer")?.replace(/\/$/, "") ?? "";
    const link = `${origin}/checkin/${client.magic_token}`;

    // Send invite email via transactional email function (best-effort)
    try {
      await admin.functions.invoke("send-transactional-email", {
        body: {
          templateName: "client-invite",
          recipientEmail: email,
          idempotencyKey: `client-invite-${client.id}`,
          templateData: { name, checkinUrl: link },
        },
      });
    } catch (emailErr) {
      console.warn("Email send failed (non-fatal):", emailErr);
    }

    return new Response(JSON.stringify({ ok: true, magicLink: link, clientId: client.id }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("invite-client error:", err);
    return new Response(JSON.stringify({ error: err.message ?? "Server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
