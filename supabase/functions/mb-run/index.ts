import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import {
  evaluateRunCaps,
  describeViolation,
  type CapLimit,
  type CapSuggestion,
} from "../_shared/mb-cap.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RUN_DAYS = 3;

const Colour = z.enum(["blue", "green", "orange"]);
const RunMeal = z.object({
  colour: Colour,
  picks: z.record(z.string().max(120), z.string().max(200)),
});
const Run = z.object({
  colour: Colour.nullable(),
  started_on: z.string().max(20).nullable(),
  confirmed_on: z.string().max(20).nullable().optional(),
  meals: z.object({
    breakfast: RunMeal.nullable(),
    lunch: RunMeal.nullable(),
    dinner: RunMeal.nullable(),
  }),
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
      .select("id, client_type, mb_run, mb_plan, mb_food_limits, food_limits")
      .eq("magic_token", token)
      .maybeSingle();
    if (!c) return json({ error: "invalid" }, 400);
    // MB-only surface.
    if (c.client_type !== "mb") return json({ error: "not_applicable" }, 400);

    if (action === "get") return json({ run: c.mb_run ?? {} });

    if (!run) return json({ error: "missing run" }, 400);

    if (action === "save") {
      // Drafts stay permissive so a client can edit their way out of a
      // conflict — but saving always clears a previous confirmation.
      const next = { ...run, confirmed_on: null };
      const { error } = await admin.from("clients").update({ mb_run: next }).eq("id", c.id);
      if (error) return json({ error: error.message }, 500);
      return json({ run: next });
    }

    // action === "confirm" — server-side cap backstop, same shared evaluator
    // and same per-meal quantity logic the client gate uses.
    const violations = evaluateRunCaps(
      run,
      planSuggestions(c.mb_plan),
      enrichedLimits(c.mb_food_limits),
      legacyLimits(c.food_limits),
      RUN_DAYS,
    );
    if (violations.length > 0) {
      return json(
        {
          error: "cap_exceeded",
          message: violations.map(describeViolation).join(" "),
          violations,
        },
        409,
      );
    }

    const confirmed = { ...run, confirmed_on: new Date().toISOString().slice(0, 10) };
    const { error } = await admin.from("clients").update({ mb_run: confirmed }).eq("id", c.id);
    if (error) return json({ error: error.message }, 500);
    return json({ run: confirmed });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
