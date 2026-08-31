import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_ACTIVE = 10;

const Body = z.object({
  token: z.string().min(10).max(200),
  action: z.enum(["list", "submit"]).default("list"),
  foods: z.array(z.string().min(1).max(80)).max(10).optional(),
});

type Classification = { classification: "whole_food" | "processed_or_meal"; reason: string };

const COMPOSITE_HINTS = [
  "pizza", "taco", "lasagna", "burrito", "sandwich", "burger", "pasta bake", "casserole",
  "curry", "stew", "soup", "pie", "cake", "cookie", "protein bar", "granola bar", "cereal",
  "sauce", "dressing", "chips", "crisps", "nuggets", "parmesan", "parmigiana", "wrap",
  "smoothie", "shake", "bolognese", "sushi roll", "stir fry", "stir-fry", "salad",
];

function heuristic(name: string): Classification {
  const n = name.toLowerCase().trim();
  if (COMPOSITE_HINTS.some((h) => n.includes(h))) {
    return {
      classification: "processed_or_meal",
      reason: "This looks like a prepared dish or processed product rather than a single ingredient.",
    };
  }
  if (/( with | and |,|\+| in )/.test(n)) {
    return {
      classification: "processed_or_meal",
      reason: "This looks like more than one food. Please submit one whole food at a time.",
    };
  }
  return { classification: "whole_food", reason: "Single, minimally processed ingredient." };
}

async function classify(names: string[]): Promise<Record<string, Classification>> {
  const out: Record<string, Classification> = {};
  for (const n of names) out[n] = heuristic(n);

  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) return out;

  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3.5-flash",
        messages: [
          {
            role: "system",
            content:
              "You classify foods a client wants to reintroduce. A WHOLE FOOD is a single, minimally processed ingredient (salmon, sweet potato, cottage cheese, butter, strawberry, pork chop). A PROCESSED_OR_MEAL item has multiple ingredients or is significantly processed (pizza, tacos, lasagna, chicken parmesan, protein bars). Return one classification per food with a one-sentence plain-English reason.",
          },
          { role: "user", content: `Classify these foods:\n${names.map((f) => `- ${f}`).join("\n")}` },
        ],
        tools: [{
          type: "function",
          function: {
            name: "return_classifications",
            description: "Return a classification for each food.",
            parameters: {
              type: "object",
              properties: {
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      food: { type: "string" },
                      classification: { type: "string", enum: ["whole_food", "processed_or_meal"] },
                      reason: { type: "string" },
                    },
                    required: ["food", "classification", "reason"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["items"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "return_classifications" } },
      }),
    });
    if (!resp.ok) return out;
    const json = await resp.json();
    const args = json?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    const parsed = typeof args === "string" ? JSON.parse(args) : args;
    for (const it of parsed?.items ?? []) {
      const match = names.find((n) => n.toLowerCase() === String(it.food ?? "").toLowerCase());
      if (!match) continue;
      if (it.classification === "whole_food" || it.classification === "processed_or_meal") {
        out[match] = { classification: it.classification, reason: String(it.reason ?? "").slice(0, 300) };
      }
    }
  } catch (e) {
    console.error("phase3_classify_failed", e);
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return json({ error: "invalid" }, 400);
    const { token, action, foods } = parsed.data;

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: c } = await admin
      .from("clients")
      .select("id, name, phase, system_mode")
      .eq("magic_token", token)
      .maybeSingle();
    if (!c) return json({ error: "not_found" }, 404);

    const loadAll = async () => {
      const { data } = await admin
        .from("phase3_food_requests")
        .select("id, food_name, ai_classification, ai_reason, status, practitioner_note, swap_suggestion, created_at, reviewed_at")
        .eq("client_id", c.id)
        .order("created_at", { ascending: false });
      return data ?? [];
    };

    if (action === "list") {
      const requests = await loadAll();
      const active = requests.filter((r: any) => r.status !== "declined").length;
      return json({ requests, active, max: MAX_ACTIVE });
    }

    // submit
    if (c.phase !== "phase3") return json({ error: "not_phase3" }, 400);
    if (String(c.system_mode ?? "") === "own_practice") return json({ error: "not_mb" }, 400);

    const names = Array.from(
      new Set((foods ?? []).map((f) => f.trim()).filter(Boolean).map((f) => f.replace(/\s+/g, " ")))
    );
    if (!names.length) return json({ error: "no_foods" }, 400);

    const existing = await loadAll();
    const activeCount = existing.filter((r: any) => r.status !== "declined").length;
    const room = MAX_ACTIVE - activeCount;
    if (room <= 0) return json({ error: "limit_reached", active: activeCount, max: MAX_ACTIVE }, 400);
    const accepted = names.slice(0, room);

    const classified = await classify(accepted);
    const rows = accepted.map((n) => ({
      client_id: c.id,
      food_name: n,
      ai_classification: classified[n].classification,
      ai_reason: classified[n].reason,
      status: classified[n].classification === "whole_food" ? "pending_practitioner_review" : "needs_resubmit",
    }));
    const { error: insErr } = await admin.from("phase3_food_requests").insert(rows);
    if (insErr) return json({ error: "insert_failed" }, 500);

    // Always forward to the practitioner as a normal message — nothing is hidden.
    await admin.from("messages").insert({
      client_id: c.id,
      sender: "client",
      body:
        `Phase 3 food request — I'd like to test these foods:\n` +
        rows.map((r) => `• ${r.food_name}${r.ai_classification === "processed_or_meal" ? " (flagged: not a single whole food)" : ""}`).join("\n"),
      deferred: false,
    });

    const requests = await loadAll();
    return json({
      requests,
      active: requests.filter((r: any) => r.status !== "declined").length,
      max: MAX_ACTIVE,
      skipped: names.length - accepted.length,
    });
  } catch (e) {
    console.error("phase3_food_requests_error", e);
    return json({ error: "server_error" }, 500);
  }
});
