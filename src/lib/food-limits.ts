import type { OptionDef } from "@/lib/mb-foods";

export type FoodLimits = Record<string, number>;

export interface LimitMatch {
  food: string;       // limit label as entered by practitioner
  perServing: number; // how many units this meal uses per serving
  limit: number;      // weekly limit
  maxDays: number;    // how many days this meal can be repeated
  unitNote: string;   // small hint like "3 eggs / meal" or "1 serve"
}

export interface LimitCheck {
  limited: boolean;
  maxDays: number; // 0-7
  reasons: LimitMatch[];
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(?:es|s)$/, ""); // crude singularize
}

/** Extract numeric per-serving count from a fixed qty like "2 eggs". Returns 1 for weight/volume units. */
function fixedPerServing(qty: string): number {
  const m = qty.match(/^\s*(\d+(?:\.\d+)?)\s*([^\d\s]*)/);
  if (!m) return 1;
  const num = parseFloat(m[1]);
  const unit = (m[2] || "").toLowerCase();
  if (/^(g|kg|ml|l|oz|lb)$/.test(unit)) return 1;
  return num;
}

function findLimit(foodName: string, entries: { key: string; label: string; limit: number }[]) {
  const n = normalize(foodName);
  if (!n) return null;
  // exact, then containment either way (so "salmon" matches "Wild Pacific Salmon" and "egg" matches "Eggs")
  return (
    entries.find((e) => e.key === n) ??
    entries.find((e) => n.includes(e.key) || e.key.includes(n)) ??
    null
  );
}

export function checkMealLimits(
  opt: OptionDef | null,
  selections: Record<string, string>,
  limits: FoodLimits | null | undefined,
): LimitCheck {
  if (!opt || !limits) return { limited: false, maxDays: 7, reasons: [] };
  const entries = Object.entries(limits)
    .filter(([k, v]) => k && Number.isFinite(Number(v)) && Number(v) > 0)
    .map(([k, v]) => ({ key: normalize(k), label: k, limit: Number(v) }))
    .filter((e) => e.key.length > 0);
  if (!entries.length) return { limited: false, maxDays: 7, reasons: [] };

  const reasons: LimitMatch[] = [];

  for (const f of opt.fixed ?? []) {
    const lim = findLimit(f.label, entries);
    if (!lim) continue;
    const per = fixedPerServing(f.qty);
    reasons.push({
      food: lim.label,
      perServing: per,
      limit: lim.limit,
      maxDays: Math.max(0, Math.floor(lim.limit / per)),
      unitNote: `${per} ${lim.label.toLowerCase()} / meal`,
    });
  }

  for (const c of opt.components) {
    const choice = selections[c.key];
    if (!choice) continue;
    const lim = findLimit(choice, entries);
    if (!lim) continue;
    reasons.push({
      food: lim.label,
      perServing: 1,
      limit: lim.limit,
      maxDays: Math.max(0, Math.floor(lim.limit)),
      unitNote: `1 serve / meal`,
    });
  }

  if (!reasons.length) return { limited: false, maxDays: 7, reasons: [] };
  const maxDays = Math.max(0, Math.min(7, ...reasons.map((r) => r.maxDays)));
  return { limited: maxDays < 7, maxDays, reasons: reasons.filter((r) => r.maxDays < 7) };
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export function daySplitLabel(start: number, end: number): string {
  if (end < start) return "";
  if (start === end) return WEEKDAYS[start];
  return `${WEEKDAYS[start]}–${WEEKDAYS[end]}`;
}
