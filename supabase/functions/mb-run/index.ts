import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import {
  addDays,
  describeBlock,
  planRunAgainstLedger,
  weekWindowFor,
  type CapConsumed,
  type CapLimit,
  type CapSuggestion,
} from "../_shared/mb-cap.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RUN_DAYS = 3;
/** How far back the client needs ledger history for the "remaining" display. */
const HISTORY_DAYS = 21;

const Colour = z.enum(["blue", "green", "orange"]);
const ISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const RunMeal = z.object({
  colour: Colour,
  picks: z.record(z.string().max(120), z.string().max(200)),
});
const Run = z.object({
  version: z.number().optional(),
  colour: Colour.nullable(),
  started_on: z.string().max(20).nullable(),
  confirmed_on: z.string().max(20).nullable().optional(),
  week_start: z.string().max(20).nullable().optional(),
  meals: z.object({
    breakfast: RunMeal.nullable(),
    lunch: RunMeal.nullable(),
    dinner: RunMeal.nullable(),
  }),
  day_overrides: z
    .record(ISO, z.record(z.string().max(20), RunMeal))
    .optional()
    .default({}),
});
const Body = z.object({
  token: z.string().min(10).max(200),
  action: z.enum(["get", "save", "confirm"]),
  run: Run.optional(),
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const todayISO = () => new Date().toISOString().slice(0, 10);

/** Suggestions come from the practitioner's stored plan, never the payload. */
function planSuggestions(mbPlan: unknown): CapSuggestion[] {
  if (!mbPlan || typeof mbPlan !== "object" || Array.isArray(mbPlan)) return [];
  const raw = (mbPlan as Record<string, unknown>).suggestions;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (s): s is CapSuggestion =>
      !!s && typeof s === "object" && typeof (s as CapSuggestion).colour === "string",
  );
}

function enrichedLimits(raw: unknown): CapLimit[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is CapLimit => !!r && typeof r === "object");
}

function legacyLimits(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) out[k] = n;
  }
  return out;
}

interface LedgerRow {
  week_start: string;
  day: string;
  meal: string;
  food: string;
  qty: number;
}

/** week_start → food → qty, ignoring the days this run itself owns. */
function foldConsumed(rows: LedgerRow[], excludeDays: Set<string>): CapConsumed {
  const out: CapConsumed = {};
  for (const r of rows) {
    if (excludeDays.has(r.day)) continue;
    const week = (out[r.week_start] = out[r.week_start] ?? {});
    week[r.food] = (week[r.food] ?? 0) + Number(r.qty || 0);
  }
  return out;
}

const runDates = (start: string, days = RUN_DAYS) =>
  Array.from({ length: days }, (_, i) => addDays(start, i));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
    const { token, action, run } = parsed.data;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: c } = await admin
      .from("clients")
      .select(
        "id, client_type, mb_run, mb_plan, mb_food_limits, food_limits, phase2_strict_started_at",
      )
      .eq("magic_token", token)
      .maybeSingle();
    if (!c) return json({ error: "invalid" }, 400);
    // MB-only surface.
    if (c.client_type !== "mb") return json({ error: "not_applicable" }, 400);

    const anchor = (c.phase2_strict_started_at as string | null)?.slice(0, 10) ?? null;

    const loadRows = async (): Promise<LedgerRow[]> => {
      const { data } = await admin
        .from("mb_cap_ledger")
        .select("week_start, day, meal, food, qty")
        .eq("client_id", c.id)
        .gte("day", addDays(todayISO(), -HISTORY_DAYS));
      return (data ?? []) as LedgerRow[];
    };

    if (action === "get") {
      const storedStart =
        (c.mb_run as { started_on?: string } | null)?.started_on?.slice(0, 10) ?? null;
      const exclude = new Set(storedStart ? runDates(storedStart) : []);
      const rows = await loadRows();
      return json({
        run: c.mb_run ?? {},
        anchor,
        // Everything the caller needs to render "remaining this week" without
        // re-deriving cap history in the browser.
        consumed: foldConsumed(rows, exclude),
        consumed_all: foldConsumed(rows, new Set()),
      });
    }

    if (!run) return json({ error: "missing run" }, 400);

    if (action === "save") {
      // Drafts stay permissive so a client can edit their way out of a
      // conflict — but saving always clears a previous confirmation.
      const next = { ...run, confirmed_on: null };
      const { error } = await admin.from("clients").update({ mb_run: next }).eq("id", c.id);
      if (error) return json({ error: error.message }, 500);
      return json({ run: next });
    }

    /* ---------------- confirm ---------------- */
    const start = (run.started_on ?? todayISO()).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return json({ error: "invalid start date" }, 400);
    const days = runDates(start);

    // Re-confirming replaces this run's own days, so its previous rows must not
    // count against it.
    const rows = await loadRows();
    const consumed = foldConsumed(rows, new Set(days));

    const result = planRunAgainstLedger(
      run,
      planSuggestions(c.mb_plan),
      enrichedLimits(c.mb_food_limits),
      legacyLimits(c.food_limits),
      consumed,
      { anchor, runDays: RUN_DAYS, startDate: start },
    );

    if (result.blocks.length > 0) {
      return json(
        {
          error: "cap_exceeded",
          message: result.blocks.map(describeBlock).join(" "),
          blocks: result.blocks,
          days: result.days,
        },
        409,
      );
    }

    // Replace this run's days wholesale — but only rows still 'planned'. A row
    // already flipped to 'eaten' (client logged it, then re-plans the run)
    // must survive and keep counting, so re-confirming can never double-count
    // or erase eaten history.
    const { error: delErr } = await admin
      .from("mb_cap_ledger")
      .delete()
      .eq("client_id", c.id)
      .eq("status", "planned")
      .in("day", days);
    if (delErr) return json({ error: delErr.message }, 500);

    if (result.rows.length > 0) {
      const { error: insErr } = await admin.from("mb_cap_ledger").insert(
        result.rows.map((r) => ({
          client_id: c.id,
          week_start: r.week_start,
          day: r.day,
          meal: r.meal,
          food: r.food,
          qty: r.qty,
          status: r.status,
          source: r.source,
          run_started_on: start,
        })),
      );
      if (insErr) return json({ error: insErr.message }, 500);
    }

    const confirmed = {
      ...run,
      started_on: start,
      confirmed_on: todayISO(),
      week_start: weekWindowFor(anchor, start).week_start,
    };
    const { error } = await admin.from("clients").update({ mb_run: confirmed }).eq("id", c.id);
    if (error) return json({ error: error.message }, 500);

    const after = await loadRows();
    return json({
      run: confirmed,
      days: result.days,
      consumed: foldConsumed(after, new Set(days)),
      consumed_all: foldConsumed(after, new Set()),
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
