import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const Colour = z.enum(["blue", "green", "orange"]);
const RunMeal = z.object({
  colour: Colour,
  picks: z.record(z.string().max(120), z.string().max(200)),
});
const Run = z.object({
  colour: Colour.nullable(),
  started_on: z.string().max(20).nullable(),
  meals: z.object({
    breakfast: RunMeal.nullable(),
    lunch: RunMeal.nullable(),
    dinner: RunMeal.nullable(),
  }),
});
const Body = z.object({
  token: z.string().min(10).max(200),
  action: z.enum(["get", "save"]),
  run: Run.optional(),
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

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
      .select("id, client_type, mb_run")
      .eq("magic_token", token)
      .maybeSingle();
    if (!c) return json({ error: "invalid" }, 400);
    // MB-only surface.
    if (c.client_type !== "mb") return json({ error: "not_applicable" }, 400);

    if (action === "get") return json({ run: c.mb_run ?? {} });

    if (!run) return json({ error: "missing run" }, 400);
    const { error } = await admin.from("clients").update({ mb_run: run }).eq("id", c.id);
    if (error) return json({ error: error.message }, 500);
    return json({ run });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
