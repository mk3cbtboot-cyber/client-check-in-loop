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

// Patterns that mark the end of a food list chunk regardless of category labels.
// Includes page footers (e.g. "Carson Visser | © Metabolic Balance"), page numbers,
// section headings, and instructional notes.
const CHUNK_END_PATTERNS: RegExp[] = [
  /\|\s*©/i,
  /©\s*Metabolic Balance/i,
  /Page\s*\d+\s*(?:of\s*\d+)?/i,
  /Personal Food List/i,
  /Additional Information about the Meal Plan/i,
  /Extended personal Food List/i,
  /\$\$CA_PHASE3\$\$/i,
  /From now on you have sprouts/i,
  /From now on,?\s*you/i,
  /Please note/i,
  /\bNote:\s/i,
];

function truncateAtBoundary(chunk: string): string {
  let cut = chunk.length;
  for (const re of CHUNK_END_PATTERNS) {
    const m = chunk.match(re);
    if (m && m.index !== undefined && m.index < cut) cut = m.index;
  }
  return chunk.slice(0, cut);
}

// Parse a "category: items" block from a chunk of lines. Returns map of fieldKey -> comma-joined items.
function parseFoodSection(text: string, categoryMap: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  const labels = Object.keys(categoryMap);
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
    let chunk = text.slice(cur.contentStart, end);
    // Stop at boilerplate / page footer / instructional notes before the next category label.
    chunk = truncateAtBoundary(chunk);
    const items = chunk
      .split(/[,;\n]+/)
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .filter((s) => {
        if (s.length < 2 || s.length > 60) return false;
        if (/Personal Food List|Additional Information|Extended personal|Page\s*\d|©|Metabolic Balance|From now on|Please note|\bNote:/i.test(s)) return false;
        if (!/[A-Za-z]/.test(s)) return false;
        // Drop sentence-like fragments
        if (/\.\s+[a-z]/.test(s)) return false;
        if (s.split(/\s+/).length > 5) return false;
        return true;
      });
    const field = categoryMap[cur.label];
    if (!field) continue;
    const existing = result[field] ? result[field].split(",").map((s) => s.trim()).filter(Boolean) : [];
    const merged = Array.from(new Set([...existing, ...items]));
    if (merged.length) result[field] = merged.join(", ");
  }
  return result;
}

type MealOption = {
  protein_category: string | null;
  protein_grams: number | null;
  veg_grams: number | null;
  has_fruit: boolean;
  has_bread: boolean;
};

type MealKey = "breakfast" | "lunch" | "dinner";
type MealOptionsMap = Record<MealKey, MealOption[]>;

const EMPTY_OPTION = (): MealOption => ({
  protein_category: null,
  protein_grams: null,
  veg_grams: null,
  has_fruit: false,
  has_bread: false,
});

const VEG_LABEL_RE = /^(?:Vegetables?|Veg\.?\s*\/?\s*Lettuce|Veg\/Lettuce|Vegetable\/Lettuce)$/i;

function isVegLabel(label: string): boolean {
  return VEG_LABEL_RE.test(label.trim());
}

function isProteinLabel(label: string): boolean {
  const lc = label.trim().toLowerCase();
  return Object.keys(PHASE2_PROTEIN_CATEGORIES).some((k) => k.toLowerCase() === lc);
}

function extractMealChunk(text: string, label: string): string {
  const re = new RegExp(`\\b${label}\\b([\\s\\S]*?)(?=\\b(?:Breakfast|Lunch|Dinner)\\b|Personal Food List|$)`, "i");
  const m = text.match(re);
  return m ? m[1] : "";
}

