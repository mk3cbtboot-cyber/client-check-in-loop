// MB colour-day plan model + resolver seam.
//
// Slice 1 of the MB meal-model redesign: this module defines the shape of the
// practitioner-confirmed colour-grouped plan (clients.mb_plan) and the enriched
// caps array (clients.mb_food_limits), and exposes a single resolver that every
// runtime consumer will eventually read from.
//
// IMPORTANT (this slice): nothing consumes the resolver yet. When a client has
// no confirmed mb_plan, getMbPlan() synthesises the exact structure and portions
// that MB_OPTIONS + the client's food_* columns produce today, so switching a
// consumer over later is a no-op for existing clients.

import { MB_FOODS, MB_OPTIONS, type MealType, type OptionDef } from "@/lib/mb-foods";
import { resolvePhase3MbField } from "@/lib/phase3-mb-defaults";

export const MB_COLOURS = ["blue", "green", "orange"] as const;
export type MbColour = (typeof MB_COLOURS)[number];

export type MbUnit = "g" | "ml" | "count" | "as_listed";

export interface MbPlanItem {
  id: string;
  /** MB_FOODS category key, or a free-text category for hand-entered rows. */
  category: string;
  label: string;
  qty: number | null;
  unit: MbUnit;
  note?: string;
  /** Approved foods this item may be chosen from (client's own list). */
  options?: string[];
  optional?: boolean;
}

export interface MbPlanMeal {
  items: MbPlanItem[];
  note?: string;
}

export interface MbSuggestion {
  colour: MbColour;
  label: string;
  meals: Record<MealType, MbPlanMeal>;
}

export interface MbPlan {
  version: number;
  confirmed_at: string | null;
  suggestions: MbSuggestion[];
}

/** Only weekly maximums are evaluated; older per-day/combination rows are read as weekly. */
export type MbLimitType = "weekly";

export interface MbFoodLimit {
  id: string;
  food: string;
  type: MbLimitType;
  max: number | null;
  unit?: string;
  note?: string;
}


export interface ResolvedMbPlan {
  source: "confirmed" | "legacy";
  suggestions: MbSuggestion[];
}

/** Minimal shape of the client row this module needs. */
export type MbPlanClient = Record<string, unknown> & {
  mb_plan?: unknown;
  phase?: string | null;
  phase3_mode?: string | null;
};

const COLOUR_LABEL: Record<MbColour, string> = {
  blue: "Suggestion 1",
  green: "Suggestion 2",
  orange: "Suggestion 3",
};

/* ------------------------------------------------------------------ */
/* Confirmed plan parsing                                              */
/* ------------------------------------------------------------------ */

function isMealType(v: string): v is MealType {
  return v === "breakfast" || v === "lunch" || v === "dinner";
}

/** Narrow an unknown jsonb value into an MbPlan, or null when it is not one. */
export function parseMbPlan(raw: unknown): MbPlan | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.suggestions)) return null;
  const suggestions = (o.suggestions as unknown[])
    .map((s) => parseSuggestion(s))
    .filter((s): s is MbSuggestion => s !== null);
  if (!suggestions.length) return null;
  return {
    version: typeof o.version === "number" ? o.version : 1,
    confirmed_at: typeof o.confirmed_at === "string" ? o.confirmed_at : null,
    suggestions,
  };
}

function parseSuggestion(raw: unknown): MbSuggestion | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const colour = MB_COLOURS.includes(o.colour as MbColour) ? (o.colour as MbColour) : null;
  if (!colour) return null;
  const rawMeals = (o.meals ?? {}) as Record<string, unknown>;
  const meals = {} as Record<MealType, MbPlanMeal>;
  for (const m of ["breakfast", "lunch", "dinner"] as MealType[]) {
    const rm = rawMeals[m] as Record<string, unknown> | undefined;
    const items = Array.isArray(rm?.items)
      ? (rm!.items as unknown[]).map((it, i) => parseItem(it, `${colour}-${m}-${i}`))
      : [];
    meals[m] = { items, note: typeof rm?.note === "string" ? (rm!.note as string) : "" };
  }
  return {
    colour,
    label: typeof o.label === "string" && o.label ? o.label : COLOUR_LABEL[colour],
    meals,
  };
}

