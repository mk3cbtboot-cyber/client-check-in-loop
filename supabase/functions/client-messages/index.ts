import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const AI_PLACEHOLDER =
  "Hi, I'm Cheryl's AI assistant. I'll check your plan for the answer. Once the plan search is ready, I'll point you to the exact section. If your question needs Cheryl's personal attention it will be passed through to her directly.";

const Body = z.object({
  token: z.string().min(10).max(200),
  action: z.enum(["list", "send"]),
  body: z.string().trim().min(1).max(4000).optional(),
});

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

    const { data: c } = await admin.from("clients").select("id, archived_at").eq("magic_token", token).maybeSingle();
    if (!c || c.archived_at) {
      return new Response(JSON.stringify({ error: "invalid_token" }), {
        status: 401,
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
      // Insert client message, then auto-insert AI placeholder reply.
      // Practitioner still receives the message (it's stored as 'client').
      await admin.from("messages").insert({ client_id: c.id, sender: "client", body });
      await admin.from("messages").insert({ client_id: c.id, sender: "ai", body: AI_PLACEHOLDER });
    }

    const { data: messages } = await admin
      .from("messages")
      .select("id, sender, body, created_at")
      .eq("client_id", c.id)
      .order("created_at", { ascending: true });

    return new Response(JSON.stringify({ messages: messages ?? [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
