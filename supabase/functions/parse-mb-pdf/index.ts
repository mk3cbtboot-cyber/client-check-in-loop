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

function stripTrailingClientName(value: string, firstName: string, lastName: string): string {
  let out = value;
  if (firstName && lastName) {
    const pattern = new RegExp(`\\s+${escapeRegExp(firstName)}\\s+${escapeRegExp(lastName)}$`, "i");
    out = out.replace(pattern, "").trim();
  }
  if (firstName) {
    out = out.replace(new RegExp(`\\s+${escapeRegExp(firstName)}$`, "i"), "").trim();
  }
  if (lastName) {
    out = out.replace(new RegExp(`\\s+${escapeRegExp(lastName)}$`, "i"), "").trim();
    // Fallback 1: optional preceding word + last name at end of string
    out = out.replace(new RegExp(`\\s+\\S+\\s+${escapeRegExp(lastName)}\\s*$`, "i"), "").trim();
    // Fallback 2: last name alone at end of string (with any whitespace)
    out = out.replace(new RegExp(`\\s+${escapeRegExp(lastName)}\\s*$`, "i"), "").trim();
  }
  return out;
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

type MealOption = {
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

function isSeedMealProtein(label: string): boolean {
  const normalized = label.replace(/\s+/g, " ").trim().toLowerCase();
  return ["sunflower seeds", "pumpkin seeds", "sesame seeds", "hemp seeds", "flaxseeds"].includes(normalized);
}

function getTrailingClientNamePatterns(firstName: string, lastName: string): string[] {
  const patterns: string[] = [];
  if (firstName && lastName) patterns.push(`\\s+${escapeRegExp(firstName)}\\s+${escapeRegExp(lastName)}$`);
  if (firstName) patterns.push(`\\s+${escapeRegExp(firstName)}$`);
  if (lastName) patterns.push(`\\s+${escapeRegExp(lastName)}$`);
  return patterns;
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
  const options = createEmptyMealOptions();
  const legacy: Record<string, string | number | null> = {};
  const debug: Record<string, unknown> = {};
  const mealKeys: MealKey[] = ["breakfast", "lunch", "dinner"];

  const startIdx = text.search(/\bBreakfast\b/i);
  const endIdx = text.search(/Personal Food List/i);
  let region = text.slice(startIdx >= 0 ? startIdx : 0, endIdx > 0 ? endIdx : text.length);
  region = preprocessMealRegion(region);

  const proteinLabels = Object.keys(PHASE2_PROTEIN_CATEGORIES);
  const vegLabels = ["Vegetables", "Vegetable", "Veg./Lettuce", "Veg. /Lettuce", "Veg/Lettuce", "Vegetable/Lettuce"];
  const allLabels = [...proteinLabels, ...vegLabels];
  allLabels.sort((a, b) => b.length - a.length);
  const labelAlt = allLabels.map((l) => escapeRegExp(l)).join("|");
  const vegLabelAlt = vegLabels.map((l) => escapeRegExp(l)).join("|");

  const gramRe = new RegExp(`(\\d{2,4})\\s*g\\s+(${labelAlt})\\b`, "gi");
  const gramReReversed = new RegExp(`(${labelAlt})\\s+(\\d{2,4})\\s*g\\b`, "gi");
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

  const extractVegGramsForSlot = (slotChunk: string, proteinGrams: number | null): number | null => {
    const explicitForward = new RegExp(`(\\d{2,4})\\s*g\\s+(?:${vegLabelAlt})\\b`, "i");
    const explicitReverse = new RegExp(`(?:${vegLabelAlt})\\s+(\\d{2,4})\\s*g\\b`, "i");
    const forwardMatch = slotChunk.match(explicitForward);
    if (forwardMatch) {
      const grams = parseInt(forwardMatch[1], 10);
      if (Number.isFinite(grams) && grams !== proteinGrams) return grams;
    }
    const reverseMatch = slotChunk.match(explicitReverse);
    if (reverseMatch) {
      const grams = parseInt(reverseMatch[1], 10);
      if (Number.isFinite(grams) && grams !== proteinGrams) return grams;
    }

    const numberMatches = Array.from(slotChunk.matchAll(/\b(\d{2,4})\b(?:\s*g\b)?/gi))
      .map((match) => parseInt(match[1], 10))
      .filter((grams) => Number.isFinite(grams) && grams !== proteinGrams && grams >= 80 && grams <= 250);

    const preferred = numberMatches.find((grams) => grams >= 100 && grams <= 200);
    return preferred ?? numberMatches[0] ?? null;
  };

  for (let i = 0; i < Math.min(9, proteinCandidates.length); i++) {
    const mi = Math.floor(i / 3);
    const oi = i % 3;
    options[mealKeys[mi]][oi].protein_category = proteinCandidates[i].label;
    options[mealKeys[mi]][oi].protein_grams = proteinCandidates[i].grams;
    const nextProteinIdx = proteinCandidates[i + 1]?.idx ?? region.length;
    const slotChunk = region.slice(proteinCandidates[i].end, nextProteinIdx);
    options[mealKeys[mi]][oi].veg_grams = extractVegGramsForSlot(slotChunk, proteinCandidates[i].grams);
    if (options[mealKeys[mi]][oi].veg_grams == null && vegCandidates[i]) {
      options[mealKeys[mi]][oi].veg_grams = vegCandidates[i].grams;
    }
  }

  const mealChunks = region.split(/\b5\s*h(?:rs?)?\b/i).map((c) => c.trim()).filter(Boolean);
  debug.meal_chunks = mealChunks;
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
// Only section-level boundaries — NOT "From now on"/"Please note"/"Note:" (those
// can appear between items in Fat/Oil etc. and would truncate the list early).
const PHASE3_BOUNDARY_KEYWORDS = /\b(Poultry|Fruit|Bread|Starch|Nuts|Yogurt|Milk Products|Pumpkin Seeds|Sunflower Seeds|Shopping Helper)\b/i;

function parsePhase3SectionByKeyword(
  section: string,
  stripFooter: (s: string) => string,
  debugLog: { headings: { field: string; heading: string; index: number }[]; missing: string[]; fatOilLines: string[] },
): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = section.split(/\r?\n/);

  // Build line-start anchored matchers for each Phase 3 spec.
  const anchoredSpecs = PHASE3_SPECS.map((s) => ({
    field: s.field,
    match: new RegExp(`^\\s*(?:${s.match.source})\\b`, "i"),
    reject: s.reject,
  }));

  // Boundary keywords at line start (other category names that end a section).
  const boundaryLineRe = new RegExp(`^\\s*(?:${PHASE3_BOUNDARY_KEYWORDS.source.replace(/^\\b|\\b$/g, "")})\\b`, "i");
  const boundaryAtLineStart = (ln: string): boolean => {
    if (boundaryLineRe.test(ln)) return true;
    for (const sp of anchoredSpecs) {
      if (sp.match.test(ln)) return true;
    }
    return false;
  };

  type Hit = { field: string; lineIdx: number; rest: string; heading: string };
  const hits: Hit[] = [];
  const seen = new Set<string>();
  for (let li = 0; li < lines.length; li++) {
    const ln = lines[li];
    for (const sp of anchoredSpecs) {
      if (seen.has(sp.field)) continue;
      const m = ln.match(sp.match);
      if (!m) continue;
      const around = ln.slice(0, m[0].length + 8);
      if (sp.reject && sp.reject.test(around)) continue;
      const rest = ln.slice(m[0].length);
      hits.push({ field: sp.field, lineIdx: li, rest, heading: m[0].trim() });
      seen.add(sp.field);
      debugLog.headings.push({ field: sp.field, heading: m[0].trim(), index: li });
      break;
    }
  }
  for (const sp of PHASE3_SPECS) if (!seen.has(sp.field)) debugLog.missing.push(sp.field);

  if (!hits.length) return out;
  hits.sort((a, b) => a.lineIdx - b.lineIdx);

  for (let i = 0; i < hits.length; i++) {
    const cur = hits[i];
    const collected: string[] = [];
    // Heading line: take rest verbatim (do NOT apply boundary stop on same line).
    if (cur.rest.trim()) collected.push(cur.rest);
    const nextHitLine = i + 1 < hits.length ? hits[i + 1].lineIdx : lines.length;
    for (let li = cur.lineIdx + 1; li < nextHitLine; li++) {
      if (boundaryAtLineStart(lines[li])) break;
      collected.push(lines[li]);
    }
    let chunk = collected.join("\n");
    if (cur.field === "phase3_mb_fat_oil") {
      debugLog.fatOilLines = chunk.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      console.log("[parse-mb-pdf] phase3 fat_oil raw lines", debugLog.fatOilLines);
    }
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
      out[cur.field] = Array.from(new Set(items)).join(", ");
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
    const mealPageIndex = Array.isArray(pages)
      ? pages.findIndex((pageText) => /\bBreakfast\b/i.test(pageText) && /\bLunch\b/i.test(pageText) && /\bDinner\b/i.test(pageText))
      : -1;
    const mealPage = mealPageIndex >= 0 && Array.isArray((pdf as { pages?: unknown[] }).pages)
      ? (pdf as { pages?: unknown[] }).pages?.[mealPageIndex]
      : null;
    const mealPositionedItems = mealPage ? extractPositionedTextForPage(mealPage) : [];
    const { options: mealOptions, legacy: mealLegacy, debug: mealDebug } = parseMealTable(stripFooter(mealTableText), mealPositionedItems);
    debug.meal_parser = mealDebug;

    const phase2Proteins = phase2ProteinSection ? parseFoodSection(phase2ProteinSection, PHASE2_PROTEIN_CATEGORIES, stripFooter) : {};

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
          `\\b(?:${protLabels.map((l) => l.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")).join("|")}|Personal Food List|Additional Information|Extended personal|Shopping Helper)\\b`,
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
            if (/Personal Food List|Additional Information|Extended personal|Shopping Helper|Page\s*\d|©|Metabolic Balance/i.test(s)) return false;
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

    const phase2Carbs = phase2CarbSection ? parseFoodSection(phase2CarbSection, PHASE2_CARB_CATEGORIES, stripFooter) : {};

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
    const phase3: Record<string, string | null> = {};

    const extractP3Field = (keyword: string, text: string): string | null => {
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const m = text.match(new RegExp('\\n' + escaped + '\\n\\n([^\\n]+)'));
      return m ? m[1].trim() : null;
    };

    const p3AnchorIdx = fullText.indexOf('$CA_PHASE3$');
    let p3Section = '';
    if (p3AnchorIdx !== -1) {
      const p3Text = fullText.slice(p3AnchorIdx);
      const extIdx = p3Text.indexOf('Extended personal Food List');
      const shopIdx = extIdx !== -1 ? p3Text.indexOf('Shopping Helper Phase 3', extIdx) : -1;
      if (extIdx !== -1 && shopIdx !== -1) {
        p3Section = p3Text.slice(extIdx, shopIdx);
      } else if (extIdx !== -1) {
        p3Section = p3Text.slice(extIdx, extIdx + 1000);
      }
    }

    phase3['phase3_debug'] = JSON.stringify({
      hasAnchor: fullText.includes('$CA_PHASE3$'),
      anchorIdx: fullText.indexOf('$CA_PHASE3$'),
      textLength: fullText.length,
      last500: fullText.slice(-500),
      aroundAnchor: fullText.includes('$CA_PHASE3$')
        ? fullText.slice(fullText.indexOf('$CA_PHASE3$') - 50, fullText.indexOf('$CA_PHASE3$') + 300)
        : 'not found',
      p3SectionLength: p3Section.length,
      p3SectionStart: p3Section.slice(0, 200)
    });

    phase3['phase3_mb_fish'] = JSON.stringify({
      hasAnchor: fullText.includes('$CA_PHASE3$'),
      anchorIdx: fullText.indexOf('$CA_PHASE3$'),
      textLen: fullText.length,
      aroundAnchor: fullText.includes('$CA_PHASE3$')
        ? fullText.slice(fullText.indexOf('$CA_PHASE3$') - 30, fullText.indexOf('$CA_PHASE3$') + 200)
        : 'NOT FOUND — last 200: ' + fullText.slice(-200),
      p3SectionLen: p3Section.length,
      p3SectionStart: p3Section.slice(0, 150)
    });
    phase3['phase3_mb_seafood']     = extractP3Field('Seafood', p3Section);
    phase3['phase3_mb_meat']        = extractP3Field('Meat', p3Section);
    phase3['phase3_mb_cheese']      = extractP3Field('Cheese', p3Section);
    phase3['phase3_mb_legumes']     = extractP3Field('Legumes', p3Section);
    phase3['phase3_mb_vegetables']  = extractP3Field('Vegetables', p3Section);
    phase3['phase3_mb_veg_lettuce'] = extractP3Field('Veg./Lettuce', p3Section);
    phase3['phase3_mb_sprouts']     = extractP3Field('Sprouts', p3Section);
    phase3['phase3_mb_fat_oil']     = extractP3Field('Fat / Oil', p3Section);
    console.log("[parse-mb-pdf] phase3 extraction", { found: Object.entries(phase3).filter(([,v])=>v).map(([k])=>k) });


    let eggs = { eggs_min_per_week: null as number | null, eggs_max_per_week: null as number | null };
    let water: number | null = null;
    if (additionalInfoSection) {
      eggs = parseEggs(additionalInfoSection);
      water = parseWater(additionalInfoSection);
    }

    const clientNameTrimmed = (clientRow.name ?? "").trim();
    const nameParts = clientNameTrimmed.split(/\s+/).filter((p) => p.length >= 2);
    const firstName = nameParts[0] ?? "";
    const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : "";

    const sanitizeExtractedValue = (value: unknown) => {
      if (typeof value !== "string") return value ?? null;
      let cleaned = value.replace(/\r\n/g, "\n").trim();
      // Strip page-footer bleed from first " | " onwards
      const pipeIdx = cleaned.indexOf(" | ");
      if (pipeIdx >= 0) cleaned = cleaned.slice(0, pipeIdx).trim();
      // Strip trailing bare page number
      cleaned = cleaned.replace(/\s+\d+\s*$/g, "").trim();
      cleaned = stripFooter(cleaned);
      cleaned = stripTrailingName(cleaned);
      let prev = "";
      while (prev !== cleaned) {
        prev = cleaned;
        cleaned = stripTrailingClientName(cleaned, firstName, lastName);
        cleaned = cleaned.replace(/[\s,;|]+$/g, "").trim();
      }
      return cleaned;
    };

    const stripTrailingClientNameWithLogging = (field: string, value: string): string => {
      if (field !== "food_fruit") return sanitizeExtractedValue(value) as string;
      const before = typeof value === "string" ? value : String(value ?? "");
      const after = sanitizeExtractedValue(before) as string;
      let finalValue = after;
      const lastParen = finalValue.lastIndexOf(")");
      if (lastParen !== -1) finalValue = finalValue.slice(0, lastParen + 1).trim();
      console.log(`[parse-mb-pdf] DEBUG name-strip: before='${before}', after='${finalValue}'`);
      if (before === finalValue) {
        console.log("[parse-mb-pdf] DEBUG name-strip patterns", {
          field,
          firstName,
          lastName,
          patterns: getTrailingClientNamePatterns(firstName, lastName),
          comparedValue: before,
        });
      }
      return finalValue;
    };

    const buildField = (v: unknown, field?: string) => {
      const value = typeof v === "string" && field ? stripTrailingClientNameWithLogging(field, v) : sanitizeExtractedValue(v);
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
    result.eggs_max_per_week = buildField(eggs.eggs_max_per_week, "eggs_max_per_week");
    result.water_target_litres = buildField(water, "water_target_litres");

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