function parseItem(raw: unknown, fallbackId: string): MbPlanItem {
  const o = (raw ?? {}) as Record<string, unknown>;
  const unit = (["g", "ml", "count", "as_listed"] as MbUnit[]).includes(o.unit as MbUnit)
    ? (o.unit as MbUnit)
    : "as_listed";
  const qty = typeof o.qty === "number" && Number.isFinite(o.qty) ? o.qty : null;
  return {
    id: typeof o.id === "string" && o.id ? o.id : fallbackId,
    category: typeof o.category === "string" ? o.category : "",
    label: typeof o.label === "string" ? o.label : "",
    qty,
    unit,
    note: typeof o.note === "string" ? o.note : "",
    options: Array.isArray(o.options) ? (o.options as unknown[]).map(String) : undefined,
    optional: o.optional === true,
  };
}

/** Narrow an unknown jsonb value into the enriched caps array. */
export function parseMbFoodLimits(raw: unknown): MbFoodLimit[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r, i): MbFoodLimit | null => {
      if (!r || typeof r !== "object") return null;
      const o = r as Record<string, unknown>;
      const food = typeof o.food === "string" ? o.food.trim() : "";
      if (!food) return null;
      const num = (v: unknown) =>
        typeof v === "number" && Number.isFinite(v) ? v : null;
      return {
        id: typeof o.id === "string" && o.id ? o.id : `limit-${i}`,
        food,
        // Legacy per_day / combination rows were never evaluated; read as weekly.
        type: "weekly",
        max: num(o.max),
        unit: typeof o.unit === "string" ? o.unit : undefined,
        note: typeof o.note === "string" ? o.note : undefined,
      };

    })
    .filter((l): l is MbFoodLimit => l !== null);
}

/* ------------------------------------------------------------------ */
/* Legacy synthesis — mirrors today's runtime behaviour exactly        */
/* ------------------------------------------------------------------ */

const PHASE3_CUSTOM_MAP: Record<string, (keyof typeof MB_FOODS)[]> = {
  phase3_meat: ["meat"],
  phase3_fish: ["fish", "seafood"],
  phase3_vegetables: ["vegetables", "vegLettuce"],
  phase3_fruit: ["fruit"],
  phase3_starches: ["starch"],
  phase3_dairy: ["milkProducts", "yogurt", "cheese"],
  phase3_bread: ["bread"],
};

const PHASE3_MB_MAP: Record<string, (keyof typeof MB_FOODS)[]> = {
  phase3_mb_fish: ["fish"],
  phase3_mb_seafood: ["seafood"],
  phase3_mb_cheese: ["cheese"],
  phase3_mb_legumes: ["legumes"],
  phase3_mb_vegetables: ["vegetables", "vegLettuce"],
  phase3_mb_fat_oil: ["oils"],
};

const parseList = (s: unknown): string[] =>
  String(s ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);

/**
 * The approved foods a component's sources resolve to for this client —
 * MB_FOODS plus the client's Phase 3/4 extras. Same rule the portal uses today.
 */
export function legacyFoodsForSources(
  client: MbPlanClient | null | undefined,
  sources: (keyof typeof MB_FOODS)[],
): string[] {
  const base = sources.flatMap((s) => MB_FOODS[s] ?? []);
  const extras: string[] = [];
  const phase = String(client?.phase ?? "");
  if (client && (phase === "phase3" || phase === "phase4")) {
    const isMb = client.phase3_mode === "mb_standard";
    const map = isMb ? PHASE3_MB_MAP : PHASE3_CUSTOM_MAP;
    const sourceSet = new Set(sources);
    for (const [field, cats] of Object.entries(map)) {
      if (!cats.some((c) => sourceSet.has(c))) continue;
      const raw = (client as Record<string, unknown>)[field];
      extras.push(...(isMb ? resolvePhase3MbField(field, raw as string) : parseList(raw)));
    }
  }
  const seen = new Set<string>();
  return [...base, ...extras].filter((i) => (seen.has(i) ? false : (seen.add(i), true)));
}

/** Split a hardcoded MB_OPTIONS qty string ("140g", "200ml", "2 eggs") into qty+unit. */
function qtyFromLegacy(qty: string): { qty: number | null; unit: MbUnit } {
  const raw = String(qty ?? "").trim();
  if (!raw) return { qty: null, unit: "as_listed" };
  const m = raw.match(/^(\d+(?:\.\d+)?)\s*([a-z]*)/i);
  if (!m) return { qty: null, unit: "as_listed" };
  const n = parseFloat(m[1]);
  const u = (m[2] || "").toLowerCase();
  if (u === "g") return { qty: n, unit: "g" };
  if (u === "ml") return { qty: n, unit: "ml" };
  if (!u || /^eggs?$/.test(u)) return { qty: n, unit: "count" };
  return { qty: n, unit: "as_listed" };
}

