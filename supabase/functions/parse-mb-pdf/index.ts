import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { extractText, getDocumentProxy } from "https://esm.sh/unpdf@0.12.1";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const Body = z.object({
  clientId: z.string().uuid(),
  storagePath: z.string().min(1).max(500),
});

// Field key conventions
const PHASE2_PROTEIN_CATEGORIES: Record<string, string> = {
  "Fish": "food_fish",
  "Seafood": "food_seafood",
  "Milk Products": "food_milk_products",
  "Milk products": "food_milk_products",
  "Yogurt": "food_yogurt",
  "Nuts": "food_nuts",
  "Meat": "food_meat",
  "Poultry": "food_poultry",
  "Cheese": "food_cheese",
  "Legumes": "food_legumes",
  "Pumpkin Seeds": "food_pumpkin_seeds",
  "Sunflower Seeds": "food_sunflower_seeds",
};

const PHASE2_CARB_CATEGORIES: Record<string, string> = {
  "Vegetables": "food_vegetables",
  "Veg./Lettuce": "food_veg_lettuce",
  "Veg. /Lettuce": "food_veg_lettuce",
  "Veg/Lettuce": "food_veg_lettuce",
  "Vegetable/Lettuce": "food_veg_lettuce",
  "Starch": "food_starch",
  "Bread": "food_bread",
  "Fruit": "food_fruit",
};

const PHASE3_CATEGORIES: Record<string, string> = {
  "Fish": "phase3_mb_fish",
  "Seafood": "phase3_mb_seafood",
  "Meat": "phase3_mb_meat",
  "Cheese": "phase3_mb_cheese",
  "Legumes": "phase3_mb_legumes",
  "Vegetables": "phase3_mb_vegetables",
  "Veg./Lettuce": "phase3_mb_veg_lettuce",
  "Veg. /Lettuce": "phase3_mb_veg_lettuce",
  "Veg/Lettuce": "phase3_mb_veg_lettuce",
  "Sprouts": "phase3_mb_sprouts",
  "Fat/Oil": "phase3_mb_fat_oil",
  "Fat / Oil": "phase3_mb_fat_oil",
};

function normalizeWater(raw: string): number | null {
  // Handles "2 ½", "2.5", "2,5", "2 1/2"
  const cleaned = raw.replace(/,/g, ".").trim();
  const fracMap: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75 };
  const m = cleaned.match(/^(\d+)\s*([½¼¾])?$/);
  if (m) return parseInt(m[1], 10) + (m[2] ? fracMap[m[2]] : 0);
  const m2 = cleaned.match(/^(\d+)\s+1\/(\d)$/);
  if (m2) return parseInt(m2[1], 10) + 1 / parseInt(m2[2], 10);
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Parse a "category: items" block from a chunk of lines. Returns map of fieldKey -> comma-joined items.
function parseFoodSection(text: string, categoryMap: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  // Build a regex that splits by category labels (case-sensitive at line start or after newline)
  const labels = Object.keys(categoryMap);
  // Sort by length desc so longer labels match first ("Pumpkin Seeds" before "Seeds")
  labels.sort((a, b) => b.length - a.length);
  const labelPattern = labels.map((l) => l.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")).join("|");
  const splitRe = new RegExp(`(?:^|\\n)\\s*(${labelPattern})\\s*[:\\-–]?\\s*`, "g");

  const matches: { label: string; start: number; contentStart: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = splitRe.exec(text)) !== null) {
    matches.push({ label: m[1], start: m.index, contentStart: m.index + m[0].length });
  }
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const end = i + 1 < matches.length ? matches[i + 1].start : text.length;
    const chunk = text.slice(cur.contentStart, end);
    // Split items on commas, semicolons, newlines, slashes (kept slashes for things like Squid/Octopus — but those are single tokens with no surrounding spaces, so prefer comma/newline splits)
    const items = chunk
      .split(/[,;\n]+/)
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      // Drop fragments that look like headings or page footers
      .filter((s) => s.length > 1 && s.length < 80 && !/Personal Food List|Additional Information|Page\s*\d|©|Metabolic Balance/i.test(s));
    const field = categoryMap[cur.label];
    if (!field) continue;
    const existing = result[field] ? result[field].split(",").map((s) => s.trim()).filter(Boolean) : [];
    const merged = Array.from(new Set([...existing, ...items]));
    if (merged.length) result[field] = merged.join(", ");
  }
  return result;
}

