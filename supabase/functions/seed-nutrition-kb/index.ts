import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// One-off seeding endpoint for the nutrition coaching knowledge base.
// Only writes when the table is still empty; removed after seeding.
Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { count } = await supabase
    .from("nutrition_coaching_kb")
    .select("id", { count: "exact", head: true });
  if ((count ?? 0) > 0) {
    return new Response(JSON.stringify({ error: "already seeded", count }), { status: 409 });
  }
  const articles = await req.json();
  if (!Array.isArray(articles) || articles.length === 0) {
    return new Response(JSON.stringify({ error: "no articles" }), { status: 400 });
  }
  const { error } = await supabase.from("nutrition_coaching_kb").insert(articles);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  return new Response(JSON.stringify({ ok: true, inserted: articles.length }));
});
