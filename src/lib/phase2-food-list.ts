import { MB_FOODS } from "@/lib/mb-foods";

export interface FoodCategory {
  title: string;
  items: string[];
}

export const DEFAULT_PHASE2_CATEGORIES: FoodCategory[] = [
  { title: "Proteins — Fish & Seafood", items: [...MB_FOODS.fish, ...MB_FOODS.seafood] },
  { title: "Proteins — Poultry & Meat", items: [...MB_FOODS.poultry, ...MB_FOODS.meat] },
  { title: "Proteins — Cheese, Yogurt & Milk", items: [...MB_FOODS.cheese, ...MB_FOODS.yogurt, ...MB_FOODS.milkProducts] },
  { title: "Proteins — Legumes", items: MB_FOODS.legumes },
  { title: "Vegetables", items: [...MB_FOODS.vegetables, ...MB_FOODS.vegLettuce] },
  { title: "Fruit", items: MB_FOODS.fruit },
  { title: "Bread", items: MB_FOODS.bread },
  { title: "Starch", items: MB_FOODS.starch },
];

/** Normalize a raw value (from DB jsonb) into FoodCategory[] or null if unset. */
export function resolvePhase2Categories(raw: unknown): FoodCategory[] {
  if (!raw || !Array.isArray(raw)) return DEFAULT_PHASE2_CATEGORIES;
  const cats = (raw as any[])
    .filter((c) => c && typeof c.title === "string" && Array.isArray(c.items))
    .map((c) => ({ title: c.title as string, items: (c.items as unknown[]).filter((i) => typeof i === "string") as string[] }));
  return cats.length ? cats : DEFAULT_PHASE2_CATEGORIES;
}