function parseMealTable(text: string) {
  // Look for the meal plan grams. Expect lines mentioning Breakfast, Lunch, Dinner with category + grams + veg grams.
  // Heuristic: scan for "Breakfast", "Lunch", "Dinner" sections individually.
  const out: Record<string, string | number | null> = {
    breakfast_protein_category: null, breakfast_protein_grams: null, breakfast_veg_grams: null,
    lunch_protein_category: null, lunch_protein_grams: null, lunch_veg_grams: null,
    dinner_protein_category: null, dinner_protein_grams: null, dinner_veg_grams: null,
  };

  const meals: Array<{ key: "breakfast" | "lunch" | "dinner"; label: string }> = [
    { key: "breakfast", label: "Breakfast" },
    { key: "lunch", label: "Lunch" },
    { key: "dinner", label: "Dinner" },
  ];

  for (const meal of meals) {
    // Try to find a window after the meal label up to the next meal label or 600 chars.
    const re = new RegExp(`${meal.label}([\\s\\S]{0,600}?)(?=Breakfast|Lunch|Dinner|Personal Food List|$)`, "i");
    const m = text.match(re);
    if (!m) continue;
    const chunk = m[1];
    // Find protein category and grams. Look for any known protein label followed by a number+g.
    const proteinLabels = Object.keys(PHASE2_PROTEIN_CATEGORIES);
    proteinLabels.sort((a, b) => b.length - a.length);
    for (const pl of proteinLabels) {
      const r = new RegExp(`(${pl.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")})[^\\d]{0,40}(\\d{2,4})\\s*g`, "i");
      const mm = chunk.match(r);
      if (mm) {
        out[`${meal.key}_protein_category`] = mm[1];
        out[`${meal.key}_protein_grams`] = parseFloat(mm[2]);
        break;
      }
    }
    // Veg grams
    const vegRe = /(Vegetables?|Veg\.?\s*\/?\s*Lettuce|Veg\/Lettuce)[^\d]{0,40}(\d{2,4})\s*g/i;
    const vm = chunk.match(vegRe);
    if (vm) out[`${meal.key}_veg_grams`] = parseFloat(vm[2]);
  }
  return out;
}

function parseEggs(text: string): { eggs_min_per_week: number | null; eggs_max_per_week: number | null } {
  // Common phrasings: "3-4 eggs per week", "min 2 max 4 eggs", "Eggs per week: 3-5"
  const m1 = text.match(/(\d+)\s*[-–]\s*(\d+)\s*eggs?\s*per\s*week/i);
  if (m1) return { eggs_min_per_week: +m1[1], eggs_max_per_week: +m1[2] };
  const m2 = text.match(/eggs?\s*per\s*week[^\d]{0,10}(\d+)\s*[-–]\s*(\d+)/i);
  if (m2) return { eggs_min_per_week: +m2[1], eggs_max_per_week: +m2[2] };
  const m3 = text.match(/min(?:imum)?[^\d]{0,10}(\d+)[^\d]{0,40}max(?:imum)?[^\d]{0,10}(\d+)\s*eggs/i);
  if (m3) return { eggs_min_per_week: +m3[1], eggs_max_per_week: +m3[2] };
  // Single number fallback
  const m4 = text.match(/(\d+)\s*eggs?\s*per\s*week/i);
  if (m4) return { eggs_min_per_week: +m4[1], eggs_max_per_week: +m4[1] };
  return { eggs_min_per_week: null, eggs_max_per_week: null };
}

function parseWater(text: string): number | null {
  // "2 ½ liters", "2.5 litres", "2,5 l", "2 1/2 liters", "drink 2.5 l"
  const re = /(\d+(?:[.,]\d+)?(?:\s*[½¼¾])?(?:\s*1\/\d)?)\s*(?:l(?:iters?|itres?)?|L)\b/i;
  const m = text.match(re);
  if (!m) return null;
  return normalizeWater(m[1]);
}

