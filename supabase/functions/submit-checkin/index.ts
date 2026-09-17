import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
import { z } from "https://esm.sh/zod@3.23.8";
import { sendTemplateEmail } from "../_shared/transactional-email-templates/send-email.ts";
import { logEmailSend } from "../_shared/email-send-log.ts";
import { localDayISO, localTodayISO, shiftISO } from "../_shared/local-day.ts";
import { currentCheckinPeriod } from "../_shared/checkin-period.ts";

const rating = z.number().int().min(1).max(5).optional();

const EditCommentSchema = z.object({
  token: z.string().min(10).max(200),
  action: z.literal("edit_comment"),
  check_in_id: z.string().uuid(),
  notes: z.string().max(2000),
});

const BodySchema = z.object({
  token: z.string().min(10).max(200),
  action: z.undefined().optional(),
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

const CLIENT_COLS =
  "id, name, email, practitioner_id, practitioner_notes, timezone, client_type, system_mode, phase, phase2_strict_started_at, checkin_cadence, checkin_cadence_anchor, checkin_weekday, checkin_weekday_effective_from, created_at";

const stamp = (tzRaw: unknown): string => {
  let tz = typeof tzRaw === "string" ? tzRaw.trim() : "";
  try { if (tz) new Intl.DateTimeFormat("en-US", { timeZone: tz }); } catch { tz = ""; }
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz || "UTC",
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).format(new Date());
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const raw = await req.json();

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ---- Comment-only edit of an existing check-in -------------------------
    if (raw && typeof raw === "object" && (raw as { action?: unknown }).action === "edit_comment") {
      const edit = EditCommentSchema.safeParse(raw);
      if (!edit.success) return json({ error: "Invalid input" }, 400);
      const { data: c } = await admin
        .from("clients")
        .select(CLIENT_COLS)
        .eq("magic_token", edit.data.token)
        .maybeSingle();
      if (!c) return json({ error: "Invalid link" }, 400);

      const { data: row } = await admin
        .from("check_ins")
        .select("id, notes")
        .eq("id", edit.data.check_in_id)
        .eq("client_id", c.id)
        .maybeSingle();
      if (!row) return json({ error: "Check-in not found" }, 404);

      const text = edit.data.notes.trim();
      await admin.from("check_ins").update({ notes: text || null }).eq("id", row.id);

      // Append-only trail: the earlier comment stays in practitioner notes.
      if (text) {
        const entry = `[${stamp(c.timezone)}] Client check-in note (edited): ${text}`;
        const existing = (c.practitioner_notes ?? "").trim();
        await admin
          .from("clients")
          .update({ practitioner_notes: existing ? `${existing}\n${entry}` : entry })
          .eq("id", c.id);
      }
      // Deliberately no notification email on comment edits.
      return json({ ok: true, notes: text || null });
    }

    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) return json({ error: "Invalid input" }, 400);
    const { token, notes, ...restAll } = parsed.data;
    const { action: _ignored, ...rest } = restAll as Record<string, unknown>;

    const { data: client, error: clientErr } = await admin
      .from("clients")
      .select(CLIENT_COLS)
      .eq("magic_token", token)
      .maybeSingle();
    if (clientErr || !client) return json({ error: "Invalid link" }, 400);

    // ---- One check-in per cadence period -----------------------------------
    // MB-side: phase-driven. Custom Rx: practitioner cadence. Separate paths.
    const tz = client.timezone as string | null;
    const todayLocal = localTodayISO(tz);
    const period = currentCheckinPeriod(client, todayLocal);
    if (period) {
      const { data: recent } = await admin
        .from("check_ins")
        .select("*")
        .eq("client_id", client.id)
        .gte("created_at", `${shiftISO(period.start, -2)}T00:00:00Z`)
        .order("created_at", { ascending: true });
      const existing = (recent ?? []).find((r: { created_at: string }) => {
        const d = localDayISO(r.created_at, tz);
        return d >= period.start && d <= period.end;
      });
      if (existing) {
        return json({
          ok: false,
          error: "already_submitted",
          period,
          existing,
        });
      }
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

    // Carry client check-in notes into Practitioner Notes (append-only, timestamped).
    if (notes && notes.trim().length > 0) {
      try {
        let tz = typeof client.timezone === "string" ? client.timezone.trim() : "";
        try { if (tz) new Intl.DateTimeFormat("en-US", { timeZone: tz }); } catch { tz = ""; }
        const stamp = new Intl.DateTimeFormat("en-US", {
          timeZone: tz || "UTC",
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        }).format(new Date());
        const entry = `[${stamp}] Client check-in note: ${notes.trim()}`;
        const existing = (client.practitioner_notes ?? "").trim();
        const combined = existing ? `${existing}\n${entry}` : entry;
        await admin.from("clients").update({ practitioner_notes: combined }).eq("id", client.id);
      } catch (noteErr) {
        console.warn("Appending check-in note to practitioner_notes failed (non-fatal):", noteErr);
      }
    }

    // Sync home-screen water tracker if water_litres provided
    if (rest.water_litres !== undefined) {
      // Stamp the client's own calendar day, so a 9pm check-in isn't tomorrow.
      const td = localTodayISO(client.timezone as string | null);
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
        const messageId = `checkin-notify-${checkIn.id}`;
        try {
          const result = await sendTemplateEmail("checkin-notification", prof.email, {
            idempotencyKey: messageId,
            templateData: {
              clientName: client.name,
              feeling: rest.feeling ?? null,
              waterLitres: rest.water_litres ?? null,
              notes: notes || "",
            },
          });
          await logEmailSend(admin, {
            message_id: messageId,
            template_name: "checkin-notification",
            recipient_email: prof.email,
            status: result.sent ? "sent" : "suppressed",
          });
        } catch (sendErr) {
          console.warn("Notification email failed (non-fatal):", sendErr);
          await logEmailSend(admin, {
            message_id: messageId,
            template_name: "checkin-notification",
            recipient_email: prof.email,
            status: "failed",
            error_message: String(sendErr instanceof Error ? sendErr.message : sendErr).slice(0, 1000),
          });
        }
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
