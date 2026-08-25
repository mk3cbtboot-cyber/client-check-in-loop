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

const UNICODE_FRACTIONS: Record<string, number> = {
  "\u00BD": 0.5, // ½
  "\u00BC": 0.25, // ¼
  "\u00BE": 0.75, // ¾
  "\u2153": 1 / 3,
  "\u2154": 2 / 3,
};

/** Remove soft hyphens (U+00AD) and normalise whitespace-ish artifacts. */
function stripSoftHyphens(value: string): string {
  return value.replace(/\u00AD/g, "");
}

function normalizeWater(raw: string): number | null {
  const cleaned = raw.replace(/,/g, ".").trim();
  // "2 ½", "½", "2.5", "2 1/2"
  const m = cleaned.match(/^(\d+)?\s*([\u00BD\u00BC\u00BE\u2153\u2154])$/);
  if (m) return (m[1] ? parseInt(m[1], 10) : 0) + UNICODE_FRACTIONS[m[2]];
  const m2 = cleaned.match(/^(\d+)\s+(\d)\/(\d)$/);
  if (m2) return parseInt(m2[1], 10) + parseInt(m2[2], 10) / parseInt(m2[3], 10);
  const m3 = cleaned.match(/^(\d)\/(\d)$/);
  if (m3) return parseInt(m3[1], 10) / parseInt(m3[2], 10);
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}

// Page footer: "<Client Name> | © Metabolic Balance | Coach: <Coach Name> <page>"
// Matched exactly so real food words are never removed from the body text.
const FOOTER_RE =
  /([^\n|]{1,60}?)\s*\|\s*©\s*Metabolic\s*Balance\s*\|\s*(?:Coach|COACH|coach)\s*:\s*((?:[A-Z][^\s|\n]*)(?:[ \t]+[A-Z][^\s|\n]*){0,3})[ \t]*(\d{1,3})?/g;

function extractFooterIdentity(text: string): { clientName: string | null; coachName: string | null } {
  FOOTER_RE.lastIndex = 0;
  const m = FOOTER_RE.exec(text);
  FOOTER_RE.lastIndex = 0;
  if (!m) return { clientName: null, coachName: null };
  const clientName = (m[1] ?? "").replace(/\s+/g, " ").trim() || null;
  const coachName = (m[2] ?? "").replace(/\s+/g, " ").trim() || null;
  return { clientName, coachName };
}

/**
 * Strips only the exact footer line (and bare "Page N of M" artifacts).
 * Deliberately does NOT strip name fragments across the text — a client named
 * "Olive" or "Berry" must not have those foods deleted from their food list.
 */
function buildFooterStripper(): (s: string) => string {
  return (s: string) => {
    let out = s.replace(FOOTER_RE, " ");
    out = out.replace(/Page\s*\d+\s*(?:of\s*\d+)?/gi, " ");
    out = out.replace(/\s*\|\s*\|/g, " ");
    return out.replace(/[ \t]{2,}/g, " ").replace(/\s*\|\s*$/gm, " ");
  };
}

type MbFormat = "classic" | "new" | "unsupported";
function detectFormat(text: string): MbFormat {
  if (/\$\$CA_PHASE[1-4]\$\$/i.test(text)) return "classic";
  if (/PHASE\s*[12]\s*:/i.test(text)) return "new";
  return "unsupported";
}


const CHUNK_END_PATTERNS: RegExp[] = [
  /\|\s*©/i,
  /©\s*Metabolic Balance/i,
  /Page\s*\d+\s*(?:of\s*\d+)?/i,
  /Personal Food List/i,
  /Additional Information about the Meal Plan/i,
  /Extended personal Food List/i,
  /Shopping (?:Helper|Bag)/i,
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

/**
 * Split on commas/semicolons that sit OUTSIDE parentheses. Newlines are NOT
 * separators — MB wraps a single food ("White\nBeans", "Prunes\n(dried)")
 * across lines, and the real separator is always the comma.
 */
function splitTopLevel(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of text.replace(/\r?\n/g, " ")) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === "," || ch === ";")) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
}

// A fragment that starts a rule/note rather than naming a food.
const NOTE_START_RE =
  /^(?:please\b|when\s|from now on\b|note\b|you\s(?:can|may|should|must|will)\b|this meal\b|do not\b|don't\b|avoid eating\b|eat\s|use\s|choose\s|limit\s|max\.?\b|maximum\b|no more than\b|only\s(?:eat|use|have)\b|if\syou\b|for\sbreakfast\b|it\sis\b|these\b|the\s(?:following|above)\b|egg\(s\)\b)/i;
const NOTE_INLINE_RE = /\b(?:no more than|times? a week|per week|please eat|please use|please note)\b/i;
// Where a rule starts inside an otherwise food-bearing fragment.
const NOTE_CUT_RE =
  /\b(?:Please\s|When\s+eating\b|When\s+you\b|From now on\b|Note:|Eat a minimum\b|You\s(?:can|may|should|must|will)\b|If you\b|Egg\(s\)\b)/;

const ARTIFACT_RE =
  /Personal Food List|Additional Information|Extended personal|Shopping (?:Helper|Bag)|Page\s*\d|©|Metabolic Balance|Coach\s*:|Phase\s*[1-4]\s*:|\$\$CA_/i;

/** Letter-spaced watermarks such as "P E R S O N A L I S E D  F O R  Y O U". */
function isLetterSpacedRun(s: string): boolean {
  const tokens = s.trim().split(/\s+/);
  if (tokens.length < 4) return false;
  return tokens.filter((t) => t.length === 1).length / tokens.length >= 0.7;
}

function isNoteFragment(s: string): boolean {
  if (NOTE_START_RE.test(s)) return true;
  if (NOTE_INLINE_RE.test(s)) return true;
  // Sentence-like: contains a verb-ish clause and is long.
  return s.split(/\s+/).length > 7 && /\s[a-z]+\s+[a-z]+\s/.test(s);
}

/**
 * Trailing junk glued onto the last item of a section because the PDF had no
 * comma before it: the letter-spaced page watermark, or the next section's
 * heading ("EGG(S)").
 */
function stripTrailingArtifacts(s: string): string {
  return s
    // letter-spaced watermark run, anywhere in the string
    .replace(/(?:(?:^|\s)[A-Za-z](?=\s|$)){4,}/g, " ")
    .replace(/\s*\bEGGS?\(?S?\)?\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}




/** Remove a trailing client name that bled in from the page footer. */
function stripClientName(item: string, names: string[]): string | null {
  let out = item.trim();
  for (const raw of names) {
    const n = raw.trim();
    if (n.length < 3) continue;
    const esc = escapeRegExp(n);
    if (new RegExp(`^${esc}$`, "i").test(out)) return null;
    out = out.replace(new RegExp(`[\\s,|-]*${esc}\\s*$`, "i"), "").trim();
    // First-name bleed: "Julie", or "Julie Cobb" when the client row says
    // "Julie coblestone" — a short capitalised run starting with the first name.
    const first = n.split(/\s+/)[0];
    if (first.length >= 3) {
      const fe = escapeRegExp(first);
      if (new RegExp(`^${fe}(?:\\s+[A-Za-z'-]+){0,2}$`, "i").test(out)) return null;
      out = out.replace(new RegExp(`[\\s,|-]+${fe}(?:\\s+[A-Za-z'-]+){0,2}\\s*$`), "").trim();
    }
  }
  out = out.replace(/[\s,;|]+$/g, "").trim();
  return out.length ? out : null;
}

const PERSON_NAME_RE = /^[A-Z][a-z'’-]+(?:\s+[A-Z][a-z'’-]+){1,2}$/;
/**
 * The page-footer name often lands as the LAST item of whichever food category
 * ends a page, in several categories. Anything that looks like a person's name
 * and repeats as a trailing item is treated as footer bleed, not a food.
 */
function dropRepeatedTrailingName(fieldItems: Record<string, string[]>): void {
  const tally = new Map<string, number>();
  for (const items of Object.values(fieldItems)) {
    const last = items[items.length - 1];
    if (last && PERSON_NAME_RE.test(last)) tally.set(last, (tally.get(last) ?? 0) + 1);
  }
  const bleed = new Set([...tally.entries()].filter(([, n]) => n >= 2).map(([s]) => s));
  if (!bleed.size) return;
  for (const key of Object.keys(fieldItems)) {
    fieldItems[key] = fieldItems[key].filter((i) => !bleed.has(i));
  }
}


export type FoodSectionResult = {
  foods: Record<string, string>;
  notes: Record<string, string>;
};

/**
 * Parses "<CATEGORY> <comma-separated foods>" rows.
 *
 * - Category labels are matched case-insensitively from the supplied map only;
 *   whatever categories are present get filled, the rest stay empty.
 * - Items wrap freely across lines: a category owns everything up to the next
 *   known category label or section boundary.
 * - Parenthetical qualifiers stay attached to their food.
 * - Trailing rules/notes are captured separately instead of stored as foods.
 * - The page-footer client name is never kept as a food.
 */
function parseFoodSection(
  text: string,
  categoryMap: Record<string, string>,
  stripFooter: (s: string) => string,
  clientNames: string[] = [],
): FoodSectionResult {
  const foods: Record<string, string> = {};
  const notes: Record<string, string> = {};
  const labels = Object.keys(categoryMap);
  labels.sort((a, b) => b.length - a.length);
  const labelPattern = labels.map(escapeRegExp).join("|");
  // A heading may start a line, or follow a separator when unpdf flattens columns.
  const splitRe = new RegExp(
    `(?:^|[\\n;]|(?<=\\bg\\s)|(?<=\\)\\s)|(?<=[.,]\\s))\\s*(${labelPattern})\\s*[:\\-–]?\\s+`,
    "gi",
  );

  const matches: { label: string; start: number; contentStart: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = splitRe.exec(text)) !== null) {
    matches.push({ label: m[1], start: m.index, contentStart: m.index + m[0].length });
  }

  const lookup: Record<string, string> = {};
  for (const [k, v] of Object.entries(categoryMap)) lookup[k.toLowerCase().replace(/\s+/g, " ")] = v;

  const fieldItems: Record<string, string[]> = {};
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const field = lookup[cur.label.toLowerCase().replace(/\s+/g, " ")];
    if (!field || field.startsWith("__")) continue; // boundary-only label
    const end = i + 1 < matches.length ? matches[i + 1].start : text.length;
    let chunk = text.slice(cur.contentStart, end);
    chunk = truncateAtBoundary(chunk);
    chunk = stripFooter(chunk);

    const fragments = splitTopLevel(chunk);
    const items: string[] = [];
    const rules: string[] = [];
    let inNote = false;
    const pushFood = (value: string) => {
      const cleaned = stripClientName(stripTrailingArtifacts(value), clientNames);
      if (!cleaned) return;
      if (cleaned.length > 80) { rules.push(cleaned); return; }
      items.push(cleaned);
    };

    for (const rawFrag of fragments) {
      const frag = stripTrailingArtifacts(rawFrag);
      if (!frag || !/[A-Za-z]/.test(frag)) continue;
      if (ARTIFACT_RE.test(frag)) { inNote = false; continue; }
      if (isLetterSpacedRun(frag)) continue; // page watermark

      if (inNote) { rules.push(frag); continue; }
      // A rule can start part-way through a fragment ("Oatmeal When eating …").
      const cut = frag.match(NOTE_CUT_RE);
      if (cut && cut.index !== undefined && cut.index > 0) {
        pushFood(frag.slice(0, cut.index).trim());
        rules.push(frag.slice(cut.index).trim());
        inNote = true;
        continue;
      }
      if (isNoteFragment(frag)) { inNote = true; rules.push(frag); continue; }
      pushFood(frag);
    }



    if (items.length) {
      fieldItems[field] = Array.from(new Set([...(fieldItems[field] ?? []), ...items]));
    }
    const cleanRules = rules
      .map((r) => stripClientName(stripTrailingArtifacts(r), clientNames) ?? "")
      .map((r) => r.trim())
      .filter((r) => r.length > 0 && !isLetterSpacedRun(r));
    if (cleanRules.length) {
      const prev = notes[field] ? [notes[field]] : [];
      notes[field] = Array.from(new Set([...prev, cleanRules.join(", ")])).join(" ");
    }

  }

  dropRepeatedTrailingName(fieldItems);
  for (const [field, items] of Object.entries(fieldItems)) {
    if (items.length) foods[field] = items.join(", ");
  }
  return { foods, notes };
}



