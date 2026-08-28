// Evening meal-log reminder sweep.
//
// Runs hourly from pg_cron. For each active client it works out the local hour
// in clients.timezone (falling back to America/Toronto when null) and only
// sends when that hour is the target evening hour. Combined with the
// idempotency key `reminder-<client_id>-<local YYYY-MM-DD>` a client can never
// receive more than one reminder per day.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { missedMealSlots } from "../_shared/missed-meals.ts";
import { sendTemplateEmail } from "../_shared/transactional-email-templates/send-email.ts";
import { logEmailSend } from "../_shared/email-send-log.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TARGET_HOUR = 20; // 8pm local
const FALLBACK_TZ = "America/Toronto";

const Body = z.object({
  /** Only consider this client (manual testing). */
  client_id: z.string().uuid().optional(),
  /** Ignore the local-hour gate (manual testing). Idempotency still applies. */
  force: z.boolean().optional(),
  /** Report what would be sent without sending. */
  dry_run: z.boolean().optional(),
});

function localParts(tz: string, now: Date): { date: string; hour: number } {
  let zone = tz;
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false,
    });
  } catch {
    zone = FALLBACK_TZ;
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false,
    });
  }
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour === "24" ? "0" : parts.hour);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey);

  let opts: z.infer<typeof Body> = {};
  try {
    const raw = await req.text();
    if (raw.trim()) {
      const parsed = Body.safeParse(JSON.parse(raw));
      if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
      opts = parsed.data;
    }
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const portalBase = (Deno.env.get("PORTAL_BASE_URL") ?? "").trim().replace(/\/$/, "");
  if (!portalBase) {
    console.error("meal-log-reminder: PORTAL_BASE_URL is not configured");
    return json({ error: "PORTAL_BASE_URL is not configured" }, 500);
  }

  let query = admin
    .from("clients")
    .select(
      "id, name, email, magic_token, timezone, archived_at, reminders_enabled, client_type, plan_format, meals_per_day, mb_run",
    )
    .is("archived_at", null)
    .eq("reminders_enabled", true);
  if (opts.client_id) query = query.eq("id", opts.client_id);

  const { data: clients, error } = await query;
  if (error) {
    console.error("meal-log-reminder: client query failed", error);
    return json({ error: "Failed to load clients" }, 500);
  }

  const now = new Date();
  const results: Array<Record<string, unknown>> = [];
  let sent = 0;

  for (const c of (clients ?? []) as Array<Record<string, any>>) {
    const tz = typeof c.timezone === "string" && c.timezone.trim() ? c.timezone.trim() : FALLBACK_TZ;
    const { date, hour } = localParts(tz, now);

    if (!opts.force && hour !== TARGET_HOUR) {
      results.push({ client_id: c.id, skipped: "not_local_evening", tz, local_hour: hour });
      continue;
    }

    // Today only — yesterday's grace window stays an in-app nudge.
    const pending = await missedMealSlots(admin, c, 1, date);
    if (!pending.length) {
      results.push({ client_id: c.id, skipped: "nothing_missed", tz });
      continue;
    }

    const idempotencyKey = `reminder-${c.id}-${date}`;

    // Dedupe: the same key already logged today means the email went out.
    const { data: already } = await admin
      .from("email_send_log")
      .select("id")
      .eq("message_id", idempotencyKey)
      .limit(1)
      .maybeSingle();
    if (already) {
      results.push({ client_id: c.id, skipped: "already_sent_today", tz });
      continue;
    }

    const missedMeals = pending.map((p) => p.label);
    if (opts.dry_run) {
      results.push({ client_id: c.id, would_send: true, tz, missed_meals: missedMeals });
      continue;
    }

    try {
      const result = await sendTemplateEmail("meal-log-reminder", c.email, {
        idempotencyKey,
        templateData: {
          client_first_name: String(c.name ?? "").trim().split(/\s+/)[0] || "there",
          missed_meals: missedMeals,
          portal_url: `${portalBase}/portal/${c.magic_token}`,
        },
      });
      if (result.sent) sent++;
      // Keeps the once-per-day dedupe read above working.
      await logEmailSend(admin, {
        message_id: idempotencyKey,
        template_name: "meal-log-reminder",
        recipient_email: c.email,
        status: result.sent ? "sent" : "suppressed",
      });
      results.push({
        client_id: c.id,
        tz,
        sent: result.sent,
        suppressed: !result.sent,
        missed_meals: missedMeals,
      });
    } catch (err) {
      console.error("meal-log-reminder: send failed", { clientId: c.id, err });
      await logEmailSend(admin, {
        message_id: idempotencyKey,
        template_name: "meal-log-reminder",
        recipient_email: c.email,
        status: "failed",
        error_message: String(err instanceof Error ? err.message : err).slice(0, 1000),
      });
      results.push({ client_id: c.id, tz, error: String(err) });
    }
  }

  console.log("meal-log-reminder: sweep complete", { considered: clients?.length ?? 0, sent });
  return json({ ok: true, considered: clients?.length ?? 0, sent, results });
});
