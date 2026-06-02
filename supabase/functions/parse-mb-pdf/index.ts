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
  "Poultry": "__phase3_poultry_boundary__", // boundary only; not stored
  "Cheese": "phase3_mb_cheese",
  "Legumes": "phase3_mb_legumes",
  "Vegetables": "phase3_mb_vegetables",
  "Veg./Lettuce": "phase3_mb_veg_lettuce",
  "Veg. /Lettuce": "phase3_mb_veg_lettuce",
  "Veg/Lettuce": "phase3_mb_veg_lettuce",
  "Sprouts": "phase3_mb_sprouts",
  "Fat/Oil": "phase3_mb_fat_oil",
  "Fat / Oil": "phase3_mb_fat_oil",
  "Fruit": "__phase3_fruit_boundary__",
  "Bread": "__phase3_bread_boundary__",
  "Starch": "__phase3_starch_boundary__",
  "Nuts": "__phase3_nuts_boundary__",
  "Yogurt": "__phase3_yogurt_boundary__",
  "Milk Products": "__phase3_milk_boundary__",
  "Pumpkin Seeds": "__phase3_pumpkin_boundary__",
  "Sunflower Seeds": "__phase3_sunflower_boundary__",
};

function normalizeWater(raw: string): number | null {
  const cleaned = raw.replace(/,/g, ".").trim();
  const fracMap: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75 };
  const m = cleaned.match(/^(\d+)\s*([½¼¾])?$/);
  if (m) return parseInt(m[1], 10) + (m[2] ? fracMap[m[2]] : 0);
  const m2 = cleaned.match(/^(\d+)\s+1\/(\d)$/);
  if (m2) return parseInt(m2[1], 10) + 1 / parseInt(m2[2], 10);
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}

function buildTrailingNameStripper(clientName: string | null): (s: string) => string {
  const trimmed = clientName?.trim() ?? "";
  if (!trimmed) {
    return (s: string) => s.replace(/\s+/g, " ").replace(/\s*\|\s*$/g, "").trim();
  }

  const parts = trimmed.split(/\s+/).filter(Boolean);
  const first = parts[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1] : "";
  const fullPattern = escapeRegExp(trimmed).replace(/\s+/g, "\\s+");
  const firstPattern = first ? escapeRegExp(first) : "";
  const lastPattern = last ? escapeRegExp(last) : "";

  // Aggressive: strip trailing occurrences of full name / first+last / first / last,
  // regardless of leading separator (space, comma, pipe, newline, etc.)
  const patterns: RegExp[] = [
    new RegExp(`[\\s,;:|/\\-]*${fullPattern}(?:\\s*\\|.*)?\\s*$`, "i"),
    first && last
      ? new RegExp(`[\\s,;:|/\\-]*${firstPattern}\\s+${lastPattern}(?:\\s*\\|.*)?\\s*$`, "i")
      : null,
    first ? new RegExp(`[\\s,;:|/\\-]+${firstPattern}(?:\\s*\\|.*)?\\s*$`, "i") : null,
    last ? new RegExp(`[\\s,;:|/\\-]+${lastPattern}(?:\\s*\\|.*)?\\s*$`, "i") : null,
  ].filter((p): p is RegExp => Boolean(p));

  return (s: string) => {
    let out = s.replace(/\s+/g, " ").trim();
    let changed = true;
    while (changed && out) {
      changed = false;
      for (const pattern of patterns) {
        const next = out
          .replace(pattern, "")
          .replace(/\s*\|\s*$/g, "")
          .replace(/[\s,;]+$/g, "")
          .trim();
        if (next !== out) {
          out = next;
          changed = true;
        }
      }
    }
    return out;
  };
}

