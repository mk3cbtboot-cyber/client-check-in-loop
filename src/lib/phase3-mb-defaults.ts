// Default MB Standard Phase 3 extended food list, used when a client's
// phase3_mb_* field has not yet been populated by the practitioner from
// the client's MB PDF. Practitioner-entered values always override these.
import { MB_FOODS } from "@/lib/mb-foods";

export const PHASE3_MB_DEFAULTS: Record<string, string[]> = {
  phase3_mb_fish: [...MB_FOODS.fish],
  phase3_mb_seafood: [...MB_FOODS.seafood],
  phase3_mb_cheese: [...MB_FOODS.cheese],
  phase3_mb_legumes: [...MB_FOODS.legumes],
  phase3_mb_vegetables: [...MB_FOODS.vegetables, ...MB_FOODS.vegLettuce],
  phase3_mb_fat_oil: [
    "Cold-Pressed Olive Oil",
    "Cold-Pressed Flaxseed Oil",
    "Cold-Pressed Coconut Oil",
    "Avocado Oil",
    "Ghee (clarified butter)",
  ],
};

export const PHASE3_MB_OIL_DEFAULTS = PHASE3_MB_DEFAULTS.phase3_mb_fat_oil;

/** Parse a comma-separated string into items; if empty, return defaults for that field. */
export function resolvePhase3MbField(field: string, raw: string | null | undefined): string[] {
  const parsed = (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (parsed.length > 0) return parsed;
  return PHASE3_MB_DEFAULTS[field] ?? [];
}
