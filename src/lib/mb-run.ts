// The MB client's current colour-locked 3-day run (clients.mb_run).

import type { MealType } from "@/lib/mb-foods";
import { MB_COLOURS, type MbColour, type MbPlanItem, type MbSuggestion } from "@/lib/mb-plan";

export const RUN_DAYS = 3;
export const RUN_MEALS: MealType[] = ["breakfast", "lunch", "dinner"];

/** Shared item quantity formatter — used by both the client planner and the practitioner mirror. */
export function fmtQty(it: MbPlanItem): string {
  if (it.unit === "g" && it.qty != null) return `${it.qty}g`;
  if (it.unit === "ml" && it.qty != null) return `${it.qty}ml`;
  if (it.unit === "count" && it.qty != null) return `${it.qty}`;
  return (it.note ?? "").trim();
}


export interface MbRunMeal {
  /** Colour this meal is actually taken from (differs only after a cap swap). */
  colour: MbColour;
  /** planItemId → chosen food. */
  picks: Record<string, string>;
}

export interface MbRun {
  colour: MbColour | null;
  started_on: string | null;
  meals: Record<MealType, MbRunMeal | null>;
}

export const emptyRun = (): MbRun => ({
  colour: null,
  started_on: null,
  meals: { breakfast: null, lunch: null, dinner: null },
});

export function parseMbRun(raw: unknown): MbRun {
  const out = emptyRun();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const o = raw as Record<string, unknown>;
  if (MB_COLOURS.includes(o.colour as MbColour)) out.colour = o.colour as MbColour;
  if (typeof o.started_on === "string") out.started_on = o.started_on;
  const meals = (o.meals ?? {}) as Record<string, unknown>;
  for (const m of RUN_MEALS) {
    const rm = meals[m] as Record<string, unknown> | undefined;
    if (!rm) continue;
    const colour = MB_COLOURS.includes(rm.colour as MbColour)
      ? (rm.colour as MbColour)
      : out.colour;
    if (!colour) continue;
    const picksRaw = (rm.picks ?? {}) as Record<string, unknown>;
    const picks: Record<string, string> = {};
    for (const [k, v] of Object.entries(picksRaw)) {
      if (typeof v === "string" && v.trim()) picks[k] = v;
    }
    out.meals[m] = { colour, picks };
  }
  return out;
}

export function startRun(colour: MbColour): MbRun {
  return {
    colour,
    started_on: new Date().toISOString().slice(0, 10),
    meals: {
      breakfast: { colour, picks: {} },
      lunch: { colour, picks: {} },
      dinner: { colour, picks: {} },
    },
  };
}
