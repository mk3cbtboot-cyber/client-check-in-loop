export interface FoodCategory {
  title: string;
  items: string[];
}

/** Normalize a raw value (from DB jsonb) into FoodCategory[], or [] if unset/invalid. */
export function resolvePhase2Categories(raw: unknown): FoodCategory[] {
  if (!raw || !Array.isArray(raw)) return [];
  const cats = (raw as any[])
    .filter((c) => c && typeof c.title === "string" && Array.isArray(c.items))
    .map((c) => ({ title: c.title as string, items: (c.items as unknown[]).filter((i) => typeof i === "string") as string[] }));
  return cats;
}