function extractPositionedTextForPage(page: unknown): PositionedText[] {
  const items = (page as { content?: { items?: Array<Record<string, unknown>> } })?.content?.items;
  if (!Array.isArray(items)) return [];

  return items
    .map((item) => {
      const text = typeof item.str === "string"
        ? item.str
        : Array.isArray(item.textRuns)
          ? item.textRuns.map((run) => String((run as { str?: unknown }).str ?? "")).join("")
          : "";
      const transform = Array.isArray(item.transform) ? item.transform : [];
      const x = typeof transform[4] === "number" ? transform[4] : typeof item.x === "number" ? item.x : 0;
      const y = typeof transform[5] === "number" ? transform[5] : typeof item.y === "number" ? item.y : 0;
      return { text: text.replace(/\s+/g, " ").trim(), x, y };
    })
    .filter((item) => item.text);
}

type MbItemUnit = "g" | "ml" | "count" | "as_listed";
type MealItem = {
  category: string;
  qty: number | null;
  unit: MbItemUnit;
  /** Parenthetical role tag, e.g. "Mushrooms (Protein)" -> "Protein". */
  role?: string;
};

type MealOption = {
  /** Ordered items exactly as they appear on this suggestion's line. */
  items: MealItem[];
  protein_category: string | null;
  protein_grams: number | null;
  veg_grams: number | null;
  has_fruit: boolean;
  has_bread: boolean;
};
type PositionedText = {
  text: string;
  x: number;
  y: number;
};
type MealKey = "breakfast" | "lunch" | "dinner";
type MealOptionsMap = Record<MealKey, MealOption[]>;
const EMPTY_OPTION = (): MealOption => ({
  items: [], protein_category: null, protein_grams: null, veg_grams: null, has_fruit: false, has_bread: false,
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
// Protein-ish meal rows that are not Phase-2 food_* columns but do anchor a
// suggestion in the meal table (they appear as the option's main item).
const EXTRA_MEAL_PROTEINS = ["Sprouts", "Tofu"];
function isProteinLabel(label: string): boolean {
  const lc = label.trim().toLowerCase();
  return Object.keys(PHASE2_PROTEIN_CATEGORIES).some((k) => k.toLowerCase() === lc)
    || EXTRA_MEAL_PROTEINS.some((k) => k.toLowerCase() === lc);
}

function isSeedMealProtein(label: string): boolean {
  const normalized = label.replace(/\s+/g, " ").trim().toLowerCase();
  return ["sunflower seeds", "pumpkin seeds", "sesame seeds", "hemp seeds", "flaxseeds"].includes(normalized);
}

/* ------------------------------------------------------------------ */
/* Meal item tokenizer                                                 */
/*                                                                     */
/* Reads one suggestion's own chunk of PDF text and returns every food */
/* category actually written on it, with its real quantity and unit.   */
/* Nothing is inferred from neighbouring options or from bare numbers. */
/* ------------------------------------------------------------------ */

const MEAL_ITEM_CATEGORY_CANON: Record<string, string> = {
  "milk products": "Milk Products",
  "vegetables": "Vegetables",
  "vegetable": "Vegetables",
  "veg./lettuce": "Veg./Lettuce",
  "veg. /lettuce": "Veg./Lettuce",
  "veg/lettuce": "Veg./Lettuce",
  "vegetable/lettuce": "Veg./Lettuce",
  "fat/oil": "Fat/Oil",
  "fat / oil": "Fat/Oil",
};

const MEAL_ITEM_CATEGORIES: string[] = [
  ...Object.keys(PHASE2_PROTEIN_CATEGORIES),
  ...EXTRA_MEAL_PROTEINS,
  "Vegetables",
  "Vegetable",
  "Veg./Lettuce",
  "Veg. /Lettuce",
  "Veg/Lettuce",
  "Vegetable/Lettuce",
  "Starch",
  "Bread",
  "Fruit",
  "Fat/Oil",
  "Fat / Oil",
];

function canonCategory(label: string): string {
  const key = label.replace(/\s+/g, " ").trim().toLowerCase();
  return MEAL_ITEM_CATEGORY_CANON[key] ??
    (label.replace(/\s+/g, " ").trim().replace(/\b\w/g, (c) => c.toUpperCase()));
}

function buildMealItemRegex(): RegExp {
  const alt = [...MEAL_ITEM_CATEGORIES]
    .sort((a, b) => b.length - a.length)
    .map((l) => escapeRegExp(l))
    .join("|");
  return new RegExp(
    `(\\d{1,4})\\s*(g|ml)\\s+(${alt})\\b` + // "200 ml Milk Products"
    // "Milk Products 200 ml" — only when the number is NOT the start of a
    // following "<qty> <unit> <Category>" row, which would steal its amount.
    `|(${alt})\\s+(\\d{1,4})\\s*(g|ml)\\b(?!\\s+(?:${alt}))` +
    `|(\\d{1,2})\\s+Eggs?\\b` + // "2 Eggs"
    `|(${alt})\\b`, // bare "Fruit" / "Bread"
    "gi",
  );
}

function tokenizeMealItems(chunk: string): MealItem[] {
  const re = buildMealItemRegex();
  const out: MealItem[] = [];
  const byCategory = new Map<string, MealItem>();

  const push = (category: string, qty: number | null, unit: MbItemUnit) => {
    const existing = byCategory.get(category);
    if (existing) {
      // A later, quantified mention upgrades an earlier bare one.
      if (existing.qty == null && qty != null) {
        existing.qty = qty;
        existing.unit = unit;
      }
      return;
    }
    const item: MealItem = { category, qty, unit };
    byCategory.set(category, item);
    out.push(item);
  };

  let m: RegExpExecArray | null;
  re.lastIndex = 0;
  while ((m = re.exec(chunk)) !== null) {
    if (m[3]) {
      push(canonCategory(m[3]), parseInt(m[1], 10), m[2].toLowerCase() as MbItemUnit);
    } else if (m[4]) {
      push(canonCategory(m[4]), parseInt(m[5], 10), m[6].toLowerCase() as MbItemUnit);
    } else if (m[7]) {
      push("Eggs", parseInt(m[7], 10), "count");
    } else if (m[8]) {
      push(canonCategory(m[8]), null, "as_listed");
    }
  }

  return out;
}

/** Fill the legacy MealOption fields from the parsed item list. */
function applyItemsToOption(option: MealOption, items: MealItem[]) {
  option.items = items;
  const isEggs = (c: string) => /^eggs?(\(s\))?$/i.test(c.replace(/\s+/g, ""));
  const protein = items.find((it) => isEggs(it.category) || isProteinLabel(it.category));
  const veg = items.find((it) => isVegLabel(it.category));
  option.protein_category = protein ? (isEggs(protein.category) ? "Eggs" : protein.category) : null;
  option.protein_grams = protein && protein.unit !== "count" ? protein.qty : null;
  option.veg_grams = veg?.qty ?? null;
  option.has_fruit = items.some((it) => /^fruits?$/i.test(it.category.trim()));
  option.has_bread = items.some((it) => /^bread$/i.test(it.category.trim()));
}

/* ------------------------------------------------------------------ */
/* Positioned-text (column) meal-table parser                          */
/*                                                                     */
/* The meal plan page is a three-column grid: one column per           */
/* suggestion, each column stacking Breakfast / Lunch / Dinner. The    */
/* columns are located from the x of the three "Breakfast" headers     */
/* (never hard-coded) and split at the midpoints between them.         */
/* ------------------------------------------------------------------ */

type PdfRow = { y: number; items: PositionedText[] };

function rowsFromItems(items: PositionedText[], tolerance = 3): PdfRow[] {
  const rows: PdfRow[] = [];
  for (const item of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const existing = rows.find((r) => Math.abs(r.y - item.y) <= tolerance);
    if (existing) existing.items.push(item);
    else rows.push({ y: item.y, items: [item] });
  }
  for (const r of rows) r.items.sort((a, b) => a.x - b.x);
  return rows.sort((a, b) => b.y - a.y);
}

const MEAL_HEADER_RE = /^(breakfast|lunch|dinner)\b/i;

/** x-positions of the three suggestion columns, derived from the Breakfast headers. */
/** "B R E A K F A S T" (letter-spaced New-format headings) -> "breakfast". */
function despace(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

function findColumnAnchors(items: PositionedText[]): number[] {
  const heads = items.filter((i) => despace(i.text).startsWith("breakfast"));
  const xs: number[] = [];
  for (const h of heads.sort((a, b) => a.x - b.x)) {
    if (!xs.some((x) => Math.abs(x - h.x) < 20)) xs.push(h.x);
  }
  return xs;
}


function columnIndexFor(x: number, anchors: number[]): number {
  let idx = 0;
  for (let i = 1; i < anchors.length; i++) {
    const midpoint = (anchors[i - 1] + anchors[i]) / 2;
    if (x >= midpoint) idx = i;
  }
  return idx;
}

const KNOWN_CATEGORY_ALT = [...MEAL_ITEM_CATEGORIES]
  .sort((a, b) => b.length - a.length)
  .map((l) => escapeRegExp(l))
  .join("|");

// A food name: a known category, or a free-form capitalised name of up to
// three words, optionally carrying a parenthetical role tag.
const NAME_SRC = `(?:${KNOWN_CATEGORY_ALT}|[A-Za-z][A-Za-z.\\/'-]*(?:\\s+[A-Za-z][A-Za-z.\\/'-]*){0,2})`;

function buildLineItemRegex(): RegExp {
  return new RegExp(
    // "120 g Fish", "200 ml Milk Products", "80 g Mushrooms (Protein)"
    `(\\d{1,4})\\s*(g|ml)\\s+(${NAME_SRC})(?:\\s*\\(([^)]{1,24})\\))?` +
      // "Fish 120 g"
      `|(${NAME_SRC})\\s+(\\d{1,4})\\s*(g|ml)\\b` +
      // "2 Eggs"
      `|(\\d{1,2})\\s*Eggs?\\b` +
      // bare "Fruit" / "Bread"
      `|\\b(${KNOWN_CATEGORY_ALT})(?:\\s*\\(([^)]{1,24})\\))?\\b`,
    "gi",
  );
}

const MEAL_LINE_NOISE_RE =
  /^(?:\+|\d+\s*h(?:rs?)?\b|Personal Food List|Additional Information|Page\s*\d|©|Metabolic Balance|Coach\s*:)/i;

/** Parse one column-line of text into zero or more meal components. */
function parseMealLineItems(line: string): MealItem[] {
  const out: MealItem[] = [];
  const text = line.replace(/\s+/g, " ").trim();
  if (!text || MEAL_LINE_NOISE_RE.test(text)) return out;
  const re = buildLineItemRegex();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[3]) {
      out.push({ category: canonCategory(m[3]), qty: parseInt(m[1], 10), unit: m[2].toLowerCase() as MbItemUnit, ...(m[4] ? { role: m[4].trim() } : {}) });
    } else if (m[5]) {
      out.push({ category: canonCategory(m[5]), qty: parseInt(m[6], 10), unit: m[7].toLowerCase() as MbItemUnit });
    } else if (m[8]) {
      out.push({ category: "Eggs", qty: parseInt(m[8], 10), unit: "count" });
    } else if (m[9]) {
      out.push({ category: canonCategory(m[9]), qty: null, unit: "as_listed", ...(m[10] ? { role: m[10].trim() } : {}) });
    }
  }
  return out;
}

/**
 * Column-based meal table parse. Returns null when the page does not look
 * like the expected three-column grid, so the caller can fall back.
 */
function parseMealTableColumns(
  positionedItems: PositionedText[],
): { options: MealOptionsMap; legacy: Record<string, string | number | null>; debug: Record<string, unknown> } | null {
  if (!positionedItems.length) return null;
  const anchors = findColumnAnchors(positionedItems);
  if (anchors.length < 3) return null;
  const cols = anchors.slice(0, 3);

  const rows = rowsFromItems(positionedItems);
  // Column text lines, top to bottom.
  const columnLines: string[][] = [[], [], []];
  for (const row of rows) {
    const buckets: PositionedText[][] = [[], [], []];
    for (const item of row.items) buckets[columnIndexFor(item.x, cols)].push(item);
    buckets.forEach((bucket, ci) => {
      const text = bucket.map((b) => b.text).join(" ").replace(/\s+/g, " ").trim();
      if (text) columnLines[ci].push(text);
    });
  }

  const options = createEmptyMealOptions();
  const legacy: Record<string, string | number | null> = {};
  const mealKeys: MealKey[] = ["breakfast", "lunch", "dinner"];
  const debugColumns: Record<string, unknown>[] = [];

  columnLines.forEach((lines, ci) => {
    let current: MealKey | null = null;
    const perMeal: Record<MealKey, MealItem[]> = { breakfast: [], lunch: [], dinner: [] };
    const perMealLines: Record<MealKey, string[]> = { breakfast: [], lunch: [], dinner: [] };
    for (const raw of lines) {
      if (/^Personal Food List/i.test(raw)) break;
      // New-format headings are letter-spaced ("B R E A K F A S T"); classic
      // ones are plain words, so match on the de-spaced form for both.
      const spaced = despace(raw).match(/^(breakfast|lunch|dinner)$/);
      if (spaced) {
        current = spaced[1] as MealKey;
        continue;
      }
      const header = raw.match(MEAL_HEADER_RE);
      if (header) {
        current = header[1].toLowerCase() as MealKey;
        const rest = raw.slice(header[0].length).trim();
        if (rest) {
          perMealLines[current].push(rest);
          perMeal[current].push(...parseMealLineItems(rest));
        }
        continue;
      }

      if (!current) continue;
      perMealLines[current].push(raw);
      perMeal[current].push(...parseMealLineItems(raw));
    }
    for (const meal of mealKeys) applyItemsToOption(options[meal][ci], perMeal[meal]);
    debugColumns.push({ column: ci, x: cols[ci], lines: perMealLines });
  });

  for (const meal of mealKeys) {
    const first = options[meal][0];
    legacy[`${meal}_protein_category`] = first.protein_category;
    legacy[`${meal}_protein_grams`] = first.protein_grams;
    legacy[`${meal}_veg_grams`] = first.veg_grams;
  }

  const total = mealKeys.reduce((n, meal) => n + options[meal].reduce((s, o) => s + o.items.length, 0), 0);
  if (total === 0) return null;

  return {
    options,
    legacy,
    debug: {
      meal_parser_mode: "columns",
      column_x: cols,
      columns: debugColumns,
      meal_items: mealKeys.reduce((acc, mk) => {
        acc[mk] = options[mk].map((o) => o.items);
        return acc;
      }, {} as Record<string, MealItem[][]>),
    },
  };
}








function preprocessMealLines(lines: string[]): string[] {
  const merged: string[] = [];
  for (const rawLine of lines) {
    const trimmed = rawLine.replace(/\s+/g, " ").trim();
    if (!trimmed) continue;
    if (/^\+/.test(trimmed) && merged.length > 0) {
      merged[merged.length - 1] = `${merged[merged.length - 1]} ${trimmed}`.replace(/\s+/g, " ").trim();
      continue;
    }
    merged.push(trimmed);
  }
  return merged;
}

function extractMealLineFromItems(items: PositionedText[]): string {
  return items
    .sort((a, b) => a.x - b.x)
    .map((item) => item.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function groupItemsIntoLines(items: PositionedText[], tolerance = 2.5): string[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { y: number; items: PositionedText[] }[] = [];

  for (const item of sorted) {
    const existing = lines.find((line) => Math.abs(line.y - item.y) <= tolerance);
    if (existing) {
      existing.items.push(item);
      existing.y = (existing.y + item.y) / 2;
    } else {
      lines.push({ y: item.y, items: [item] });
    }
  }

  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) => extractMealLineFromItems(line.items))
    .filter(Boolean);
}

function extractMealProtein(line: string): { label: string; grams: number | null } | null {
  const proteinLabels = Object.keys(PHASE2_PROTEIN_CATEGORIES)
    .sort((a, b) => b.length - a.length)
    .map((label) => escapeRegExp(label))
    .join("|");

  const forward = new RegExp(`(\\d{1,4})\\s*g\\s+(${proteinLabels})\\b`, "i");
  const reversed = new RegExp(`(${proteinLabels})\\s+(\\d{1,4})\\s*g\\b`, "i");
  const eggs = /(\d+)\s+Eggs\b/i;

  const forwardMatch = line.match(forward);
  if (forwardMatch) return { label: forwardMatch[2], grams: parseInt(forwardMatch[1], 10) };

  const reversedMatch = line.match(reversed);
  if (reversedMatch) return { label: reversedMatch[1], grams: parseInt(reversedMatch[2], 10) };

  const eggsMatch = line.match(eggs);
  if (eggsMatch) return { label: "Eggs", grams: null };

  return null;
}
function extractVegGramsFromLine(line: string, proteinGrams: number | null): number | null {
  const patterns = [
    /(?:Vegetables?|Veg\.?\s*\/?\s*Lettuce|Vegetable\/Lettuce)\s*(\d{2,4})\s*g\b/i,
    /(\d{2,4})\s*g\s*(?:Vegetables?|Veg\.?\s*\/?\s*Lettuce|Vegetable\/Lettuce)\b/i,
  ];
  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match) {
      const grams = parseInt(match[1], 10);
      if (Number.isFinite(grams) && grams !== proteinGrams) return grams;
    }
  }
  return null;
}

