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

      // AI interceptor: fires on every inbound client message that looks like a plan question.
      const lower = body.toLowerCase();
      const phrases = [
        "can i", "am i allowed", "what is", "what's", "how much", "how many",
        "is it ok", "is it okay", "what can", "how do i", "how should i",
        "when should", "do i need", "should i", "could i", "may i",
        "are there", "is there", "do you", "will i", "why is", "why does",
      ];
      const hasQuestion = body.includes("?") || phrases.some((p) => lower.includes(p));

      if (hasQuestion) {
        try {
          console.log("ai_interceptor: start", { client_id: c.id, body_preview: body.slice(0, 80) });
          // Fetch full parsed plan data + client/practitioner names.
          console.log("ai_interceptor: before fetch client plan data");
          const { data: full, error: fullErr } = await admin
            .from("clients")
            .select([
              "name", "phase",
              "breakfast_protein_category", "breakfast_protein_grams", "breakfast_veg_grams",
              "lunch_protein_category", "lunch_protein_grams", "lunch_veg_grams",
              "dinner_protein_category", "dinner_protein_grams", "dinner_veg_grams",
              "food_fish", "food_seafood", "food_milk_products", "food_yogurt", "food_nuts",
              "food_meat", "food_poultry", "food_cheese", "food_legumes",
              "food_pumpkin_seeds", "food_sunflower_seeds",
              "food_vegetables", "food_veg_lettuce", "food_starch", "food_bread", "food_fruit",
              "phase2_food_list",
              "phase3_mb_fish", "phase3_mb_seafood", "phase3_mb_meat", "phase3_mb_cheese",
              "phase3_mb_legumes", "phase3_mb_vegetables", "phase3_mb_veg_lettuce",
              "phase3_mb_sprouts", "phase3_mb_fat_oil",
              "eggs_min_per_week", "eggs_max_per_week",
              "water_target_litres", "weekly_food_limits",
            ].join(", "))
            .eq("id", c.id)
            .maybeSingle();
          console.log("ai_interceptor: after fetch client plan data", { has_full: !!full, fullErr });

          console.log("ai_interceptor: before fetch practitioner profile");
          const { data: practProf, error: practErr } = await admin
            .from("profiles")
            .select("email, display_name")
            .eq("id", c.practitioner_id)
            .maybeSingle();
          console.log("ai_interceptor: after fetch practitioner profile", { has_practProf: !!practProf, practErr });
          const firstNameFromEmail = (email: string | null | undefined): string | null => {
            if (!email || typeof email !== "string") return null;
            const local = email.split("@")[0] ?? "";
            const letters = local.replace(/[^A-Za-z]/g, "");
            if (!letters) return null;
            return letters.charAt(0).toUpperCase() + letters.slice(1).toLowerCase();
          };
          const practName = (practProf?.display_name && practProf.display_name.trim())
            ? practProf.display_name.trim()
            : (firstNameFromEmail(practProf?.email) ?? "your practitioner");


          // Build a readable, structured plan summary for the LLM rather than dumping raw JSON.
          const f: any = full ?? {};
          const phase = String(f.phase ?? "").toLowerCase();
          const isP3 = phase.includes("3");
          const list = (v: unknown) => {
            if (Array.isArray(v)) return v.filter(Boolean).join(", ");
            if (typeof v === "string") return v.trim();
            return "";
          };
          const meal = (label: string, cat: any, pg: any, vg: any) =>
            `- ${label}: protein category = ${cat || "(not set)"}, protein = ${pg ?? "?"} g, vegetables = ${vg ?? "?"} g`;

          const proteinCats = isP3
            ? {
                Fish: f.phase3_mb_fish, Seafood: f.phase3_mb_seafood, Meat: f.phase3_mb_meat,
                Cheese: f.phase3_mb_cheese, Legumes: f.phase3_mb_legumes,
              }
            : {
                Fish: f.food_fish, Seafood: f.food_seafood, "Milk products": f.food_milk_products,
                Yogurt: f.food_yogurt, Nuts: f.food_nuts, Meat: f.food_meat, Poultry: f.food_poultry,
                Cheese: f.food_cheese, Legumes: f.food_legumes,
                "Pumpkin seeds": f.food_pumpkin_seeds, "Sunflower seeds": f.food_sunflower_seeds,
              };
          const carbCats = isP3
            ? { Vegetables: f.phase3_mb_vegetables, "Veg / lettuce": f.phase3_mb_veg_lettuce, Sprouts: f.phase3_mb_sprouts, "Fat / oil": f.phase3_mb_fat_oil }
            : { Vegetables: f.food_vegetables, "Veg / lettuce": f.food_veg_lettuce, Starch: f.food_starch, Bread: f.food_bread, Fruit: f.food_fruit };

          const fmtCats = (obj: Record<string, unknown>) =>
            Object.entries(obj)
              .map(([k, v]) => `  • ${k}: ${list(v) || "(none listed)"}`)
              .join("\n");

          const planSummary = [
            `Client name: ${f.name ?? "(unknown)"}`,
            `Phase: ${f.phase ?? "(unknown)"}`,
            "",
            "Meal plan (per meal):",
            meal("Breakfast", f.breakfast_protein_category, f.breakfast_protein_grams, f.breakfast_veg_grams),
            meal("Lunch",     f.lunch_protein_category,     f.lunch_protein_grams,     f.lunch_veg_grams),
            meal("Dinner",    f.dinner_protein_category,    f.dinner_protein_grams,    f.dinner_veg_grams),
            "",
            "Allowed PROTEIN foods (grouped by category — the client may eat any item listed in their assigned category for that meal):",
            fmtCats(proteinCats),
            "",
            "Allowed CARBOHYDRATE / VEGETABLE foods:",
            fmtCats(carbCats),
            "",
            `Eggs: min ${f.eggs_min_per_week ?? "?"} / max ${f.eggs_max_per_week ?? "?"} per week`,
            `Water target: ${f.water_target_litres ?? "?"} litres/day`,
            f.weekly_food_limits ? `Weekly food limits: ${JSON.stringify(f.weekly_food_limits)}` : "",
          ].filter(Boolean).join("\n");

          const systemPrompt = [
            "You are the AI assistant for a Metabolic Balance nutrition practitioner, answering the client's question about their personal plan.",
            "Use ONLY the plan data provided below. Treat every food listed under a category as ALLOWED for that client when that category is assigned to a meal.",
            "Substitution rule: if the client asks whether they can swap one food for another (e.g. 'chicken thighs instead of chicken breast'), check whether the requested food appears in the same category (e.g. Poultry, Fish, Meat) as the food they're replacing. If yes, answer YES and remind them to keep the same gram amount shown for that meal. If no, answer NO and suggest items from the correct category that ARE on their list.",
            "Be specific: name the foods and quantities from their plan. Keep the reply to 2-4 short sentences, warm and clear.",
            `Only fall back to "${AI_FALLBACK}" if the question genuinely cannot be answered from the plan data (e.g. it's about supplements, medical advice, or something not covered).`,
          ].join(" ");

          const lovableKey = Deno.env.get("LOVABLE_API_KEY");
          console.log("ai_interceptor: lovableKey present?", !!lovableKey);
          let aiAnswer = AI_FALLBACK;
          if (lovableKey) {
          console.log("ai_interceptor: before AI gateway fetch");
            console.log("ai_interceptor: gateway_request_body", JSON.stringify({
              model: "google/gemini-2.5-flash",
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `CLIENT PLAN DATA:\n${planSummary}\n\nCLIENT QUESTION:\n${body}` },
              ],
            }));
            const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${lovableKey}`,
              },
              body: JSON.stringify({
                model: "google/gemini-2.5-flash",
                messages: [
                  { role: "system", content: systemPrompt },
                  { role: "user", content: `CLIENT PLAN DATA:\n${planSummary}\n\nCLIENT QUESTION:\n${body}` },
                ],
              }),
            });
            console.log("ai_interceptor: after AI gateway fetch", { status: aiRes.status, ok: aiRes.ok });
            if (aiRes.ok) {
              console.log("ai_interceptor: before parse AI response json");
              const j = await aiRes.json();
              console.log("ai_interceptor: after parse AI response json", { has_choice: !!j?.choices?.[0]?.message?.content });
              const text = j?.choices?.[0]?.message?.content;
              if (typeof text === "string" && text.trim()) aiAnswer = text.trim();
            } else {
              console.log("ai_interceptor: AI gateway non-ok body", await aiRes.text());
            }
          }

          const assistantLabel = `${practName}'s AI Assistant`;
          const clientFacing = `${assistantLabel}: ${aiAnswer}\n\nI've also passed your question on to ${practName} in case they'd like to add anything.`;
          console.log("ai_interceptor: before insert client-facing message");
          const { error: insErr1 } = await admin.from("messages").insert({ client_id: c.id, sender: "ai", body: clientFacing });
          console.log("ai_interceptor: after insert client-facing message", { insErr1 });

          // Practitioner-facing summary so they know this was AI-answered.
          const practFacing = `[AI-answered — for practitioner review]\nClient asked: ${body}\n\nAI replied: ${aiAnswer}`;
          console.log("ai_interceptor: before insert practitioner-facing message");
          const { error: insErr2 } = await admin.from("messages").insert({ client_id: c.id, sender: "ai", body: practFacing });
          console.log("ai_interceptor: after insert practitioner-facing message", { insErr2 });
        } catch (e) {
          console.error("ai_interceptor_failed", e);
        }
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
    const out = (messages ?? []).filter((m: any) => {
      // Practitioner-facing AI summaries should not appear in the client's thread.
      if (m.sender === "ai" && typeof m.body === "string" && m.body.includes("[AI-answered — for practitioner review]")) {
        return false;
      }
      return true;
    }).map((m: any) => {
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
