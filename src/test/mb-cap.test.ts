import { describe, expect, it } from "vitest";
import {
  evaluateRunCaps,
  perMealQty,
  weeklyCapFor,
} from "../../supabase/functions/_shared/mb-cap";

const suggestions = [
  {
    colour: "blue",
    label: "Suggestion 1",
    meals: {
      breakfast: { items: [] },
      lunch: {
        items: [
          { id: "l1", category: "fixed", label: "Eggs", qty: 2, unit: "count" },
          { id: "l2", category: "fixed", label: "2 Eggs", qty: null, unit: "as_listed", note: "2 Eggs" },
        ],
      },
      dinner: { items: [] },
    },
  },
  { colour: "green", label: "Suggestion 2", meals: { breakfast: { items: [] }, lunch: { items: [] }, dinner: { items: [] } } },
];

const run = {
  colour: "blue",
  meals: { breakfast: { colour: "blue", picks: {} }, lunch: { colour: "blue", picks: {} }, dinner: { colour: "blue", picks: {} } },
};

describe("mb cap evaluator", () => {
  it("reads counts and as_listed quantities", () => {
    expect(perMealQty({ unit: "count", qty: 2 })).toBe(2);
    expect(perMealQty({ unit: "as_listed", note: "2 Eggs" })).toBe(2);
    expect(perMealQty({ unit: "as_listed", label: "Eggs" })).toBe(1);
    expect(perMealQty({ unit: "g", qty: 140 })).toBe(1);
  });

  it("prefers mb_food_limits over the legacy fallback", () => {
    expect(weeklyCapFor("eggs", [{ food: "eggs", type: "weekly", max: 2 }], { eggs: 5 })).toBe(2);
    expect(weeklyCapFor("eggs", [], { eggs: 5 })).toBe(5);
    expect(weeklyCapFor("kale", [], { eggs: 5 })).toBeNull();
  });

  it("blocks a fixed 2-egg item against a cap of 5 over 3 days", () => {
    const v = evaluateRunCaps(run, suggestions, [{ food: "eggs", type: "weekly", max: 5 }], {}, 3);
    expect(v.length).toBe(2);
    expect(v.every((x) => x.needed === 6 && x.cap === 5 && x.meal === "lunch")).toBe(true);
  });

  it("clears when the cap covers the run", () => {
    expect(evaluateRunCaps(run, suggestions, [{ food: "eggs", type: "weekly", max: 6 }], {}, 3)).toEqual([]);
  });

  it("clears when the affected meal is swapped to another colour", () => {
    const swapped = { ...run, meals: { ...run.meals, lunch: { colour: "green", picks: {} } } };
    expect(evaluateRunCaps(swapped, suggestions, [{ food: "eggs", type: "weekly", max: 5 }], {}, 3)).toEqual([]);
  });
});