// Returns a regex that strips lines/spans matching the page footer pattern:
// "[First] [Last] | © Metabolic Balance | Coach: [Coach Name]"
function buildFooterStripper(clientName: string | null): (s: string) => string {
  const stripTrailingName = buildTrailingNameStripper(clientName);
  return (s: string) => {
    let out = s;
    out = out.replace(/[^\n]*©\s*Metabolic Balance[^\n]*/gi, " ");
    out = out.replace(/Coach\s*:\s*[^\n|]+/gi, " ");
    if (clientName) {
      const trimmed = clientName.trim();
      const escapedFull = escapeRegExp(trimmed).replace(/\s+/g, "\\s+");
      out = out.replace(new RegExp(`${escapedFull}\\s*\\|?`, "gi"), " ");
      out = out.replace(new RegExp(escapedFull, "gi"), " ");
      for (const part of trimmed.split(/\s+/)) {
        if (part.length < 2) continue;
        const esc = escapeRegExp(part);
        out = out.replace(new RegExp(`\\b${esc}\\b`, "gi"), " ");
      }
    }
    // Strip any "Word Word |" proper-noun-pair followed by pipe (page footer remnant)
    out = out.replace(/\b[A-Z][a-z]+\s+[A-Z][a-z]+\s*\|/g, " ");
    out = out.replace(/\s*\|\s*\|/g, " ");
    out = out.replace(/\s*\|\s*$/gm, " ");
    return stripTrailingName(out);
  };
}

const CHUNK_END_PATTERNS: RegExp[] = [
  /\|\s*©/i,
  /©\s*Metabolic Balance/i,
  /Page\s*\d+\s*(?:of\s*\d+)?/i,
  /Personal Food List/i,
  /Additional Information about the Meal Plan/i,
  /Extended personal Food List/i,
  /Shopping Helper/i,
  /\$\$CA_PHASE3\$\$/i,
  /From now on you have sprouts/i,
  /From now on,?\s*you/i,
  /Please note/i,
  /\bNote:\s/i,
  /Coach\s*:/i,
  /Phase\s*3\s*:/i,
];

function truncateAtBoundary(chunk: string): string {
  let cut = chunk.length;
  for (const re of CHUNK_END_PATTERNS) {
    const m = chunk.match(re);
    if (m && m.index !== undefined && m.index < cut) cut = m.index;
  }
  return chunk.slice(0, cut);
}

function parseFoodSection(
  text: string,
  categoryMap: Record<string, string>,
  stripFooter: (s: string) => string,
): Record<string, string> {
  const result: Record<string, string> = {};
  const labels = Object.keys(categoryMap);
  labels.sort((a, b) => b.length - a.length);
  const labelPattern = labels.map((l) => l.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")).join("|");
  // Allow heading to start after newline, semicolon, comma-newline, or after gram-amount entries
  // (since unpdf often flattens columns into one line, "Sunflower Seeds" etc. may not be newline-prefixed).
  const splitRe = new RegExp(`(?:^|[\\n;]|(?<=\\bg\\s)|(?<=\\)\\s)|(?<=[.,]\\s))\\s*(${labelPattern})\\s*[:\\-–]?\\s+`, "g");

  const matches: { label: string; start: number; contentStart: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = splitRe.exec(text)) !== null) {
    matches.push({ label: m[1], start: m.index, contentStart: m.index + m[0].length });
  }
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const end = i + 1 < matches.length ? matches[i + 1].start : text.length;
    let chunk = text.slice(cur.contentStart, end);
    chunk = truncateAtBoundary(chunk);
    chunk = stripFooter(chunk);
    const items = chunk
      .split(/[,;\n]+/)
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .filter((s) => {
        if (s.length < 2 || s.length > 60) return false;
        if (/Personal Food List|Additional Information|Extended personal|Shopping Helper|Page\s*\d|©|Metabolic Balance|From now on|Please note|\bNote:|Coach\s*:/i.test(s)) return false;
        if (!/[A-Za-z]/.test(s)) return false;
        if (/\.\s+[a-z]/.test(s)) return false;
        if (s.split(/\s+/).length > 5) return false;
        return true;
      });
    const field = categoryMap[cur.label];
    if (!field || field.startsWith("__")) continue; // boundary-only label
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
  protein_category: null, protein_grams: null, veg_grams: null, has_fruit: false, has_bread: false,
});
function createEmptyMealOptions(): MealOptionsMap {
  return {
    breakfast: [EMPTY_OPTION(), EMPTY_OPTION(), EMPTY_OPTION()],
    lunch: [EMPTY_OPTION(), EMPTY_OPTION(), EMPTY_OPTION()],
    dinner: [EMPTY_OPTION(), EMPTY_OPTION(), EMPTY_OPTION()],
  };
}

