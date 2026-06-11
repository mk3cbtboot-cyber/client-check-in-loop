import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const AI_FALLBACK =
  "That's a great question for your practitioner — I've passed it on to them.";


const Body = z.object({
  token: z.string().min(10).max(200),
  action: z.enum(["list", "send", "unread_count"]),
  body: z.string().trim().min(1).max(4000).optional(),
});

// --- Office hours helpers (kept in sync with src/lib/office-hours.ts) ---
type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
const DOW_TO_KEY: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DEFAULT_DAYS: Record<DayKey, { enabled: boolean; start: string; end: string }> = {
  mon: { enabled: true, start: "09:00", end: "17:00" },
  tue: { enabled: true, start: "09:00", end: "17:00" },
  wed: { enabled: true, start: "09:00", end: "17:00" },
  thu: { enabled: true, start: "09:00", end: "17:00" },
  fri: { enabled: true, start: "09:00", end: "17:00" },
  sat: { enabled: false, start: "09:00", end: "17:00" },
  sun: { enabled: false, start: "09:00", end: "17:00" },
};

function tzParts(date: Date, tz: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) if (p.type !== "literal") map[p.type] = p.value;
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    y: +map.year, m: +map.month, d: +map.day,
    hour: +map.hour % 24, minute: +map.minute,
    dow: dowMap[map.weekday] ?? 0,
  };
}

function checkAvailability(profile: {
  office_hours?: unknown;
  out_of_office?: boolean;
  ooo_return_date?: string | null;
  timezone?: string | null;
}, now = new Date()): { available: boolean; reason: "in_hours" | "out_of_hours" | "out_of_office" } {
  const oh = (profile.office_hours ?? {}) as { tz?: string; days?: Partial<Record<DayKey, any>> };
  const tz = profile.timezone || oh.tz || "UTC";
  const days = { ...DEFAULT_DAYS } as typeof DEFAULT_DAYS;
  if (oh.days) {
    for (const k of Object.keys(DEFAULT_DAYS) as DayKey[]) {
      const d = oh.days[k];
      if (d && typeof d === "object") {
        days[k] = {
          enabled: !!d.enabled,
          start: typeof d.start === "string" ? d.start : days[k].start,
          end: typeof d.end === "string" ? d.end : days[k].end,
        };
      }
    }
  }

  if (profile.out_of_office) {
    const ret = profile.ooo_return_date;
    if (!ret) return { available: false, reason: "out_of_office" };
    const p = tzParts(now, tz);
    const todayIso = `${String(p.y).padStart(4, "0")}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
    if (todayIso < ret) return { available: false, reason: "out_of_office" };
  }

  const p = tzParts(now, tz);
  const day = days[DOW_TO_KEY[p.dow]];
  if (!day.enabled) return { available: false, reason: "out_of_hours" };
  const [sh, sm] = day.start.split(":").map((n) => parseInt(n, 10));
  const [eh, em] = day.end.split(":").map((n) => parseInt(n, 10));
  const cur = p.hour * 60 + p.minute;
  if (cur >= sh * 60 + sm && cur < eh * 60 + em) return { available: true, reason: "in_hours" };
  return { available: false, reason: "out_of_hours" };
}

function buildNotice(profile: {
  ooo_message?: string | null;
  ooo_return_date?: string | null;
  out_of_office?: boolean;
}): string {
  const base = "Cheryl is currently outside of office hours. Your message has been received and she will respond when she's back.";
  const extra = profile.out_of_office && profile.ooo_message ? ` ${profile.ooo_message.trim()}` : "";
  return base + extra;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "invalid_request" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { token, action, body } = parsed.data;
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: c } = await admin
      .from("clients")
      .select("id, archived_at, client_last_read_at, practitioner_id")
      .eq("magic_token", token)
      .maybeSingle();
    if (!c || c.archived_at) {
      return new Response(JSON.stringify({ error: "invalid_token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load practitioner availability state
    const { data: prof } = await admin
      .from("profiles")
      .select("office_hours, out_of_office, ooo_message, ooo_return_date, timezone")
      .eq("id", c.practitioner_id)
      .maybeSingle();
    const availability = checkAvailability(prof ?? {});
    const notice = buildNotice(prof ?? {});

    if (action === "unread_count") {
      const since = c.client_last_read_at ?? "1970-01-01T00:00:00Z";
      const { count } = await admin
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("client_id", c.id)
        .in("sender", ["practitioner", "ai"])
        .gt("created_at", since);
      return new Response(JSON.stringify({ unread: count ?? 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "send") {
      if (!body) {
        return new Response(JSON.stringify({ error: "body_required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      await admin.from("messages").insert({
        client_id: c.id,
        sender: "client",
        body,
        deferred: !availability.available,
      });

      // AI interceptor: only fire if this starts a new thread AND looks like a question.
      const { data: priorPractitioner } = await admin
        .from("messages")
        .select("id")
        .eq("client_id", c.id)
        .eq("sender", "practitioner")
        .limit(1);
      const isNewThread = !priorPractitioner || priorPractitioner.length === 0;

      const lower = body.toLowerCase();
      const phrases = [
        "can i", "am i allowed", "what is", "what's", "how much", "how many",
        "is it ok", "is it okay", "what can", "how do i", "how should i",
        "when should", "do i need", "should i", "could i", "may i",
        "are there", "is there", "do you", "will i", "why is", "why does",
      ];
      const hasQuestion = body.includes("?") || phrases.some((p) => lower.includes(p));

      if (isNewThread && hasQuestion) {
        await admin.from("messages").insert({ client_id: c.id, sender: "ai", body: AI_PLACEHOLDER });
      }
    }

    // For list (and after send), mark client as having read up to now.
    await admin
      .from("clients")
      .update({ client_last_read_at: new Date().toISOString() })
      .eq("id", c.id);

    const { data: messages } = await admin
      .from("messages")
      .select("id, sender, body, created_at, deferred")
      .eq("client_id", c.id)
      .order("created_at", { ascending: true });

    // Attach a notice to client messages that were deferred AND the practitioner is still unavailable.
    const out = (messages ?? []).map((m: any) => {
      if (m.sender === "client" && m.deferred && !availability.available) {
        return { ...m, notice };
      }
      return m;
    });

    return new Response(JSON.stringify({
      messages: out,
      unread: 0,
      availability: { available: availability.available, reason: availability.reason, notice: availability.available ? null : notice },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
