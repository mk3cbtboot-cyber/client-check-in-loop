import { type DensityFoodItem } from "@/lib/macros";

export type SlotKey = "breakfast" | "morning_snack" | "lunch" | "afternoon_snack" | "dinner";

export interface FoodItem extends DensityFoodItem {
  name: string;
  portion: string;
  category: string;
}

export type CategoryKey = "protein" | "carbs" | "veg" | "fat";

export type SelectionKey = CategoryKey | "veg2";

export type SlotSelection = {
  protein?: string | null;
  carbs?: string | null;
  veg?: string | null;
  veg2?: string | null;
  fat?: string | null;
};

export type FoodSelections = Record<string, SlotSelection>;

const CATEGORY_MATCHERS: { key: CategoryKey; match: (raw: string) => boolean }[] = [
  { key: "protein", match: (r) => r === "protein" },
  { key: "carbs", match: (r) => r === "carbs" || r === "carb" || r === "starch" || r === "starches" },
  { key: "veg", match: (r) => r === "veg" || r === "vegetable" || r === "vegetables" },
  { key: "fat", match: (r) => r === "fat" || r === "fats" || r === "oil" || r === "oils" },
];

export function categorize(food: FoodItem): CategoryKey | null {
  const raw = (food.category ?? "").trim().toLowerCase();
  for (const c of CATEGORY_MATCHERS) {
    if (c.match(raw)) return c.key;
  }
  return null;
}

export function foodKey(f: FoodItem): string {
  return `${f.name}${f.portion ? ` · ${f.portion}` : ""}`;
}

export function stripEstimated(name: string): string {
  return (name ?? "").replace(/\s*\(estimated\)\s*$/i, "").trim();
}