const VEG_LABEL_RE = /^(?:Vegetables?|Veg\.?\s*\/?\s*Lettuce|Veg\/Lettuce|Vegetable\/Lettuce)$/i;
function isVegLabel(label: string): boolean { return VEG_LABEL_RE.test(label.trim()); }
function isProteinLabel(label: string): boolean {
  const lc = label.trim().toLowerCase();
  return Object.keys(PHASE2_PROTEIN_CATEGORIES).some((k) => k.toLowerCase() === lc);
}

// Parse meal table by collecting protein/veg/eggs candidates in document order,
// then grouping every 3 into Breakfast / Lunch / Dinner.
// - Handles "+" combos: "35g Pumpkin Seeds + 20g Sunflower Seeds" = ONE option.
// - Handles "N Eggs" (no g unit): protein=Eggs, grams=null.
function parseMealTable(text: string): { options: MealOptionsMap; legacy: Record<string, string | number | null> } {
  const options = createEmptyMealOptions();
  const legacy: Record<string, string | number | null> = {};

  const startIdx = text.search(/\bBreakfast\b/i);
  const endIdx = text.search(/Personal Food List/i);
  let region = text.slice(
    startIdx >= 0 ? startIdx : 0,
    endIdx > 0 ? endIdx : text.length,
  );

  // FIX 1: pre-strip "+ N(g) Ingredient" combo continuations so the secondary
  // ingredient cannot be picked up as a separate meal slot.
  region = region.replace(/\+\s*\d{1,4}\s*g?\s+[A-Za-z][A-Za-z .\/]{1,40}/g, " ");

  const mealKeys: MealKey[] = ["breakfast", "lunch", "dinner"];

  const proteinLabels = Object.keys(PHASE2_PROTEIN_CATEGORIES);
  const vegLabels = ["Vegetables", "Vegetable", "Veg./Lettuce", "Veg. /Lettuce", "Veg/Lettuce", "Vegetable/Lettuce"];
  const allLabels = [...proteinLabels, ...vegLabels];
  allLabels.sort((a, b) => b.length - a.length);
  const labelAlt = allLabels.map((l) => escapeRegExp(l)).join("|");

  // Patterns: "Ng Label", "Label Ng" (reversed), and "N Eggs" (no g).
  const gramRe = new RegExp(`(\\d{2,4})\\s*g\\s+(${labelAlt})\\b`, "gi");
  const gramReReversed = new RegExp(`(${labelAlt})\\s+(\\d{2,4})\\s*g\\b`, "gi");
  const eggsRe = /(\d+)\s+Eggs\b/gi;

  type Candidate = { kind: "protein" | "veg" | "eggs"; label: string; grams: number | null; idx: number; end: number };
  const candidates: Candidate[] = [];
  const pushFromMatch = (label: string, grams: number, idx: number, end: number) => {
    if (isVegLabel(label)) candidates.push({ kind: "veg", label, grams, idx, end });
    else if (isProteinLabel(label)) candidates.push({ kind: "protein", label, grams, idx, end });
  };

  let m: RegExpExecArray | null;
  gramRe.lastIndex = 0;
  while ((m = gramRe.exec(region)) !== null) {
    pushFromMatch(m[2], parseFloat(m[1]), m.index, m.index + m[0].length);
  }
  gramReReversed.lastIndex = 0;
  while ((m = gramReReversed.exec(region)) !== null) {
    pushFromMatch(m[1], parseFloat(m[2]), m.index, m.index + m[0].length);
  }
  eggsRe.lastIndex = 0;
  while ((m = eggsRe.exec(region)) !== null) {
    candidates.push({ kind: "eggs", label: "Eggs", grams: null, idx: m.index, end: m.index + m[0].length });
  }

  candidates.sort((a, b) => a.idx - b.idx);

  // De-duplicate overlapping matches from forward+reversed patterns.
  const filtered: Candidate[] = [];
  for (const c of candidates) {
    const prev = filtered.length ? filtered[filtered.length - 1] : null;
    if (prev && prev.kind === c.kind && prev.label === c.label && Math.abs(prev.idx - c.idx) < 30) continue;
    filtered.push(c);
  }

  const proteinCandidates = filtered.filter((c) => c.kind === "protein" || c.kind === "eggs");
  const vegCandidates = filtered.filter((c) => c.kind === "veg");

  for (let i = 0; i < Math.min(9, proteinCandidates.length); i++) {
    const mi = Math.floor(i / 3);
    const oi = i % 3;
    options[mealKeys[mi]][oi].protein_category = proteinCandidates[i].label;
    options[mealKeys[mi]][oi].protein_grams = proteinCandidates[i].grams;
  }
  for (let i = 0; i < Math.min(9, vegCandidates.length); i++) {
    const mi = Math.floor(i / 3);
    const oi = i % 3;
    options[mealKeys[mi]][oi].veg_grams = vegCandidates[i].grams;
  }

  // Has fruit/bread per meal chunk (split on "5 h").
  const mealChunks = region.split(/\b5\s*h(?:rs?)?\b/i).map((c) => c.trim()).filter(Boolean);
  for (let mi = 0; mi < Math.min(3, mealChunks.length); mi++) {
    const hasFruit = /\bFruit\b/i.test(mealChunks[mi]);
    const hasBread = /\bBread\b/i.test(mealChunks[mi]);
    for (let i = 0; i < 3; i++) {
      if (options[mealKeys[mi]][i].protein_category) {
        options[mealKeys[mi]][i].has_fruit = hasFruit;
        options[mealKeys[mi]][i].has_bread = hasBread;
      }
    }
  }

  for (let mi = 0; mi < 3; mi++) {
    const first = options[mealKeys[mi]][0];
    legacy[`${mealKeys[mi]}_protein_category`] = first.protein_category;
    legacy[`${mealKeys[mi]}_protein_grams`] = first.protein_grams;
    legacy[`${mealKeys[mi]}_veg_grams`] = first.veg_grams;
  }

  return { options, legacy };
}

