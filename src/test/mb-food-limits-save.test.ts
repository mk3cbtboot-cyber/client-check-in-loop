import { describe, expect, it } from "vitest";
import { projectFoodLimits } from "@/lib/mb-food-limits-save";
import type { MbFoodLimit } from "@/lib/mb-plan";

const cap = (food: string, max: number | null): MbFoodLimit => ({
  id: `x-${food}`,
  food,
  type: "weekly",
  max,
});

describe("projectFoodLimits", () => {
  it("seed one cap → delete it → payload is food_limits: {}", () => {
    // Dialog seeded from one stored cap: editor owns its canonical key.
    const owned = new Set(["eggs"]);
    const existing = { eggs: 3 };
    const result = projectFoodLimits([], existing, owned);
    expect(result).toBeDefined();
    expect(result!.foodLimits).toEqual({});
    expect(result!.projectedKeys).toEqual([]);
  });

  it("seed nothing and project nothing → undefined (no food_limits key, no wipe)", () => {
    const result = projectFoodLimits([], { eggs: 3 }, new Set());
    expect(result).toBeUndefined();
  });

  it("deleting one of several caps keeps the rest", () => {
    const owned = new Set(["eggs", "yogurt"]);
    const existing = { eggs: 3, yogurt: 2 };
    const result = projectFoodLimits([cap("yogurt", 2)], existing, owned);
    expect(result!.foodLimits).toEqual({ yogurt: 2 });
  });

  it("editing a cap's max projects the new value", () => {
    const owned = new Set(["eggs"]);
    const result = projectFoodLimits([cap("eggs", 4)], { eggs: 3 }, owned);
    expect(result!.foodLimits).toEqual({ eggs: 4 });
    expect(result!.projectedKeys).toEqual(["eggs"]);
  });

  it("preserves stored keys the editor does not own", () => {
    const owned = new Set(["eggs"]);
    const existing = { eggs: 3, cheese: 1 };
    const result = projectFoodLimits([cap("eggs", 2)], existing, owned);
    expect(result!.foodLimits).toEqual({ eggs: 2, cheese: 1 });
  });

  it("rows without a max do not project but ownership still applies", () => {
    const owned = new Set(["eggs"]);
    const result = projectFoodLimits([cap("eggs", null)], { eggs: 3 }, owned);
    expect(result!.foodLimits).toEqual({});
  });
});