function parseMealOptions(chunk: string): MealOption[] {
  const options: MealOption[] = [EMPTY_OPTION(), EMPTY_OPTION(), EMPTY_OPTION()];
  if (!chunk) return options;

  // Collect all "<grams> g <Label>" matches in order across the flattened columns.
  // Order = column-major (left to right across the 3 option columns), so the
  // 1st protein match belongs to option 1, the 2nd to option 2, the 3rd to option 3.
  const allLabels = [
    ...Object.keys(PHASE2_PROTEIN_CATEGORIES),
    "Vegetables", "Vegetable", "Veg./Lettuce", "Veg. /Lettuce", "Veg/Lettuce", "Vegetable/Lettuce",
  ];
  allLabels.sort((a, b) => b.length - a.length);
  const labelAlt = allLabels.map((l) => l.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")).join("|");
  const re = new RegExp(`(\\d{2,4})\\s*g\\s+(${labelAlt})\\b`, "gi");

  const proteinMatches: { grams: number; label: string }[] = [];
  const vegMatches: { grams: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(chunk)) !== null) {
    const grams = parseFloat(m[1]);
    const label = m[2];
    if (isVegLabel(label)) vegMatches.push({ grams });
    else if (isProteinLabel(label)) proteinMatches.push({ grams, label });
  }

  for (let i = 0; i < 3; i++) {
    if (proteinMatches[i]) {
      options[i].protein_category = proteinMatches[i].label;
      options[i].protein_grams = proteinMatches[i].grams;
    }
    if (vegMatches[i]) {
      options[i].veg_grams = vegMatches[i].grams;
    }
  }

  // Fruit / Bread appear without grams. If present in the meal chunk, mark
  // them on every option that has a protein assigned (standard MB pattern).
  const hasFruit = /\bFruit\b/i.test(chunk);
  const hasBread = /\bBread\b/i.test(chunk);
  for (let i = 0; i < 3; i++) {
    if (options[i].protein_category) {
      options[i].has_fruit = hasFruit;
      options[i].has_bread = hasBread;
    }
  }

  return options;
}

function parseMealTable(text: string): { options: MealOptionsMap; legacy: Record<string, string | number | null> } {
  const meals: Array<{ key: MealKey; label: string }> = [
    { key: "breakfast", label: "Breakfast" },
    { key: "lunch", label: "Lunch" },
    { key: "dinner", label: "Dinner" },
  ];

  const options: MealOptionsMap = { breakfast: [], lunch: [], dinner: [] };
  const legacy: Record<string, string | number | null> = {};
  for (const meal of meals) {
    const chunk = extractMealChunk(text, meal.label);
    const opts = parseMealOptions(chunk);
    options[meal.key] = opts;
    // Keep legacy single-option fields populated from option 1 for backward compat.
    legacy[`${meal.key}_protein_category`] = opts[0].protein_category;
    legacy[`${meal.key}_protein_grams`] = opts[0].protein_grams;
    legacy[`${meal.key}_veg_grams`] = opts[0].veg_grams;
  }
  return { options, legacy };
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

  const debug: Record<string, unknown> = { step: "init" };
  try {
    debug.step = "read_auth_header";
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    debug.step = "parse_body";
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten().fieldErrors }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { clientId, storagePath } = parsed.data;
    debug.clientId = clientId;
    debug.storagePath = storagePath;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    debug.step = "resolve_user";
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    debug.userId = userData.user.id;
    const admin = createClient(supabaseUrl, serviceKey);

    // Verify ownership
    debug.step = "verify_client_ownership";
    const { data: clientRow, error: cErr } = await admin
      .from("clients")
      .select("id, practitioner_id")
      .eq("id", clientId)
      .maybeSingle();
    if (cErr || !clientRow || clientRow.practitioner_id !== userData.user.id) {
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Download PDF
    debug.step = "download_pdf";
    const { data: file, error: dErr } = await admin.storage.from("mb-pdfs").download(storagePath);
    if (dErr || !file) {
      console.error("parse-mb-pdf download failure", {
        operation: "storage.download",
        bucket: "mb-pdfs",
        storagePath,
        clientId,
        userId: userData.user.id,
        error: dErr,
      });
      return new Response(JSON.stringify({ error: "pdf_not_found", detail: dErr?.message }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    debug.step = "extract_pdf_text";
    const buf = new Uint8Array(await file.arrayBuffer());
    const pdf = await getDocumentProxy(buf);
    const { text: pages } = await extractText(pdf, { mergePages: false });
    const fullText = Array.isArray(pages) ? pages.join("\n\n") : String(pages);

    // Locate sections
    debug.step = "parse_pdf_sections";
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

    debug.step = "complete";
    return new Response(JSON.stringify({ fields: result, storagePath }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("parse-mb-pdf failure", {
      operation: "parse-mb-pdf",
      step: debug.step,
      clientId: debug.clientId,
      storagePath: debug.storagePath,
      userId: debug.userId,
      error: e,
    });
    return new Response(JSON.stringify({ error: "parse_failed", detail: String((e as Error).message ?? e), debug }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
