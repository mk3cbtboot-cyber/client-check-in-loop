import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
import { z } from "https://esm.sh/zod@3.23.8";
import { sendTemplateEmail } from "../_shared/transactional-email-templates/send-email.ts";
import { logEmailSend } from "../_shared/email-send-log.ts";

const BodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(255),
  system_mode: z.enum(["mb", "own_practice"]).optional(),
  client_type: z.enum(["mb", "custom"]).optional(),
  plan_format: z.enum(["food_list", "recipe", "food_list_generated"]).optional(),
  gender: z.enum(["male", "female", "unspecified"]).optional(),
  height_cm: z.number().positive().max(300).optional(),
});

const GENERIC_MAILBOX_LOCALS = new Set([
  "info", "hello", "admin", "contact", "support", "team", "office", "no-reply", "noreply",
]);

function firstNameFromEmail(email: string | null | undefined): string | null {
  if (!email || typeof email !== "string") return null;
  const local = (email.split("@")[0] ?? "").toLowerCase();
  if (GENERIC_MAILBOX_LOCALS.has(local)) return null;
  const letters = local.replace(/[^a-z]/g, "");
  if (!letters) return null;
  return letters.charAt(0).toUpperCase() + letters.slice(1);
}

function resolvePractName(prof: { display_name?: string | null; email?: string | null } | null | undefined): string {
  const dn = prof?.display_name;
  if (dn && dn.trim()) return dn.trim();
  return firstNameFromEmail(prof?.email) ?? "your practitioner";
}


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
    const { name, email, system_mode, client_type, plan_format, gender, height_cm } = parsed.data;

    const admin = createClient(supabaseUrl, serviceKey);

    const insertRow: Record<string, unknown> = { practitioner_id: practitionerId, name, email };
    if (system_mode) insertRow.system_mode = system_mode;
    if (client_type) insertRow.client_type = client_type;
    if (plan_format) insertRow.plan_format = plan_format;
    if (gender) insertRow.gender = gender;
    if (height_cm != null) insertRow.height_cm = height_cm;
    const { data: client, error: insertErr } = await admin
      .from("clients")
      .insert(insertRow)
      .select()
      .single();
    if (insertErr) throw insertErr;

    // Build the portal link from the configured base URL. No guessing.
    const portalBase = (Deno.env.get("PORTAL_BASE_URL") ?? "").trim().replace(/\/$/, "");
    let link: string | null = null;
    let emailSent = false;
    let emailError: string | null = null;

    if (!portalBase) {
      emailError = "PORTAL_BASE_URL is not configured";
      console.error("invite-client: PORTAL_BASE_URL is not set; cannot build portal link or send invite email");
    } else {
      link = `${portalBase}/portal/${client.magic_token}`;

      // Resolve practitioner display name (same rule as client-messages)
      const { data: prof } = await admin
        .from("profiles")
        .select("display_name, email")
        .eq("id", practitionerId)
        .maybeSingle();
      const practitionerName = resolvePractName(prof);

      const clientFirstName = (name.trim().split(/\s+/)[0] || "there");

      const messageId = `client-invite-${client.id}-${Date.now()}`;
      try {
        const result = await sendTemplateEmail("client-invite", email, {
          idempotencyKey: messageId,
          templateData: {
            client_first_name: clientFirstName,
            practitioner_name: practitionerName,
            portal_url: link,
          },
        });
        emailSent = result.sent;
        if (!emailSent) emailError = "Recipient address is suppressed";
        await logEmailSend(admin, {
          message_id: messageId,
          template_name: "client-invite",
          recipient_email: email,
          status: result.sent ? "sent" : "suppressed",
        });
      } catch (err: any) {
        emailError = err?.message ?? "Failed to send invite email";
        console.error("invite-client: invite email failed", { clientId: client.id, email, error: err });
        await logEmailSend(admin, {
          message_id: messageId,
          template_name: "client-invite",
          recipient_email: email,
          status: "failed",
          error_message: String(emailError).slice(0, 1000),
        });
      }
    }

    return new Response(
      JSON.stringify({ ok: true, magicLink: link, clientId: client.id, emailSent, emailError }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("invite-client error:", err);
    return new Response(JSON.stringify({ error: err.message ?? "Server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
