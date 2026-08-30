// Build a draft mb_plan from the MB PDF parser's item model.
//
// The parser (supabase/functions/parse-mb-pdf) now returns, for each of the 9
// suggestion/meal slots, the ordered list of food categories actually printed
// on that suggestion's line, each with its own quantity and unit. This module
// converts that list straight into MbPlanItem rows — no protein/veg/fruit/bread
// flattening, so Starch and ml portions survive.

import { MB_COLOURS, type MbPlan, type MbPlanItem, type MbSuggestion, type MbUnit } from "@/lib/mb-plan";
import type { MealType } from "@/lib/mb-foods";

export type ParsedMealItem = {
  category: string;
  qty: number | null;
  unit: MbUnit | string;
};

export type ParsedMealOption = {
  items?: ParsedMealItem[];
  protein_category: string | null;
  protein_grams: number | null;
  veg_grams: number | null;
  has_fruit: boolean;
  has_bread: boolean;
};

export type ParsedMealOptions = Record<MealType, ParsedMealOption[]>;

const MEALS: MealType[] = ["breakfast", "lunch", "dinner"];
const LABELS = ["Suggestion 1", "Suggestion 2", "Suggestion 3"];

/** PDF category name -> MB_FOODS key used by the plan model. */
const CATEGORY_KEY: Record<string, string> = {
  "eggs": "fixed",
  "egg(s)": "fixed",
  "fish": "fish",
  "seafood": "seafood",
  "meat": "meat",
  "poultry": "poultry",
  "cheese": "cheese",
  "yogurt": "yogurt",
  "legumes": "legumes",
  "nuts": "nuts",
  "milk": "milkProducts",
  "milk products": "milkProducts",
  "pumpkin seeds": "pumpkinSeeds",
  "sunflower seeds": "sunflowerSeeds",
  "vegetables": "vegetables",
  "vegetable": "vegetables",
  "veg./lettuce": "vegLettuce",
  "veg/lettuce": "vegLettuce",
  "vegetable/lettuce": "vegLettuce",
  "sprouts": "vegetables",
  "tofu": "legumes",
  "starch": "starch",
  "bread": "bread",
  "fruit": "fruit",
  "fat/oil": "oils",
  "fat / oil": "oils",
};

function categoryKey(label: string): string {
  return CATEGORY_KEY[label.replace(/\s+/g, " ").trim().toLowerCase()] ?? "";
}

function toUnit(u: string | undefined): MbUnit {
  return u === "g" || u === "ml" || u === "count" ? u : "as_listed";
}

/**
 * Items for one suggestion/meal. Uses the parser's item list when present and
 * falls back to the legacy flat fields (practitioner edits in the review
 * dialog still write those) so nothing is lost either way.
 */
function itemsFor(opt: ParsedMealOption | undefined, colour: string, meal: MealType): MbPlanItem[] {
  if (!opt) return [];
  const out: MbPlanItem[] = [];
  const push = (category: string, label: string, qty: number | null, unit: MbUnit, idx: number) => {
    out.push({
      id: `${colour}-${meal}-${idx}`,
      category,
      label,
      qty,
      unit,
      note: "",
      optional: false,
    });
  };

  if (Array.isArray(opt.items) && opt.items.length) {
    opt.items.forEach((it, i) => {
      push(categoryKey(it.category), it.category, it.qty, toUnit(String(it.unit)), i);
    });
    return out;
  }

  let i = 0;
  if (opt.protein_category) {
    const isEggs = /egg/i.test(opt.protein_category);
    push(
      categoryKey(opt.protein_category),
      opt.protein_category,
      opt.protein_grams,
      opt.protein_grams == null ? "as_listed" : isEggs ? "count" : "g",
      i++,
    );
  }
  if (opt.veg_grams != null) push("vegetables", "Vegetables", opt.veg_grams, "g", i++);
  if (opt.has_fruit) push("fruit", "Fruit", null, "as_listed", i++);
  if (opt.has_bread) push("bread", "Bread", null, "as_listed", i++);
  return out;
}

/** A draft (unconfirmed) mb_plan built from parsed PDF meal options. */
export function mbPlanFromParsedOptions(options: ParsedMealOptions | null | undefined): MbPlan {
  const suggestions: MbSuggestion[] = MB_COLOURS.map((colour, idx) => {
    const meals = {} as MbSuggestion["meals"];
    for (const meal of MEALS) {
      meals[meal] = { items: itemsFor(options?.[meal]?.[idx], colour, meal), note: "" };
    }
    return { colour, label: LABELS[idx], meals };
  });
  return { version: 1, confirmed_at: null, suggestions };
}