function legacyMeal(
  client: MbPlanClient | null | undefined,
  opt: OptionDef | undefined,
  meal: MealType,
  colour: MbColour,
): MbPlanMeal {
  if (!opt) return { items: [], note: "" };
  const items: MbPlanItem[] = [];

  for (const [i, f] of (opt.fixed ?? []).entries()) {
    const { qty, unit } = qtyFromLegacy(f.qty);
    items.push({
      id: `${colour}-${meal}-fixed-${i}`,
      category: "fixed",
      label: f.label,
      qty,
      unit,
      note: unit === "as_listed" ? f.qty : "",
    });
  }

  for (const c of opt.components) {
    const { qty, unit } = qtyFromLegacy(c.qty);
    items.push({
      id: `${colour}-${meal}-${c.key}`,
      category: c.sources[0] ?? "",
      label: c.label,
      qty,
      unit,
      note: unit === "as_listed" ? c.qty : "",
      options: legacyFoodsForSources(client, c.sources),
      optional: c.optional === true,
    });
  }

  return { items, note: "" };
}

/**
 * Build the colour-day shape from today's sources: MB_OPTIONS structure and
 * portions, plus the client's own approved food lists. Option index N of each
 * slot becomes colour N — the only grouping signal that exists pre-redesign.
 */
export function synthesiseLegacyPlan(client: MbPlanClient | null | undefined): MbSuggestion[] {
  return MB_COLOURS.map((colour, idx) => ({
    colour,
    label: COLOUR_LABEL[colour],
    meals: {
      breakfast: legacyMeal(client, MB_OPTIONS.breakfast[idx], "breakfast", colour),
      lunch: legacyMeal(client, MB_OPTIONS.lunch[idx], "lunch", colour),
      dinner: legacyMeal(client, MB_OPTIONS.dinner[idx], "dinner", colour),
    },
  }));
}

/* ------------------------------------------------------------------ */
/* Resolver                                                            */
/* ------------------------------------------------------------------ */

/**
 * Single entry point for MB meal structure + portions.
 * Returns the practitioner-confirmed colour plan when one has been published,
 * otherwise a legacy synthesis identical to today's behaviour.
 */
export function getMbPlan(client: MbPlanClient | null | undefined): ResolvedMbPlan {
  const plan = parseMbPlan(client?.mb_plan);
  if (plan?.confirmed_at) {
    return { source: "confirmed", suggestions: plan.suggestions };
  }
  return { source: "legacy", suggestions: synthesiseLegacyPlan(client) };
}

/** Convenience: the confirmed draft (unpublished included) for the setup screen. */
export function getMbPlanDraft(client: MbPlanClient | null | undefined): MbPlan {
  return (
    parseMbPlan(client?.mb_plan) ?? {
      version: 1,
      confirmed_at: null,
      suggestions: synthesiseLegacyPlan(client),
    }
  );
}

/* ------------------------------------------------------------------ */
/* OptionDef adapter — lets today's UI read the resolved plan           */
/* ------------------------------------------------------------------ */

/** True when the practitioner has confirmed (published) a colour plan. */
export function isMbPlanConfirmed(client: MbPlanClient | null | undefined): boolean {
  return !!parseMbPlan(client?.mb_plan)?.confirmed_at;
}

function fmtQty(item: MbPlanItem): string {
  if (item.unit === "as_listed") return (item.note || "as listed").trim();
  if (item.qty == null) return (item.note || "").trim();
  if (item.unit === "g") return `${item.qty}g`;
  if (item.unit === "ml") return `${item.qty}ml`;
  return `${item.qty}`;
}

/* ------------------------------------------------------------------ */
/* Second vegetable ("veg2") — an optional variety split, never an     */
/* extra allowance. One veg allowance may be split across two foods:   */
/* two picks → 50/50 of the combined amount, one pick → the full       */
/* amount. The rule lives here so item-based consumers (run planner,   */
/* cap evaluator) and key-based consumers (OptionDef UI) agree.        */
/* A mirror of vegAltIdFor lives in supabase/functions/_shared/mb-cap. */
/* ------------------------------------------------------------------ */

export const VEG_ALT_SUFFIX = "-alt";

const VEG_ALT_CATEGORIES = new Set(["vegetables", "vegLettuce"]);

/** True when this plan item may carry an optional companion vegetable pick. */
export function vegAltEligible(item: { category?: string; optional?: boolean }): boolean {
  return VEG_ALT_CATEGORIES.has(String(item?.category ?? "")) && item?.optional !== true;
}