function sliceBetween(text: string, startAnchor: RegExp, endAnchor: RegExp | null): string | null {
  const s = text.search(startAnchor);
  if (s < 0) return null;
  const rest = text.slice(s);
  if (!endAnchor) return rest;
  const e = rest.slice(50).search(endAnchor); // skip past the start anchor itself
  return e < 0 ? rest : rest.slice(0, 50 + e);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten().fieldErrors }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { clientId, storagePath } = parsed.data;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const admin = createClient(supabaseUrl, serviceKey);

    // Verify ownership
    const { data: clientRow, error: cErr } = await admin
      .from("clients")
      .select("id, practitioner_id")
      .eq("id", clientId)
      .maybeSingle();
    if (cErr || !clientRow || clientRow.practitioner_id !== userData.user.id) {
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Download PDF
    const { data: file, error: dErr } = await admin.storage.from("mb-pdfs").download(storagePath);
    if (dErr || !file) {
      return new Response(JSON.stringify({ error: "pdf_not_found", detail: dErr?.message }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const buf = new Uint8Array(await file.arrayBuffer());
    const pdf = await getDocumentProxy(buf);
    const { text: pages } = await extractText(pdf, { mergePages: false });
    const fullText = Array.isArray(pages) ? pages.join("\n\n") : String(pages);

    // Locate sections
    const phase2ProteinSection = sliceBetween(fullText, /Personal Food List\s*[-–]\s*Protein/i, /Personal Food List\s*[-–]\s*Carbohydrates|Additional Information about the Meal Plan|\$\$CA_PHASE3\$\$/i);
    const phase2CarbSection = sliceBetween(fullText, /Personal Food List\s*[-–]\s*Carbohydrates/i, /Additional Information about the Meal Plan|\$\$CA_PHASE3\$\$/i);
    const additionalInfoSection = sliceBetween(fullText, /Additional Information about the Meal Plan/i, /\$\$CA_PHASE3\$\$|Extended personal Food List/i);
    const phase3Section = sliceBetween(fullText, /Extended personal Food List/i, null) ?? sliceBetween(fullText, /\$\$CA_PHASE3\$\$/i, null);

    // Meal table — the page just before phase 2 protein list. Use everything before the phase2 anchor.
    const mealTableEnd = fullText.search(/Personal Food List\s*[-–]\s*Protein/i);
    const mealTableText = mealTableEnd > 0 ? fullText.slice(Math.max(0, mealTableEnd - 4000), mealTableEnd) : fullText.slice(0, 4000);
    const mealGrams = parseMealTable(mealTableText);

    const phase2Proteins = phase2ProteinSection ? parseFoodSection(phase2ProteinSection, PHASE2_PROTEIN_CATEGORIES) : {};
    const phase2Carbs = phase2CarbSection ? parseFoodSection(phase2CarbSection, PHASE2_CARB_CATEGORIES) : {};
    const phase3 = phase3Section ? parseFoodSection(phase3Section, PHASE3_CATEGORIES) : {};

    let eggs = { eggs_min_per_week: null as number | null, eggs_max_per_week: null as number | null };
    let water: number | null = null;
    if (additionalInfoSection) {
      eggs = parseEggs(additionalInfoSection);
      water = parseWater(additionalInfoSection);
    }

    // Build response: each value + extracted flag
    const buildField = (v: unknown) => ({
      value: v ?? null,
      extracted: v !== null && v !== undefined && v !== "",
    });

    const phase2ProteinFields = Object.values(PHASE2_PROTEIN_CATEGORIES);
    const phase2CarbFields = Object.values(PHASE2_CARB_CATEGORIES);
    const phase3Fields = Object.values(PHASE3_CATEGORIES);
    const unique = (arr: string[]) => Array.from(new Set(arr));

    const result: Record<string, { value: unknown; extracted: boolean }> = {};
    for (const f of unique(phase2ProteinFields)) result[f] = buildField(phase2Proteins[f] ?? "");
    for (const f of unique(phase2CarbFields)) result[f] = buildField(phase2Carbs[f] ?? "");
    for (const f of unique(phase3Fields)) result[f] = buildField(phase3[f] ?? "");
    for (const k of Object.keys(mealGrams)) result[k] = buildField(mealGrams[k]);
    result.eggs_min_per_week = buildField(eggs.eggs_min_per_week);
    result.eggs_max_per_week = buildField(eggs.eggs_max_per_week);
    result.water_target_litres = buildField(water);

    return new Response(JSON.stringify({ fields: result, storagePath }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "parse_failed", detail: String((e as Error).message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