function parseMealLinesBySection(lines: string[], options: MealOptionsMap) {
  const sections: Record<MealKey, string[]> = { breakfast: [], lunch: [], dinner: [] };
  let currentMeal: MealKey | null = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line) continue;
    if (/^\s*Breakfast\b/i.test(line)) {
      currentMeal = "breakfast";
      const remainder = line.replace(/^\s*Breakfast\b\s*/i, "").trim();
      sections.breakfast.push(remainder || "Breakfast");
      continue;
    }
    if (/^\s*Lunch\b/i.test(line)) {
      currentMeal = "lunch";
      const remainder = line.replace(/^\s*Lunch\b\s*/i, "").trim();
      sections.lunch.push(remainder || "Lunch");
      continue;
    }
    if (/^\s*Dinner\b/i.test(line)) {
      currentMeal = "dinner";
      const remainder = line.replace(/^\s*Dinner\b\s*/i, "").trim();
      sections.dinner.push(remainder || "Dinner");
      continue;
    }
    if (!currentMeal) continue;
    sections[currentMeal].push(line);
  }

  for (const meal of ["breakfast", "lunch", "dinner"] as MealKey[]) {
    let slot = 0;
    for (const line of sections[meal]) {
      if (slot >= 3) break;
      if (/^\s*(Breakfast|Lunch|Dinner)\s*$/i.test(line) || /\b5\s*h(?:rs?)?\b/i.test(line)) continue;
      const protein = extractMealProtein(line);
      if (!protein) continue;
      options[meal][slot] = {
        items: [],
        protein_category: protein.label,
        protein_grams: protein.grams,
        veg_grams: extractVegGramsFromLine(line, protein.grams),
        has_fruit: /\bFruit\b/i.test(line),
        has_bread: /\bBread\b/i.test(line),
      };
      slot += 1;
    }
  }
}