/** The pick id of an item's optional second vegetable, or null. */
export function vegAltIdFor(item: { id?: string; category?: string; optional?: boolean }): string | null {
  if (!item?.id || !vegAltEligible(item)) return null;
  return `${item.id}${VEG_ALT_SUFFIX}`;
}

export function isVegAltKey(key: string): boolean {
  return String(key ?? "").endsWith(VEG_ALT_SUFFIX);
}

export function baseKeyForAlt(key: string): string {
  return String(key ?? "").slice(0, -VEG_ALT_SUFFIX.length);
}

/** Half of a weight/volume portion string ("190g" → "95g"). Unparseable in = same out. */
export function splitVegQty(qty: string): string {
  const raw = String(qty ?? "").trim();
  const m = raw.match(/^(\d+(?:\.\d+)?)\s*(g|ml)\b/i);
  if (!m) return raw;
  const half = Math.round(parseFloat(m[1]) / 2);
  if (!Number.isFinite(half) || half <= 0) return raw;
  return `${half}${m[2].toLowerCase()}`;
}

/**
 * Portion overrides for the 50/50 veg split, keyed by component key.
 * Applies when both the primary veg and its optional companion are picked —
 * covers both the confirmed-plan `${key}-alt` shape and the legacy veg1/veg2.
 */
export function vegQtyOverrides(
  components: { key: string; qty?: string }[],
  picks: Record<string, string | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  const byKey = new Map(components.map((c) => [c.key, c]));
  for (const c of components) {
    let baseKey: string | null = null;
    if (isVegAltKey(c.key) && byKey.has(baseKeyForAlt(c.key))) baseKey = baseKeyForAlt(c.key);
    else if (c.key === "veg2" && byKey.has("veg1")) baseKey = "veg1";
    if (!baseKey) continue;
    if (!picks[c.key] || !picks[baseKey]) continue;
    const baseQty = byKey.get(baseKey)?.qty ?? "";
    const half = splitVegQty(baseQty);
    if (!half || half === baseQty) continue;
    out[baseKey] = half;
    out[c.key] = half;
  }
  return out;
}

function optionFromSuggestion(s: MbSuggestion, meal: MealType, idx: number): OptionDef {
  const m = s.meals[meal] ?? { items: [] };
  const fixed: { label: string; qty: string }[] = [];
  const components: OptionDef["components"] = [];
  m.items.forEach((it, i) => {
    if (it.category === "fixed") {
      fixed.push({ label: it.label, qty: fmtQty(it) });
      return;
    }
    const sources = [it.category as keyof typeof MB_FOODS].filter((c) => !!MB_FOODS[c]) as (keyof typeof MB_FOODS)[];
    const items = it.options && it.options.length ? it.options : undefined;
    const key = `${it.category || "item"}-${i}`;
    components.push({
      key,
      label: it.label,
      qty: fmtQty(it),
      sources,
      optional: it.optional === true,
      items,
      itemId: it.id,
    });
    // Vegetables may be split across two choices — the second pick is purely for
    // variety and carries no extra portion (the qty above is the combined amount).
    if (vegAltEligible(it)) {
      components.push({
        key: `${key}${VEG_ALT_SUFFIX}`,
        label: `${it.label} 2 (optional)`,
        qty: "",
        sources,
        optional: true,
        items,
        itemId: it.id,
        isVegAlt: true,
      });
    }
  });

  return {
    id: idx + 1,
    label: s.label || COLOUR_LABEL[s.colour],
    components,
    ...(fixed.length ? { fixed } : {}),
  };
}

/**
 * The meal options today's planner/portal should render.
 * Unconfirmed clients get the untouched hardcoded MB_OPTIONS (byte-identical
 * to pre-resolver behaviour); confirmed clients get their real colour days.
 */
export function mbOptionsForMeal(
  client: MbPlanClient | null | undefined,
  meal: MealType,
): OptionDef[] {
  if (!isMbPlanConfirmed(client)) return MB_OPTIONS[meal];
  return getMbPlan(client).suggestions.map((s, i) => optionFromSuggestion(s, meal, i));
}

export function mbOptions(
  client: MbPlanClient | null | undefined,
): Record<MealType, OptionDef[]> {
  return {
    breakfast: mbOptionsForMeal(client, "breakfast"),
    lunch: mbOptionsForMeal(client, "lunch"),
    dinner: mbOptionsForMeal(client, "dinner"),
  };
}

/** Colour of the Nth suggestion (options are ordered by colour). */
export function mbColourForIndex(i: number): MbColour | null {
  return MB_COLOURS[i] ?? null;
}
