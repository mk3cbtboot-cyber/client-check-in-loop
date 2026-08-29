import { canonicaliseFoodLimits } from "@/lib/food-limits";
import type { MbFoodLimit } from "@/lib/mb-plan";

export interface FoodLimitsProjection {
  /** The full replacement value for clients.food_limits. */
  foodLimits: Record<string, number>;
  /** Canonical keys supplied by the editor this save (grow the owned set). */
  projectedKeys: string[];
}

/**
 * Project the MB caps editor's rows into the flat clients.food_limits map that
 * portal counters and log-mb-meal enforcement read.
 *
 * Intent-based guard: returns `undefined` (caller must NOT include the
 * food_limits key in the update) only when the editor was never seeded
 * (ownedKeys empty) AND nothing is projected — the accidental
 * "never-populated → don't wipe" case. An empty `{}` result is a legitimate
 * "practitioner deleted the last cap" and must propagate.
 */
export function projectFoodLimits(
  nextLimits: MbFoodLimit[],
  existingFlatLimits: Record<string, number>,
  ownedKeys: ReadonlySet<string>,
): FoodLimitsProjection | undefined {
  const projected = canonicaliseFoodLimits(
    Object.fromEntries(
      nextLimits
        .filter((r) => r.type === "weekly" && r.food.trim() !== "" && Number(r.max) > 0)
        .map((r) => [r.food.trim().toLowerCase(), Number(r.max)]),
    ),
  );
  const projectedKeys = Object.keys(projected);
  if (ownedKeys.size === 0 && projectedKeys.length === 0) return undefined;

  const base = canonicaliseFoodLimits(existingFlatLimits);
  const merged: Record<string, number> = {};
  for (const [k, v] of Object.entries(base)) {
    // Keys the editor owns are re-supplied by the projection; if they were
    // deleted in the editor, they drop out here.
    if (!ownedKeys.has(k)) merged[k] = Number(v);
  }
  return {
    foodLimits: canonicaliseFoodLimits({ ...merged, ...projected }),
    projectedKeys,
  };
}