function preprocessMealRegion(region: string): string {
  const sourceLines = region.split(/\r?\n/);
  const mergedLines: string[] = [];

  for (const rawLine of sourceLines) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith("+") && mergedLines.length > 0) {
      mergedLines[mergedLines.length - 1] = `${mergedLines[mergedLines.length - 1]} ${trimmed}`;
      continue;
    }
    mergedLines.push(rawLine);
  }

  return mergedLines
    .map((line) => line
      .replace(
        /\s+\+\s*\d{1,4}\s*g\s+[A-Za-z][A-Za-z .\/()%-]{1,80}?(?=(?:\s+\d{2,4}\s*g\b)|(?:\s+(?:Vegetables?|Veg\.?\s*\/?\s*Lettuce|Veg\/Lettuce|Vegetable\/Lettuce|Fruit|Bread)\b)|(?:\s+5\s*h\b)|$)/gi,
        "",
      )
      .replace(/\s+/g, " ")
      .trim())
    .filter(Boolean)
    .join("\n");
}

function parseMealTable(
  text: string,
  positionedItems: PositionedText[] = [],
): { options: MealOptionsMap; legacy: Record<string, string | number | null>; debug: Record<string, unknown> } {
  // Primary path: positioned-text three-column grid. Text regex ordering is
  // only a fallback for pages where the columns cannot be located.
  const columnParse = parseMealTableColumns(positionedItems);
  if (columnParse) return columnParse;

  const options = createEmptyMealOptions();

  const legacy: Record<string, string | number | null> = {};
  const debug: Record<string, unknown> = {};
  const mealKeys: MealKey[] = ["breakfast", "lunch", "dinner"];

  const startIdx = text.search(/\bBreakfast\b/i);
  const endIdx = text.search(/Personal Food List/i);
  let region = text.slice(startIdx >= 0 ? startIdx : 0, endIdx > 0 ? endIdx : text.length);
  region = preprocessMealRegion(region);

  const proteinLabels = [...Object.keys(PHASE2_PROTEIN_CATEGORIES), ...EXTRA_MEAL_PROTEINS];
  const vegLabels = ["Vegetables", "Vegetable", "Veg./Lettuce", "Veg. /Lettuce", "Veg/Lettuce", "Vegetable/Lettuce"];
  const allLabels = [...proteinLabels, ...vegLabels];
  allLabels.sort((a, b) => b.length - a.length);
  const labelAlt = allLabels.map((l) => escapeRegExp(l)).join("|");
  // Anchors accept ml as well as g so "200 ml Milk Products" is a real option.
  const gramRe = new RegExp(`(\\d{2,4})\\s*(?:g|ml)\\s+(${labelAlt})\\b`, "gi");
  const gramReReversed = new RegExp(`(${labelAlt})\\s+(\\d{2,4})\\s*(?:g|ml)\\b`, "gi");
  const eggsRe = /(\d+)\s+Egg/gi;

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
    candidates.push({ kind: "eggs", label: "Egg(s)", grams: null, idx: m.index, end: m.index + m[0].length });
  }

  // Additional pass: lines that contain "N Egg(s)" (no gram unit) — scan line-by-line and add candidates.
  // Strip trailing whitespace/\r and any leading "+" before testing. No end-anchor — permissive.
  const eggsLineRe = /^\d+\s+Egg/i;
  let lineOffset = 0;
  for (const rawLine of region.split(/\r?\n/)) {
    const cleaned = rawLine.replace(/[\r\n\s]+$/g, "").replace(/^\s*\+\s*/, "").trim();
    if (eggsLineRe.test(cleaned)) {
      const trimmedIdx = region.indexOf(cleaned, lineOffset);
      const idx = trimmedIdx >= 0 ? trimmedIdx : lineOffset;
      const alreadyPresent = candidates.some((c) => c.kind === "eggs" && Math.abs(c.idx - idx) < 40);
      if (!alreadyPresent) {
        candidates.push({ kind: "eggs", label: "Egg(s)", grams: null, idx, end: idx + cleaned.length });
      }
    }
    lineOffset += rawLine.length + 1;
  }

  candidates.sort((a, b) => a.idx - b.idx);

  const filtered: Candidate[] = [];
  for (const c of candidates) {
    const prev = filtered.length ? filtered[filtered.length - 1] : null;
    if (prev && prev.kind === c.kind && prev.label === c.label && Math.abs(prev.idx - c.idx) < 30) continue;
    filtered.push(c);
  }

  const rawProteinCandidates = filtered.filter((c) => c.kind === "protein" || c.kind === "eggs");
  const proteinCandidates: Candidate[] = [];
  let removedSeedContinuation = false;
  for (let i = 0; i < rawProteinCandidates.length; i++) {
    const candidate = rawProteinCandidates[i];
    const previous = rawProteinCandidates[i - 1] ?? null;
    const shouldDropSeedContinuation = Boolean(
      previous &&
      i - 1 === 2 &&
      isSeedMealProtein(previous.label) &&
      isSeedMealProtein(candidate.label),
    );

    if (shouldDropSeedContinuation) {
      removedSeedContinuation = true;
      continue;
    }

    proteinCandidates.push(candidate);
  }
  const vegCandidates = filtered.filter((c) => c.kind === "veg");
  debug.meal_parser_mode = "sequential";
  debug.meal_seed_continuation_removed = removedSeedContinuation;
  debug.meal_protein_candidates = proteinCandidates.map((c) => ({ label: c.label, grams: c.grams, idx: c.idx }));
  debug.meal_veg_candidates = vegCandidates.map((c) => ({ label: c.label, grams: c.grams, idx: c.idx }));

  // Meal boundaries first: option anchors are matched per meal, never by a
  // blind i/3 split, so a suggestion carrying two protein-ish items (e.g.
  // "30 g Nuts 20 g Sunflower Seeds") does not shift the following meals.
  const mealLabelRe = /\b(Breakfast|Lunch|Dinner)\b/gi;
  const mealBoundaries: { meal: MealKey; start: number }[] = [];
  for (const m of region.matchAll(mealLabelRe)) {
    const key = m[1].toLowerCase() as MealKey;
    if (!mealBoundaries.some((b) => b.meal === key)) {
      mealBoundaries.push({ meal: key, start: m.index ?? 0 });
    }
  }
  const mealRanges: Record<MealKey, { start: number; end: number }> = {
    breakfast: { start: 0, end: region.length },
    lunch: { start: 0, end: region.length },
    dinner: { start: 0, end: region.length },
  };
  const mealChunksByKey: Record<MealKey, string> = { breakfast: "", lunch: "", dinner: "" };
  for (let bi = 0; bi < mealBoundaries.length; bi++) {
    const start = mealBoundaries[bi].start;
    const end = mealBoundaries[bi + 1]?.start ?? region.length;
    mealRanges[mealBoundaries[bi].meal] = { start, end };
    mealChunksByKey[mealBoundaries[bi].meal] = region.slice(start, end);
  }

  // Each suggestion owns the slice of text from its own protein anchor up to
  // the next anchor (or the end of its meal). Everything it contains (Starch,
  // Vegetables, Fruit, Bread, Fat/Oil, units) is read from that slice only —
  // no scavenging of numbers and no meal-wide stamping.
  const usedFallback = mealBoundaries.length < 3;
  for (let mi = 0; mi < 3; mi++) {
    const mealKey = mealKeys[mi];
    const range = mealRanges[mealKey];
    const anchors = usedFallback
      ? proteinCandidates.slice(mi * 3, mi * 3 + 3)
      : proteinCandidates.filter((c) => c.idx >= range.start && c.idx < range.end).slice(0, 3);
    for (let oi = 0; oi < anchors.length; oi++) {
      const nextIdx = anchors[oi + 1]?.idx ?? (usedFallback ? (proteinCandidates[mi * 3 + oi + 1]?.idx ?? region.length) : range.end);
      const slotChunk = region.slice(anchors[oi].idx, nextIdx);
      applyItemsToOption(options[mealKey][oi], tokenizeMealItems(slotChunk));
      if (!options[mealKey][oi].protein_category) {
        options[mealKey][oi].protein_category = anchors[oi].label;
        options[mealKey][oi].protein_grams = anchors[oi].grams;
      }
    }
  }

  debug.meal_chunks = mealChunksByKey;
  debug.meal_items = mealKeys.reduce((acc, mk) => {
    acc[mk] = options[mk].map((o) => o.items);
    return acc;
  }, {} as Record<string, MealItem[][]>);


  for (let mi = 0; mi < 3; mi++) {
    const first = options[mealKeys[mi]][0];
    legacy[`${mealKeys[mi]}_protein_category`] = first.protein_category;
    legacy[`${mealKeys[mi]}_protein_grams`] = first.protein_grams;
    legacy[`${mealKeys[mi]}_veg_grams`] = first.veg_grams;
  }

  return { options, legacy, debug };
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