function parseEggs(text: string): { eggs_min_per_week: number | null; eggs_max_per_week: number | null } {
  const m1 = text.match(/(\d+)\s*[-–]\s*(\d+)\s*eggs?\s*per\s*week/i);
  if (m1) return { eggs_min_per_week: +m1[1], eggs_max_per_week: +m1[2] };
  const m2 = text.match(/eggs?\s*per\s*week[^\d]{0,10}(\d+)\s*[-–]\s*(\d+)/i);
  if (m2) return { eggs_min_per_week: +m2[1], eggs_max_per_week: +m2[2] };
  const m3 = text.match(/min(?:imum)?[^\d]{0,10}(\d+)[^\d]{0,40}max(?:imum)?[^\d]{0,10}(\d+)\s*eggs/i);
  if (m3) return { eggs_min_per_week: +m3[1], eggs_max_per_week: +m3[2] };
  const m4 = text.match(/(\d+)\s*eggs?\s*per\s*week/i);
  if (m4) return { eggs_min_per_week: +m4[1], eggs_max_per_week: +m4[1] };
  return { eggs_min_per_week: null, eggs_max_per_week: null };
}

function parseWater(text: string): number | null {
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
  const e = rest.slice(50).search(endAnchor);
  return e < 0 ? rest : rest.slice(0, 50 + e);
}

