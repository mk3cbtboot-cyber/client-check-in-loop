/**
 * The ONE canonicaliser for weekly food limit maps, shared by the MB PDF
 * parser (Deno) and the app (`src/lib/food-limits.ts` re-exports this).
 *
 * Collapses singular/plural duplicates so a food never persists under two keys
 * (e.g. { egg: 5, eggs: 4 } -> { eggs: 4 }):
 *  - the PLURAL spelling wins as the canonical key
 *  - the MORE RESTRICTIVE (lower) value wins — these are health caps, so when
 *    two spellings disagree we err tighter.
 * Must run before any write to clients.food_limits.
 */
export type FoodLimitsMap = Record<string, number>;

function normalizeKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(?:es|s)$/, ""); // crude singularize
}

export function canonicaliseFoodLimits(
  limits: FoodLimitsMap | null | undefined,
): FoodLimitsMap {
  if (!limits || typeof limits !== "object") return {};
  const groups = new Map<string, { key: string; value: number }>();
  for (const [rawKey, rawVal] of Object.entries(limits)) {
    const key = String(rawKey).trim();
    if (!key) continue;
    const value = Number(rawVal);
    if (!Number.isFinite(value)) continue;
    const norm = normalizeKey(key);
    if (!norm) continue;
    const existing = groups.get(norm);
    if (!existing) {
      groups.set(norm, { key, value });
      continue;
    }
    const preferNew = /s$/i.test(key) && !/s$/i.test(existing.key);
    groups.set(norm, {
      key: preferNew ? key : existing.key,
      value: Math.min(existing.value, value),
    });
  }
  const out: FoodLimitsMap = {};
  for (const { key, value } of groups.values()) out[key] = value;
  return out;
}