// ---------- per-client frequency rules ----------

const WORD_NUMBERS: Record<string, number> = {
  one: 1, once: 1, two: 2, twice: 2, three: 3, thrice: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function numFrom(token: string): number | null {
  const t = token.trim().toLowerCase();
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  return WORD_NUMBERS[t] ?? null;
}

const LIMIT_FILLER_RE =
  /\b(maximum|max|minimum|min|of|a|an|the|fresh|whole|raw|organic|free[-\s]?range|small|large|only|no|more|than|up|to|per|times?|week|weekly|eat|eating|have|use|with|and)\b/g;

/**
 * Canonical key for a food phrase: generic plural -> singular, no hand-coded
 * word list, and the head noun kept last so multi-word foods collapse sanely.
 */
function limitKey(phrase: string): string | null {
  const cleaned = phrase
    .toLowerCase()
    .replace(/[^a-z\s-]/g, " ")
    .replace(LIMIT_FILLER_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  const words = cleaned.split(" ").filter(Boolean);
  let head = words[words.length - 1];
  if (!head || head.length < 3) return null;
  // generic singularisation
  if (/ies$/.test(head)) head = head.replace(/ies$/, "y");
  else if (/(ches|shes|sses|xes|zes)$/.test(head)) head = head.replace(/es$/, "");
  else if (/oes$/.test(head)) head = head.replace(/es$/, "");
  else if (/[^s]s$/.test(head)) head = head.replace(/s$/, "");
  return head.length >= 3 ? head : null;
}

/**
 * Merge a limit into the map. Colliding keys never silently overwrite: the more
 * restrictive (lower) weekly count wins, so two rules about the same food can't
 * cancel each other out depending on document order.
 */
function mergeLimit(out: Record<string, number>, key: string | null, max: number) {
  if (!key) return;
  if (!Number.isFinite(max) || max <= 0 || max > 100) return;
  out[key] = key in out ? Math.min(out[key], max) : max;
}

/**
 * Extract every weekly frequency rule expressed in the text, in any of the
 * phrasings MB documents use:
 *   "2 avocados per week", "no more than three times a week" (subject before),
 *   "eat potatoes with eggs only twice per week".
 */
function parseFoodLimits(text: string): Record<string, number> {
  const out: Record<string, number> = {};

  // Pattern A: "<N|word> <food> per week" / "<N> <food> a week"
  const reA = /(\d+|[a-z]+)\s*(?:[-–]\s*(\d+))?\s+([A-Za-z][A-Za-z\- ]{1,40}?)\s+(?:per|a|each)\s*week/gi;
  let m: RegExpExecArray | null;
  while ((m = reA.exec(text)) !== null) {
    const lo = numFrom(m[1]);
    const hi = m[2] ? parseInt(m[2], 10) : null;
    const max = hi ?? lo;
    if (max == null) continue;
    mergeLimit(out, limitKey(m[3]), max);
  }

  // Pattern B: "<food> ... no more than <N|word> times a week" — subject comes first.
  const reB =
    /([A-Za-z][A-Za-z\- ]{2,40}?)\s+(?:[^.\n]{0,40}?)\b(?:no more than|not more than|only|max(?:imum)?(?: of)?)\s+(\d+|[a-z]+)\s*(?:times?|x)?\s*(?:per|a|each)\s*week/gi;
  while ((m = reB.exec(text)) !== null) {
    const max = numFrom(m[2]);
    if (max == null) continue;
    mergeLimit(out, limitKey(m[1]), max);
  }

  // Pattern C: "eat <food> ... twice per week" (verb-led, no "no more than").
  const reC =
    /\b(?:eat|have|use|include)\s+([A-Za-z][A-Za-z\- ]{2,40}?)\s+(?:[^.\n]{0,40}?)\b(\d+|once|twice|thrice|one|two|three|four|five|six|seven)\s*(?:times?|x)?\s*(?:per|a|each)\s*week/gi;
  while ((m = reC.exec(text)) !== null) {
    const max = numFrom(m[2]);
    if (max == null) continue;
    mergeLimit(out, limitKey(m[1]), max);
  }

  // Eggs may also appear as "min N max M eggs" (handled by parseEggs); merge in.
  const eggs = parseEggs(text);
  if (eggs.eggs_max_per_week) mergeLimit(out, "egg", eggs.eggs_max_per_week);
  return out;
}

/**
 * Per-client meal-swap adjustment ("you may swap lunch and dinner…") and
 * treat-meal timing ("your treat meal is on Saturday…"). Returns the sentence
 * as printed, so nothing is lost to paraphrasing.
 */
function parseMealRules(text: string): { meal_swap: string | null; treat_meal: string | null } {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12 && s.length < 400);
  const find = (re: RegExp) => sentences.find((s) => re.test(s)) ?? null;
  return {
    meal_swap: find(/\b(?:swap|exchange|interchange|switch)\b[^.]{0,80}\b(?:lunch|dinner|breakfast|meals?)\b/i),
    treat_meal:
      find(/\b(?:treat|cheat|free|celebration)\s*(?:meal|day)\b/i) ??
      find(/\b(?:treat|cheat)\b[^.]{0,60}\b(?:once|week|day)\b/i),
  };
}


// Water is only read from the "Water" row/heading (Classic title case or New
// ALL-CAPS), never from the first litre-looking number anywhere in the document.
const WATER_QTY_RE =
  /(\d+(?:[.,]\d+)?(?:\s*[\u00BD\u00BC\u00BE\u2153\u2154])?(?:\s*\d\/\d)?|[\u00BD\u00BC\u00BE\u2153\u2154])\s*(?:l\b|l(?:iters?|itres?)\b|L\b)/i;

function parseWater(text: string): number | null {
  const rowRe = /\bWATER\b/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(text)) !== null) {
    // Only look inside the Water row itself (rest of line, or 120 chars if flattened).
    const after = text.slice(m.index + m[0].length);
    const lineEnd = after.search(/\n/);
    const scope = after.slice(0, lineEnd >= 0 ? Math.min(lineEnd, 120) : 120);
    const q = scope.match(WATER_QTY_RE);
    if (q) {
      const val = normalizeWater(q[1]);
      if (val != null && val > 0 && val <= 10) return val;
    }
  }
  return null;
}