// Special parser for Phase 3 Sprouts: takes only the items on the heading line,
// then stops at the instructional note or next category.
function parseSproutsField(phase3Section: string, stripFooter: (s: string) => string): string | null {
  const m = phase3Section.match(/\bSprouts\b\s*[:\-–]?\s*([^\n]*)/i);
  if (!m) return null;
  let chunk = m[1] ?? "";
  chunk = chunk.split(/From now on/i)[0];
  chunk = chunk.split(/Please note/i)[0];
  chunk = chunk.split(/\bNote:/i)[0];
  // Stop at next category heading on the same line (e.g. "Fat/Oil")
  const stopRe = /\b(Fat\s*\/?\s*Oil|Vegetables|Veg\.?\s*\/?\s*Lettuce|Fruit|Bread|Starch|Cheese|Meat|Poultry|Fish|Seafood|Legumes|Nuts|Yogurt|Milk Products)\b/i;
  const stop = chunk.search(stopRe);
  if (stop >= 0) chunk = chunk.slice(0, stop);
  chunk = stripFooter(chunk);
  const items = chunk
    .split(/[,;]+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((s) => s.length >= 2 && s.length <= 40 && /[A-Za-z]/.test(s) && s.split(/\s+/).length <= 4);
  return items.length ? Array.from(new Set(items)).join(", ") : null;
}

// Phase 3 parser using partial keyword matching (more tolerant of heading variations).
// Returns map of phase3_mb_* field -> comma-joined items, plus a debug headings list.
type Phase3Spec = { field: string; match: RegExp; reject?: RegExp };
const PHASE3_SPECS: Phase3Spec[] = [
  { field: "phase3_mb_fish",        match: /\bFish\b/i, reject: /\b(Seafood|Shellfish)\b/i },
  { field: "phase3_mb_seafood",     match: /\b(Seafood|Shellfish)\b/i },
  { field: "phase3_mb_meat",        match: /\bMeat\b/i, reject: /\bPoultry\b/i },
  { field: "phase3_mb_cheese",      match: /\bCheese\b/i },
  { field: "phase3_mb_legumes",     match: /\b(Legumes|Beans)\b/i },
  { field: "phase3_mb_vegetables",  match: /\bVegetables?\b/i, reject: /\b(Veg\.?\s*\/?\s*Lettuce|Lettuce)\b/i },
  { field: "phase3_mb_veg_lettuce", match: /\b(Veg\.?\s*\/?\s*Lettuce|Lettuce)\b/i },
  { field: "phase3_mb_sprouts",     match: /\bSprouts?\b/i },
  { field: "phase3_mb_fat_oil",     match: /\b(Fat\s*\/?\s*Oil|\bFat\b|\bOil\b)\b/i },
];
// Words that act as STOP boundaries but are NOT stored as fields themselves.
const PHASE3_BOUNDARY_KEYWORDS = /\b(Poultry|Fruit|Bread|Starch|Nuts|Yogurt|Milk Products|Pumpkin Seeds|Sunflower Seeds|Shopping Helper|From now on|Please note|\bNote:)\b/i;

function parsePhase3SectionByKeyword(
  section: string,
  stripFooter: (s: string) => string,
  debugLog: { headings: { field: string; heading: string; index: number }[]; missing: string[] },
): Record<string, string> {
  const out: Record<string, string> = {};
  // Collect heading positions: for each spec find first occurrence (skip if reject matches at same position).
  type Heading = { field: string; idx: number; endIdx: number; raw: string };
  const headings: Heading[] = [];
  for (const spec of PHASE3_SPECS) {
    const re = new RegExp(spec.match.source, "gi");
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(section)) !== null) {
      // Avoid matching if a reject keyword overlaps this exact position context
      const around = section.slice(Math.max(0, mm.index - 2), mm.index + mm[0].length + 8);
      if (spec.reject && spec.reject.test(around)) continue;
      headings.push({ field: spec.field, idx: mm.index, endIdx: mm.index + mm[0].length, raw: mm[0] });
      debugLog.headings.push({ field: spec.field, heading: mm[0], index: mm.index });
      break; // first occurrence only
    }
    if (!headings.some((h) => h.field === spec.field)) {
      debugLog.missing.push(spec.field);
    }
  }

  if (!headings.length) return out;

  // Also collect boundary positions (Poultry, Fruit, Bread, etc.) to act as stop markers.
  const boundaryPositions: number[] = [];
  {
    const re = new RegExp(PHASE3_BOUNDARY_KEYWORDS.source, "gi");
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(section)) !== null) boundaryPositions.push(mm.index);
  }

  headings.sort((a, b) => a.idx - b.idx);

  for (let i = 0; i < headings.length; i++) {
    const cur = headings[i];
    // End at the next heading OR next boundary keyword, whichever comes first.
    let end = i + 1 < headings.length ? headings[i + 1].idx : section.length;
    for (const bp of boundaryPositions) {
      if (bp > cur.endIdx && bp < end) end = bp;
    }
    let chunk = section.slice(cur.endIdx, end);
    // Drop leading punctuation
    chunk = chunk.replace(/^\s*[:\-–]?\s*/, "");
    chunk = stripFooter(chunk);
    const items = chunk
      .split(/[,;\n]+/)
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .filter((s) => {
        if (s.length < 2 || s.length > 60) return false;
        if (!/[A-Za-z]/.test(s)) return false;
        if (/Personal Food List|Extended personal|Shopping Helper|©|Metabolic Balance|From now on|Please note|\bNote:|Coach\s*:|Phase\s*3/i.test(s)) return false;
        if (s.split(/\s+/).length > 5) return false;
        return true;
      });
    if (items.length) {
      const existing = out[cur.field] ? out[cur.field].split(",").map((x) => x.trim()).filter(Boolean) : [];
      out[cur.field] = Array.from(new Set([...existing, ...items])).join(", ");
    }
  }
  return out;
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

    debug.step = "verify_client_ownership";
    const { data: clientRow, error: cErr } = await admin
      .from("clients")
      .select("id, practitioner_id, name")
      .eq("id", clientId)
      .maybeSingle();
    if (cErr || !clientRow || clientRow.practitioner_id !== userData.user.id) {
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const stripFooter = buildFooterStripper(clientRow.name ?? null);
    const stripTrailingName = buildTrailingNameStripper(clientRow.name ?? null);

    debug.step = "download_pdf";
    const { data: file, error: dErr } = await admin.storage.from("mb-pdfs").download(storagePath);
    if (dErr || !file) {
      return new Response(JSON.stringify({ error: "pdf_not_found", detail: dErr?.message }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    debug.step = "extract_pdf_text";
    const buf = new Uint8Array(await file.arrayBuffer());
    const pdf = await getDocumentProxy(buf);
    const { text: pages } = await extractText(pdf, { mergePages: false });
    const fullText = Array.isArray(pages) ? pages.join("\n\n") : String(pages);

    debug.step = "parse_pdf_sections";
    const phase2ProteinSection = sliceBetween(fullText, /Personal Food List\s*[-–]\s*Protein/i, /Personal Food List\s*[-–]\s*Carbohydrates|Additional Information about the Meal Plan|\$\$CA_PHASE3\$\$/i);
    const phase2CarbSection = sliceBetween(fullText, /Personal Food List\s*[-–]\s*Carbohydrates/i, /Additional Information about the Meal Plan|\$\$CA_PHASE3\$\$|Extended personal Food List/i);
    const additionalInfoSection = sliceBetween(fullText, /Additional Information about the Meal Plan/i, /\$\$CA_PHASE3\$\$|Extended personal Food List/i);
    // Phase 3: bound on "Shopping Helper" to avoid pulling the combined list.
    const phase3SectionRaw = sliceBetween(fullText, /Extended personal Food List/i, /Shopping Helper/i)
      ?? sliceBetween(fullText, /\$\$CA_PHASE3\$\$/i, /Shopping Helper/i);
    const phase3Section = phase3SectionRaw ? stripFooter(phase3SectionRaw) : null;

    const mealTableEnd = fullText.search(/Personal Food List\s*[-–]\s*Protein/i);
    const mealTableText = mealTableEnd > 0 ? fullText.slice(Math.max(0, mealTableEnd - 4000), mealTableEnd) : fullText.slice(0, 4000);
    const { options: mealOptions, legacy: mealLegacy } = parseMealTable(stripFooter(mealTableText));

    const phase2Proteins = phase2ProteinSection ? parseFoodSection(phase2ProteinSection, PHASE2_PROTEIN_CATEGORIES, stripFooter) : {};
    const phase2Carbs = phase2CarbSection ? parseFoodSection(phase2CarbSection, PHASE2_CARB_CATEGORIES, stripFooter) : {};
    const phase3DebugLog = { headings: [] as { field: string; heading: string; index: number }[], missing: [] as string[] };
    const phase3: Record<string, string> = phase3Section
      ? parsePhase3SectionByKeyword(phase3Section, stripFooter, phase3DebugLog)
      : {};
    debug.phase3_headings = phase3DebugLog.headings;
    debug.phase3_missing = phase3DebugLog.missing;
    console.log("[parse-mb-pdf] phase3 headings", phase3DebugLog);

    // Override Sprouts with stricter parser (stops at instructional note).
    if (phase3Section) {
      const sprouts = parseSproutsField(phase3Section, stripFooter);
      if (sprouts !== null) phase3["phase3_mb_sprouts"] = sprouts;
    }

    let eggs = { eggs_min_per_week: null as number | null, eggs_max_per_week: null as number | null };
    let water: number | null = null;
    if (additionalInfoSection) {
      eggs = parseEggs(additionalInfoSection);
      water = parseWater(additionalInfoSection);
    }

    const sanitizeExtractedValue = (value: unknown) => {
      if (typeof value !== "string") return value ?? null;
      const cleaned = stripTrailingName(stripFooter(value)).trim();
      return cleaned;
    };

    const buildField = (v: unknown) => {
      const value = sanitizeExtractedValue(v);
      return {
        value,
        extracted: value !== null && value !== undefined && value !== "",
      };
    };

    const phase2ProteinFields = Object.values(PHASE2_PROTEIN_CATEGORIES);
    const phase2CarbFields = Object.values(PHASE2_CARB_CATEGORIES);
    const phase3Fields = Object.values(PHASE3_CATEGORIES).filter((f) => !f.startsWith("__"));
    const unique = (arr: string[]) => Array.from(new Set(arr));

    const result: Record<string, { value: unknown; extracted: boolean }> = {};
    for (const f of unique(phase2ProteinFields)) result[f] = buildField(phase2Proteins[f] ?? "");
    for (const f of unique(phase2CarbFields)) result[f] = buildField(phase2Carbs[f] ?? "");
    for (const f of unique(phase3Fields)) result[f] = buildField(phase3[f] ?? "");
    for (const k of Object.keys(mealLegacy)) result[k] = buildField(mealLegacy[k]);
    result.eggs_min_per_week = buildField(eggs.eggs_min_per_week);
    result.eggs_max_per_week = buildField(eggs.eggs_max_per_week);
    result.water_target_litres = buildField(water);

    const mealOptionsResult: Record<string, MealOption[]> = {
      breakfast: mealOptions.breakfast,
      lunch: mealOptions.lunch,
      dinner: mealOptions.dinner,
    };

    debug.step = "complete";
    return new Response(JSON.stringify({ fields: result, mealOptions: mealOptionsResult, storagePath }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("parse-mb-pdf failure", { step: debug.step, error: e });
    return new Response(JSON.stringify({ error: "parse_failed", detail: String((e as Error).message ?? e), debug }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
