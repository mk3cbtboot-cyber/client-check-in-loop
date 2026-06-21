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
              "name", "phase", "batch_cooking_mode",
              "plan_format", "food_list", "food_list_notes", "meals_per_day",
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
              "eggs_min_per_week",
              "water_target_litres", "food_limits", "food_limit_counts",
            ].join(", "))

            .eq("id", c.id)
            .maybeSingle();
          console.log("ai_interceptor: after fetch client plan data", { has_full: !!full, fullErr });

          // Fetch this week's meal planner selections (if any).
          const _mondayOf = (d: Date) => {
            const dt = new Date(d);
            const day = (dt.getUTCDay() + 6) % 7;
            dt.setUTCDate(dt.getUTCDate() - day);
            return dt.toISOString().slice(0, 10);
          };
          const { data: weekPlan } = await admin
            .from("weekly_meal_plans")
            .select("breakfast_meal_id, lunch_meal_id, dinner_meal_id, breakfast_selections, lunch_selections, dinner_selections, breakfast_meal_id_alt, lunch_meal_id_alt, dinner_meal_id_alt, breakfast_selections_alt, lunch_selections_alt, dinner_selections_alt, confirmed_at")
            .eq("client_id", c.id)
            .eq("week_start_date", _mondayOf(new Date()))
            .maybeSingle();

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
          const isPhase4 = phase === "phase4";
          // Phase 4 uses the Phase 3 plan/foods (with oils) as its baseline.
          const isP3 = phase.includes("3") || isPhase4;
          const list = (v: unknown) => {
            if (Array.isArray(v)) return v.filter(Boolean).join(", ");
            if (typeof v === "string") return v.trim();
            return "";
          };

          // Source key -> client food column for the active phase.
          const sourceFoods = (src: string): string => {
            const map: Record<string, string> = isP3 ? {
              fish: list(f.phase3_mb_fish), seafood: list(f.phase3_mb_seafood),
              meat: list(f.phase3_mb_meat), cheese: list(f.phase3_mb_cheese),
              legumes: list(f.phase3_mb_legumes),
              vegetables: list(f.phase3_mb_vegetables), vegLettuce: list(f.phase3_mb_veg_lettuce),
              poultry: "", yogurt: "", milkProducts: "",
              fruit: list(f.food_fruit), bread: list(f.food_bread), starch: list(f.food_starch),
            } : {
              fish: list(f.food_fish), seafood: list(f.food_seafood),
              poultry: list(f.food_poultry), meat: list(f.food_meat),
              cheese: list(f.food_cheese), legumes: list(f.food_legumes),
              yogurt: list(f.food_yogurt), milkProducts: list(f.food_milk_products),
              vegetables: list(f.food_vegetables), vegLettuce: list(f.food_veg_lettuce),
              fruit: list(f.food_fruit), bread: list(f.food_bread), starch: list(f.food_starch),
            };
            return map[src] || "";
          };

          // Embedded MB option catalogue (must stay in sync with src/lib/mb-foods.ts).
          type Comp = { key: string; label: string; qty: string; sources: string[]; optional?: boolean };
          type Opt = { id: number; label: string; components: Comp[]; fixed?: { label: string; qty: string }[] };
          const MB_OPTIONS: Record<"breakfast" | "lunch" | "dinner", Opt[]> = {
            breakfast: [
              { id: 1, label: "Yogurt + Fruit", components: [
                { key: "yogurt", label: "Yogurt", qty: "200g", sources: ["yogurt"] },
                { key: "fruit", label: "Fruit", qty: "as listed", sources: ["fruit"] },
              ]},
              { id: 2, label: "Milk + Oatmeal + Fruit", components: [
                { key: "milk", label: "Milk", qty: "200ml", sources: ["milkProducts"] },
                { key: "oats", label: "Oatmeal", qty: "50g", sources: ["starch"] },
                { key: "fruit", label: "Fruit", qty: "as listed", sources: ["fruit"] },
              ]},
              { id: 3, label: "Poultry + Veg/Lettuce + Fruit + Bread", components: [
                { key: "poultry", label: "Poultry", qty: "85g", sources: ["poultry"] },
                { key: "veg1", label: "Vegetable", qty: "95g (combined)", sources: ["vegetables","vegLettuce"] },
                { key: "veg2", label: "Vegetable 2 (optional)", qty: "", sources: ["vegetables","vegLettuce"], optional: true },
                { key: "fruit", label: "Fruit", qty: "as listed", sources: ["fruit"] },
                { key: "bread", label: "Bread", qty: "as listed", sources: ["bread"] },
              ]},
            ],
            lunch: [
              { id: 1, label: "Eggs + Vegetables + Fruit + Bread", fixed: [{ label: "Eggs", qty: "2 eggs" }], components: [
                { key: "veg1", label: "Vegetables", qty: "140g (combined)", sources: ["vegetables"] },
                { key: "veg2", label: "Vegetable 2 (optional)", qty: "", sources: ["vegetables"], optional: true },
                { key: "fruit", label: "Fruit", qty: "as listed", sources: ["fruit"] },
                { key: "bread", label: "Bread", qty: "as listed", sources: ["bread"] },
              ]},
              { id: 2, label: "Legumes + Vegetables + Fruit + Bread", components: [
                { key: "legumes", label: "Legumes", qty: "75g", sources: ["legumes"] },
                { key: "veg1", label: "Vegetables", qty: "140g (combined)", sources: ["vegetables"] },
                { key: "veg2", label: "Vegetable 2 (optional)", qty: "", sources: ["vegetables"], optional: true },
                { key: "fruit", label: "Fruit", qty: "as listed", sources: ["fruit"] },
                { key: "bread", label: "Bread", qty: "as listed", sources: ["bread"] },
              ]},
              { id: 3, label: "Cheese + Vegetables + Fruit + Bread", components: [
                { key: "cheese", label: "Cheese", qty: "85g", sources: ["cheese"] },
                { key: "veg1", label: "Vegetables", qty: "140g (combined)", sources: ["vegetables"] },
                { key: "veg2", label: "Vegetable 2 (optional)", qty: "", sources: ["vegetables"], optional: true },
                { key: "fruit", label: "Fruit", qty: "as listed", sources: ["fruit"] },
                { key: "bread", label: "Bread", qty: "as listed", sources: ["bread"] },
              ]},
            ],
            dinner: [
              { id: 1, label: "Fish + Veg/Lettuce + Fruit + Bread", components: [
                { key: "fish", label: "Fish or Seafood", qty: "140g", sources: ["fish","seafood"] },
                { key: "veg1", label: "Vegetables", qty: "150g (combined)", sources: ["vegetables","vegLettuce"] },
                { key: "veg2", label: "Vegetable 2 (optional)", qty: "", sources: ["vegetables","vegLettuce"], optional: true },
                { key: "fruit", label: "Fruit", qty: "as listed", sources: ["fruit"] },
                { key: "bread", label: "Bread", qty: "as listed", sources: ["bread"] },
              ]},
              { id: 2, label: "Poultry + Vegetables + Fruit + Bread", components: [
                { key: "poultry", label: "Poultry", qty: "140g", sources: ["poultry"] },
                { key: "veg1", label: "Vegetables", qty: "150g (combined)", sources: ["vegetables"] },
                { key: "veg2", label: "Vegetable 2 (optional)", qty: "", sources: ["vegetables"], optional: true },
                { key: "fruit", label: "Fruit", qty: "as listed", sources: ["fruit"] },
                { key: "bread", label: "Bread", qty: "as listed", sources: ["bread"] },
              ]},
              { id: 3, label: "Meat + Vegetables + Fruit + Bread", components: [
                { key: "meat", label: "Meat", qty: "140g", sources: ["meat"] },
                { key: "veg1", label: "Vegetables", qty: "150g (combined)", sources: ["vegetables"] },
                { key: "veg2", label: "Vegetable 2 (optional)", qty: "", sources: ["vegetables"], optional: true },
                { key: "fruit", label: "Fruit", qty: "as listed", sources: ["fruit"] },
                { key: "bread", label: "Bread", qty: "as listed", sources: ["bread"] },
              ]},
            ],
          };

          const componentLine = (comp: Comp, selection: any): string => {
            // Foods available for this component, drawn ONLY from the client's plan.
            const fromSources = comp.sources
              .map(sourceFoods)
              .filter((s) => s.length > 0)
              .join(", ");
            const selectedFood = selection && typeof selection[comp.key] === "string" ? selection[comp.key] : "";
            const foods = selectedFood || fromSources || "(none listed in plan)";
            const qty = comp.qty ? ` at ${comp.qty}` : "";
            return `${comp.label}: ${foods}${qty}`;
          };

          const describeSlot = (slot: "breakfast" | "lunch" | "dinner"): string => {
            const opts = MB_OPTIONS[slot];
            const mealId: number | null = (weekPlan as any)?.[`${slot}_meal_id`] ?? null;
            const selections = (weekPlan as any)?.[`${slot}_selections`] ?? null;
            const label = slot.charAt(0).toUpperCase() + slot.slice(1);

            if (mealId) {
              const opt = opts.find((o) => o.id === mealId);
              if (opt) {
                const parts: string[] = [];
                if (opt.fixed) for (const fx of opt.fixed) parts.push(`${fx.label}: ${fx.qty}`);
                for (const comp of opt.components) {
                  if (comp.optional && !(selections && selections[comp.key])) continue;
                  parts.push(componentLine(comp, selections));
                }
                return `- ${label}: ${opt.label} — ${parts.join("; ")}`;
              }
            }

            // Fallback: no meal selected for this slot — list every available option for the slot.
            const optionLines = opts.map((opt) => {
              const parts: string[] = [];
              if (opt.fixed) for (const fx of opt.fixed) parts.push(`${fx.label}: ${fx.qty}`);
              for (const comp of opt.components) {
                if (comp.optional) continue;
                parts.push(componentLine(comp, null));
              }
              return `    Option ${opt.id} — ${opt.label}: ${parts.join("; ")}`;
            }).join("\n");
            return `- ${label} (no meal selected — available options):\n${optionLines}`;
          };

          // Build a Phase 2 personal food list summary (parsed from PDF) for inclusion in plan context.
          const phase2Cats = Array.isArray(f.phase2_food_list)
            ? (f.phase2_food_list as any[])
                .filter((c) => c && typeof c.title === "string" && Array.isArray(c.items))
                .map((c) => ({ title: String(c.title), items: (c.items as unknown[]).filter((i) => typeof i === "string") as string[] }))
            : [];
          const phase2Summary = phase2Cats.length
            ? phase2Cats.map((c) => `  - ${c.title}: ${c.items.join(", ")}`).join("\n")
            : "  (no Phase 2 food list parsed)";

          // Phase 3 extended list (oils included).
          const phase3Pairs: Array<[string, string]> = [
            ["Fish", list(f.phase3_mb_fish)],
            ["Seafood", list(f.phase3_mb_seafood)],
            ["Meat", list(f.phase3_mb_meat)],
            ["Cheese", list(f.phase3_mb_cheese)],
            ["Legumes", list(f.phase3_mb_legumes)],
            ["Vegetables", list(f.phase3_mb_vegetables)],
            ["Veg/Lettuce", list(f.phase3_mb_veg_lettuce)],
            ["Sprouts", list(f.phase3_mb_sprouts)],
            ["Oils (Cold-Pressed)", list(f.phase3_mb_fat_oil)],
          ];
          const phase3Summary = phase3Pairs.filter(([, v]) => v).map(([k, v]) => `  - ${k}: ${v}`).join("\n")
            || "  (no Phase 3 extended list parsed)";

          const MB_RULES_TEXT = [
            "1. Eat only 3 meals a day with no snacks in between.",
            "2. Leave at least 5 hours between meals.",
            "3. Do not eat for longer than 60 minutes per meal.",
            "4. Start every meal with a bite of protein.",
            "5. Eat only one type of protein per meal.",
            "6. Eat one piece of fruit with every meal (eaten last).",
            "7. Drink 2.5+ litres of still water or unsweetened tea per day.",
            "8. Finish your last meal before 9pm.",
          ].join("\n");

          const planSummary = [
            `Client name: ${f.name ?? "(unknown)"}`,
            `Phase: ${f.phase ?? "(unknown)"}`,
            `Batch cooking mode: ${f.batch_cooking_mode ?? "(unknown)"}`,
            (weekPlan as any)?.confirmed_at ? "Meal planner: confirmed for this week" : "Meal planner: not confirmed",
            "",
            "MEAL PLAN — each slot below shows ONLY the foods that belong to that slot. Do NOT move foods between slots.",
            describeSlot("breakfast"),
            describeSlot("lunch"),
            describeSlot("dinner"),
            "",
            `Eggs minimum per week: ${f.eggs_min_per_week ?? "?"}`,
            `Water target: ${f.water_target_litres ?? "?"} litres/day`,
            f.food_limits && Object.keys(f.food_limits).length
              ? `Weekly food limits: ${JSON.stringify(f.food_limits)}` : "",
            f.food_limit_counts && Object.keys(f.food_limit_counts).length
              ? `Used this week: ${JSON.stringify(f.food_limit_counts)}` : "",
            "",
            "PHASE 2 — PERSONAL FOOD LIST (parsed from the client's MB PDF):",
            phase2Summary,
            "",
            "PHASE 3 — EXTENDED FOOD LIST (parsed from the client's MB PDF, includes oils):",
            phase3Summary,
            "",
            "THE 8 METABOLIC BALANCE RULES (apply at all times):",
            MB_RULES_TEXT,
            "",
            "TREAT MEAL GUIDANCE: Phase 2 Extended allows up to 1 treat meal per week. Phase 3 allows up to 1 treat meal per week. Phase 4 (Maintenance) allows up to 3 treat meals per week.",
          ].filter(Boolean).join("\n");

          const systemPrompt = [
            "You are the AI assistant for a Metabolic Balance nutrition practitioner, answering the client's question about their personal plan.",
            "Answer ONLY from the client's parsed meal plan data provided below (meal slots, Phase 2 list, Phase 3 list, 8 Rules, treat meal guidance). Do NOT infer, speculate, or suggest anything not in this data.",
            "When a client asks about a specific food, find which meal slot(s) or food list contain that food category. Report only those slots/lists and the exact portion specified.",
            "NEVER suggest that a food in one meal slot can substitute for a food in a different meal slot or category. Do NOT compare proteins to dairy, seeds, or any other category.",
            "If a food category has multiple options, list the options and the single portion that applies. The portion is the same regardless of which option the client chooses.",
            "If the food is genuinely not anywhere in the client's plan, say so plainly: \"That food is not in your meal plan.\"",
            "Be specific: name the foods and quantities from their plan. Keep the reply to 2-4 short sentences, warm and clear.",
            isPhase4
              ? "This client is in Phase 4 — Maintenance. They have completed the program. Use their Phase 2 personal food list, Phase 3 extended list (including oils), the 8 Metabolic Balance Rules, and treat meal guidance (up to 3 treat meals per week) as your full reference. The PDF data above is comprehensive — answer any question that can be answered from it. NEVER tell the client you've passed their question to the practitioner, NEVER say you'll forward it, and NEVER suggest they wait for a human reply. If the answer truly isn't in the plan data, give the best general Metabolic Balance maintenance guidance consistent with what's in the plan."
              : `Only fall back to "${AI_FALLBACK}" if the question genuinely cannot be answered from the plan data (e.g. it's about supplements, medical advice, or something not covered).`,
          ].join(" ");


          const lovableKey = Deno.env.get("LOVABLE_API_KEY");
          console.log("ai_interceptor: lovableKey present?", !!lovableKey);
          let aiAnswer = isPhase4
            ? "I couldn't generate an answer right now — please try again in a moment."
            : AI_FALLBACK;

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
          const clientFacing = isPhase4
            ? `${assistantLabel}: ${aiAnswer}`
            : `${assistantLabel}: ${aiAnswer}\n\nI've also passed your question on to ${practName} in case they'd like to add anything.`;
          console.log("ai_interceptor: before insert client-facing message");
          const { error: insErr1 } = await admin.from("messages").insert({ client_id: c.id, sender: "ai", body: clientFacing });
          console.log("ai_interceptor: after insert client-facing message", { insErr1 });

          // Practitioner-facing summary so they know this was AI-answered.
          // Skipped entirely for Phase 4 — messages are not forwarded to the practitioner.
          if (!isPhase4) {
            const practFacing = `[AI-answered — for practitioner review]\nClient asked: ${body}\n\nAI replied: ${aiAnswer}`;
            console.log("ai_interceptor: before insert practitioner-facing message");
            const { error: insErr2 } = await admin.from("messages").insert({ client_id: c.id, sender: "ai", body: practFacing });
            console.log("ai_interceptor: after insert practitioner-facing message", { insErr2 });
          }
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