function sliceBetween(text: string, startAnchor: RegExp, endAnchor: RegExp | null): string | null {
  const s = text.search(startAnchor);
  if (s < 0) return null;
  const rest = text.slice(s);
  if (!endAnchor) return rest;
  const e = rest.slice(50).search(endAnchor);
  return e < 0 ? rest : rest.slice(0, 50 + e);
}

/**
 * Foods named in the Shopping Helper / Shopping Bag section. Used only as a
 * cross-check signal in debug output — the canonical Personal Food List
 * remains the single source of truth for the stored food_* fields.
 */
function shoppingHelperFoods(fullText: string, stripFooter: (s: string) => string): string[] {
  const sec = sliceBetween(fullText, /Shopping\s*(?:Helper|Bag)/i, /Extended personal Food List|\$\$CA_PHASE4\$\$/i);
  if (!sec) return [];
  const items = splitTopLevel(stripFooter(sec))
    .filter((s) => /[A-Za-z]/.test(s) && !ARTIFACT_RE.test(s) && s.length <= 60 && !isNoteFragment(s));
  return Array.from(new Set(items));
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
    const stripFooter = buildFooterStripper();

    debug.step = "download_pdf";
    const { data: file, error: dErr } = await admin.storage.from("mb-pdfs").download(storagePath);
    if (dErr || !file) {
      return new Response(JSON.stringify({ error: "pdf_not_found", detail: dErr?.message }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    debug.step = "extract_pdf_text";
    const buf = new Uint8Array(await file.arrayBuffer());
    const pdf = await getDocumentProxy(buf);
    const { text: pages } = await extractText(pdf, { mergePages: false });
    const rawText = Array.isArray(pages) ? pages.join("\n\n") : String(pages);
    // Soft hyphens must go before ANY matching happens.
    const fullText = stripSoftHyphens(rawText);

    debug.step = "detect_format";
    const format = detectFormat(fullText);
    debug.format = format;
    if (format === "unsupported") {
      return new Response(JSON.stringify({
        error: "unsupported_layout",
        detail: "This plan layout isn't supported. Please upload the standard Metabolic Balance plan, not the picture version.",
        format,
        debug,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const footerIdentity = extractFooterIdentity(fullText);
    debug.footerIdentity = footerIdentity;

    debug.step = "parse_pdf_sections";
    // Heading matching is case-insensitive and treats hyphen/en-dash/em-dash as
    // equivalent (and optional), so Classic title case and New ALL-CAPS both match.
    const phase2ProteinSection = sliceBetween(fullText, /Personal Food List\s*(?:[-–—:]\s*)?Protein/i, /Personal Food List\s*(?:[-–—:]\s*)?Carbohydrates|Additional Information about the Meal Plan|\$\$CA_PHASE3\$\$/i);
    const phase2CarbSection = sliceBetween(fullText, /Personal Food List\s*(?:[-–—:]\s*)?Carbohydrates/i, /Additional Information about the Meal Plan|\$\$CA_PHASE3\$\$|Extended personal Food List/i);
    const additionalInfoSection = sliceBetween(fullText, /Additional Information about the Meal Plan/i, /\$\$CA_PHASE3\$\$|Extended personal Food List/i);
    // Phase 3: bound on the shopping section to avoid pulling the combined list.
    const phase3SectionRaw = sliceBetween(fullText, /Extended personal Food List/i, /Shopping\s*(?:Helper|Bag)/i)
      ?? sliceBetween(fullText, /\$\$CA_PHASE3\$\$/i, /Shopping\s*(?:Helper|Bag)/i);
    const phase3Section = phase3SectionRaw ? stripFooter(phase3SectionRaw) : null;

    const mealTableEnd = fullText.search(/Personal Food List\s*(?:[-–—:]\s*)?Protein/i);

    const mealTableText = mealTableEnd > 0 ? fullText.slice(Math.max(0, mealTableEnd - 4000), mealTableEnd) : fullText.slice(0, 4000);
    // The meal grid is the page where three "Breakfast" headers sit at three
    // distinct x positions — prose pages that merely mention the meal names
    // never satisfy that, so the column parser can't latch onto the wrong page.
    let mealPageIndex = -1;
    let mealPositionedItems: PositionedText[] = [];
    const candidatePages = Array.isArray(pages)
      ? pages.map((t, i) => ({ t: despace(t), i })).filter(({ t }) => t.includes("breakfast") && t.includes("lunch") && t.includes("dinner"))
      : [];

    for (const { i } of candidatePages) {
      try {
        const page = await (pdf as { getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: Array<Record<string, unknown>> }> }> })
          .getPage(i + 1);
        const content = await page.getTextContent();
        const items = extractPositionedTextForPage({ content });
        const anchors = findColumnAnchors(items);

        if (anchors.length >= 3) {
          mealPageIndex = i;
          mealPositionedItems = items;
          break;
        }
        if (mealPageIndex < 0 && !mealPositionedItems.length) mealPositionedItems = items;
      } catch (err) {
        debug.meal_positioned_error = String(err);
      }
    }
    debug.meal_positioned_count = mealPositionedItems.length;
    


    const { options: mealOptions, legacy: mealLegacy, debug: mealDebug } = parseMealTable(stripFooter(mealTableText), mealPositionedItems);
    debug.meal_parser = mealDebug;


    // Names that must never survive as a food (page-footer bleed).
    const clientNames = Array.from(new Set([
      footerIdentity.clientName ?? "",
      String(clientRow.name ?? ""),
      footerIdentity.coachName ?? "",
    ].map((s) => s.trim()).filter((s) => s.length >= 3)));

    const p2Protein = phase2ProteinSection
      ? parseFoodSection(phase2ProteinSection, PHASE2_PROTEIN_CATEGORIES, stripFooter, clientNames)
      : { foods: {}, notes: {} };
    const phase2Proteins = p2Protein.foods;
    const foodNotes: Record<string, string> = { ...p2Protein.notes };


    // Fallback: extract Sunflower Seeds from Phase 2 protein section if the main parser missed it.
    // Only default to "Sunflower Seeds" when the heading is ACTUALLY present in the PDF.
    if (phase2ProteinSection && !phase2Proteins["food_sunflower_seeds"]) {
      const protLabels = Object.keys(PHASE2_PROTEIN_CATEGORIES).filter((l) => !/sunflower/i.test(l));
      const sunMatch = phase2ProteinSection.match(/sunflower[^\n]*?(?:seeds?)?[:\s-]*/i);
      const sunflowerHeadingFound = !!sunMatch;
      if (sunMatch && sunMatch.index !== undefined) {
        const start = sunMatch.index + sunMatch[0].length;
        const rest = phase2ProteinSection.slice(start);
        const stopRe = new RegExp(
          `\\b(?:${protLabels.map((l) => l.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")).join("|")}|Personal Food List|Additional Information|Extended personal|Shopping (?:Helper|Bag))\\b`,
          "i",
        );
        const stopMatch = rest.match(stopRe);
        let chunk = stopMatch && stopMatch.index !== undefined ? rest.slice(0, stopMatch.index) : rest;
        chunk = stripFooter(chunk);
        const items = chunk
          .split(/[,;\n]+/)
          .map((s) => s.replace(/\s+/g, " ").trim())
          .filter(Boolean)
          .filter((s) => {
            if (s.length < 2 || s.length > 60) return false;
            if (/Personal Food List|Additional Information|Extended personal|Shopping (?:Helper|Bag)|Page\s*\d|©|Metabolic Balance/i.test(s)) return false;
            if (!/[A-Za-z]/.test(s)) return false;
            if (s.split(/\s+/).length > 5) return false;
            return true;
          });
        if (items.length) {
          phase2Proteins["food_sunflower_seeds"] = Array.from(new Set(items)).join(", ");
        } else if (sunflowerHeadingFound) {
          // Heading present but no items listed under it — default to category name.
          phase2Proteins["food_sunflower_seeds"] = "Sunflower Seeds";
        }
        console.log("[parse-mb-pdf] sunflower seeds fallback", { headingFound: sunflowerHeadingFound, found: items.length, items });
      } else {
        // Heading not found at all — leave field empty (PDF has no Sunflower Seeds).
        console.log("[parse-mb-pdf] sunflower seeds heading not found in phase2 protein section — leaving empty");
      }
    }

    // Fallback: extract Pumpkin Seeds from Phase 2 protein section if the main parser missed it.
    // Mirrors the Sunflower Seeds fallback above.
    if (phase2ProteinSection && !phase2Proteins["food_pumpkin_seeds"]) {
      const protLabels = Object.keys(PHASE2_PROTEIN_CATEGORIES).filter((l) => !/pumpkin/i.test(l));
      const pumpMatch = phase2ProteinSection.match(/pumpkin[^\n]*?(?:seeds?)?[:\s-]*/i);
      const pumpkinHeadingFound = !!pumpMatch;
      if (pumpMatch && pumpMatch.index !== undefined) {
        const start = pumpMatch.index + pumpMatch[0].length;
        const rest = phase2ProteinSection.slice(start);
        const stopRe = new RegExp(
          `\\b(?:${protLabels.map((l) => l.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")).join("|")}|Personal Food List|Additional Information|Extended personal|Shopping (?:Helper|Bag))\\b`,
          "i",
        );
        const stopMatch = rest.match(stopRe);
        let chunk = stopMatch && stopMatch.index !== undefined ? rest.slice(0, stopMatch.index) : rest;
        chunk = stripFooter(chunk);
        const items = chunk
          .split(/[,;\n]+/)
          .map((s) => s.replace(/\s+/g, " ").trim())
          .filter(Boolean)
          .filter((s) => {
            if (s.length < 2 || s.length > 60) return false;
            if (/Personal Food List|Additional Information|Extended personal|Shopping (?:Helper|Bag)|Page\s*\d|©|Metabolic Balance/i.test(s)) return false;
            if (!/[A-Za-z]/.test(s)) return false;
            if (s.split(/\s+/).length > 5) return false;
            return true;
          });
        if (items.length) {
          phase2Proteins["food_pumpkin_seeds"] = Array.from(new Set(items)).join(", ");
        } else if (pumpkinHeadingFound) {
          phase2Proteins["food_pumpkin_seeds"] = "Pumpkin Seeds";
        }
        console.log("[parse-mb-pdf] pumpkin seeds fallback", { headingFound: pumpkinHeadingFound, found: items.length, items });
      } else {
        console.log("[parse-mb-pdf] pumpkin seeds heading not found in phase2 protein section — leaving empty");
      }
    }

    const p2Carb = phase2CarbSection
      ? parseFoodSection(phase2CarbSection, PHASE2_CARB_CATEGORIES, stripFooter, clientNames)
      : { foods: {}, notes: {} };
    const phase2Carbs = p2Carb.foods;
    Object.assign(foodNotes, p2Carb.notes);


    // Fallback: same-line Starch extraction (e.g. "Starch Oatmeal" on a single line
    // followed by a note that defeats the multi-line parser).
    if (phase2CarbSection && !phase2Carbs["food_starch"]) {
      const m = phase2CarbSection.match(/^\s*Starch\s+([^\n]+)/im);
      if (m) {
        let rest = m[1].trim();
        // Stop at any subsequent carb category keyword on the same line
        const stopRe = /\b(?:Vegetables|Veg\.?\s*\/?\s*Lettuce|Bread|Fruit)\b/i;
        const sm = rest.match(stopRe);
        if (sm && sm.index !== undefined) rest = rest.slice(0, sm.index).trim();
        rest = stripFooter(rest);
        const items = rest
          .split(/[,;]+/)
          .map((s) => s.replace(/\s+/g, " ").trim())
          .filter((s) => s.length >= 2 && s.length <= 60 && /[A-Za-z]/.test(s) && s.split(/\s+/).length <= 5);
        if (items.length) {
          phase2Carbs["food_starch"] = Array.from(new Set(items)).join(", ");
          console.log("[parse-mb-pdf] starch same-line fallback", items);
        }
      }
    }
    // ---- Phase 3 (Extended personal Food List): ONE parser, same as Phase 2 ----
    const _lastExtIdx = fullText.lastIndexOf("Extended personal Food List");
    const _shopMatch = _lastExtIdx !== -1
      ? fullText.slice(_lastExtIdx).match(/Shopping\s*(?:Helper|Bag)/i)
      : null;
    const _lastShopIdx = _shopMatch && _shopMatch.index !== undefined ? _lastExtIdx + _shopMatch.index : -1;
    let _p3Section = "";
    if (_lastExtIdx !== -1) {
      _p3Section = _lastShopIdx > _lastExtIdx
        ? fullText.slice(_lastExtIdx, _lastShopIdx)
        : fullText.slice(_lastExtIdx, _lastExtIdx + 3000);
    }
    const p3Text = _p3Section || phase3Section || "";
    const p3Parsed = p3Text
      ? parseFoodSection(p3Text, PHASE3_CATEGORIES, stripFooter, clientNames)
      : { foods: {}, notes: {} };
    const phase3: Record<string, string | null> = { ...p3Parsed.foods };
    for (const [k, v] of Object.entries(p3Parsed.notes)) foodNotes[k] = v;
    debug.phase3_fields = Object.keys(phase3);




    let eggs = { eggs_min_per_week: null as number | null, eggs_max_per_week: null as number | null };
    let water: number | null = null;
    let foodLimits: Record<string, number> = {};
    if (additionalInfoSection) {
      eggs = parseEggs(additionalInfoSection);
      water = parseWater(additionalInfoSection);
      foodLimits = parseFoodLimits(additionalInfoSection);
    }

    // The rules split out of the food-list categories are per-client guidance —
    // mine them for frequency limits too, then keep the remainder as category
    // notes (foodNotes already carries them, keyed by field).
    for (const [field, note] of Object.entries(foodNotes)) {
      if (!note) continue;
      for (const [k, v] of Object.entries(parseFoodLimits(note))) {
        foodLimits[k] = k in foodLimits ? Math.min(foodLimits[k], v) : v;
      }
      void field;
    }

    // Meal-swap adjustment and treat-meal timing (per-client, verbatim).
    const mealRules = (() => {
      const scoped = parseMealRules(additionalInfoSection || "");
      if (scoped.meal_swap && scoped.treat_meal) return scoped;
      const wide = parseMealRules(fullText);
      return {
        meal_swap: scoped.meal_swap ?? wide.meal_swap,
        treat_meal: scoped.treat_meal ?? wide.treat_meal,
      };
    })();

    // Water may live outside the "Additional Information" block in the New layout.
    if (water == null) water = parseWater(fullText);
    const waterMl = water == null ? null : Math.round(water * 1000);

    const sanitizeExtractedValue = (value: unknown) => {
      if (typeof value !== "string") return value ?? null;
      let cleaned = value.replace(/\r\n/g, "\n").trim();
      cleaned = stripFooter(cleaned);
      // Strip page-footer bleed from first " | " onwards
      const pipeIdx = cleaned.indexOf(" | ");
      if (pipeIdx >= 0) cleaned = cleaned.slice(0, pipeIdx).trim();
      // Strip trailing bare page number
      cleaned = cleaned.replace(/\s+\d+\s*$/g, "").trim();
      return cleaned.replace(/\s+/g, " ").replace(/[\s,;|]+$/g, "").trim();
    };

    const buildField = (v: unknown, _field?: string) => {
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
    for (const f of unique(phase2ProteinFields)) result[f] = buildField(phase2Proteins[f] ?? "", f);
    for (const f of unique(phase2CarbFields)) result[f] = buildField(phase2Carbs[f] ?? "", f);
    for (const f of unique(phase3Fields)) result[f] = buildField(phase3[f] ?? "", f);
    for (const k of Object.keys(mealLegacy)) result[k] = buildField(mealLegacy[k], k);
    result.eggs_min_per_week = buildField(eggs.eggs_min_per_week, "eggs_min_per_week");
    result.water_target_litres = buildField(water, "water_target_litres");
    // eggs max is captured (not dropped) and surfaced through food_limits + extras,
    // since clients has no eggs_max_per_week / water_target_ml column.
    if (eggs.eggs_max_per_week != null) {
      foodLimits.egg = "egg" in foodLimits
        ? Math.min(foodLimits.egg, eggs.eggs_max_per_week)
        : eggs.eggs_max_per_week;
    }
    result.food_limits = { value: foodLimits, extracted: Object.keys(foodLimits).length > 0 };


    const mealOptionsResult: Record<string, MealOption[]> = {
      breakfast: mealOptions.breakfast,
      lunch: mealOptions.lunch,
      dinner: mealOptions.dinner,
    };

    // Extract "Foods Not Included in This Plan" cover-page list.
    const foodExclusions: string[] | null = (() => {
      const headingRe = /Foods\s+Not\s+Included\s+in\s+This\s+Plan/i;
      const m = fullText.match(headingRe);
      if (!m || m.index === undefined) return null;
      const after = fullText.slice(m.index + m[0].length);
      // Stop at next major section / page artifact.
      const stopRe = /(Personal Food List|Additional Information|Extended personal|Shopping (?:Helper|Bag)|©\s*Metabolic Balance|Page\s*\d|Breakfast\b|Lunch\b|Dinner\b|\$\$CA_)/i;
      const sm = after.match(stopRe);
      let chunk = sm && sm.index !== undefined ? after.slice(0, sm.index) : after.slice(0, 600);
      chunk = stripFooter(chunk);
      const items = chunk
        .split(/[,;\n•·\-]+/)
        .map((s) => s.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .filter((s) => {
          if (s.length < 2 || s.length > 60) return false;
          if (!/^[A-Za-z]/.test(s)) return false;
          if (s.split(/\s+/).length > 5) return false;
          if (/Foods\s+Not\s+Included/i.test(s)) return false;
          return true;
        });
      const unique = Array.from(new Set(items));
      return unique.length ? unique : null;
    })();

    // ---- Validation: never return a silent success on an empty parse ----
    debug.step = "validate";
    const validation: string[] = [];
    const optionCount = (["breakfast", "lunch", "dinner"] as const)
      .reduce((n, k) => n + mealOptionsResult[k].filter((o) => (o.items?.length ?? 0) > 0 || o.protein_category).length, 0);
    if (optionCount === 0) validation.push("meal_options");
    const foodFieldKeys = [
      ...unique(phase2ProteinFields),
      ...unique(phase2CarbFields),
    ];
    const filledFoodFields = foodFieldKeys.filter((f) => result[f]?.extracted).length;
    if (filledFoodFields === 0) validation.push("food_categories");
    if (water == null) validation.push("water_target");
    if (!footerIdentity.clientName) validation.push("client_name");
    if (!footerIdentity.coachName) validation.push("coach_name");

    const needsReview = validation.length > 0;

    debug.step = "complete";
    return new Response(JSON.stringify({
      fields: result,
      mealOptions: mealOptionsResult,
      foodExclusions,
      foodNotes,
      shoppingCrossCheck: (() => {
        const shop = shoppingHelperFoods(fullText, stripFooter);
        if (!shop.length) return null;
        const parsedAll = new Set(
          [...Object.values(phase2Proteins), ...Object.values(phase2Carbs)]
            .flatMap((v) => splitTopLevel(String(v ?? "")))
            .map((s) => s.toLowerCase().replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim()),
        );
        const missing = shop.filter((s) => {
          const k = s.toLowerCase().replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim();
          return k.length > 2 && !parsedAll.has(k);
        });
        return { shoppingCount: shop.length, missingFromFoodList: missing.slice(0, 40) };
      })(),

      storagePath,
      format,
      clientName: footerIdentity.clientName,
      coachName: footerIdentity.coachName,
      waterTargetLitres: water,
      waterTargetMl: waterMl,
      eggsMinPerWeek: eggs.eggs_min_per_week,
      eggsMaxPerWeek: eggs.eggs_max_per_week,
      needsReview,
      validation,
      mealParserMode: (mealDebug as { meal_parser_mode?: string }).meal_parser_mode ?? null,
      mealParserDebug: {
        pageIndex: mealPageIndex,
        positionedCount: mealPositionedItems.length,
        positionedError: debug.meal_positioned_error ?? null,
        columnX: (mealDebug as { column_x?: number[] }).column_x ?? null,
      },



    }), {
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
