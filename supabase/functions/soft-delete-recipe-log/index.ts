import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const Body = z.object({
  recipe_id: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return json({ error: "A reason is required to remove a log entry." }, 400);
    const { recipe_id, reason } = parsed.data;

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "Not authenticated" }, 401);

    const authed = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await authed.auth.getUser();
    const user = userData?.user;
    if (!user) return json({ error: "Not authenticated" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: row } = await admin
      .from("recipes")
      .select("id, client_id, deleted_at")
      .eq("id", recipe_id)
      .maybeSingle();
    if (!row) return json({ error: "Log entry not found" }, 404);
    if (row.deleted_at) return json({ error: "This log entry has already been removed." }, 409);

    const { data: client } = await admin
      .from("clients")
      .select("id, practitioner_id")
      .eq("id", row.client_id)
      .maybeSingle();
    if (!client || client.practitioner_id !== user.id) {
      return json({ error: "Not authorised" }, 403);
    }

    const { error: updErr } = await admin
      .from("recipes")
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: user.id,
        delete_reason: reason,
      })
      .eq("id", recipe_id)
      .is("deleted_at", null);
    if (updErr) throw updErr;

    return json({ ok: true });
  } catch (e) {
    console.error("soft-delete-recipe-log error:", e);
    return json({ error: e instanceof Error ? e.message : "error" }, 500);
  }
});
