import { describe, it, expect } from "vitest";
import { mbOptionsForMeal, runPicksToSelections } from "@/lib/mb-plan";

const client = {
  client_type: "mb",
  mb_plan: {
    version: 1,
    confirmed_at: "2026-01-01T00:00:00Z",
    suggestions: [
      {
        colour: "blue",
        label: "Suggestion 1",
        meals: {
          breakfast: { items: [] },
          lunch: {
            items: [
              { id: "blue-lunch-protein", category: "fish", label: "Fish", qty: 140, unit: "g", options: ["Trout", "Cod"] },
              { id: "blue-lunch-veg", category: "vegetables", label: "Vegetables", qty: 190, unit: "g", options: ["Carrot", "Leek"] },
              { id: "blue-lunch-fruit", category: "fruit", label: "Fruit", qty: 1, unit: "count", options: ["Apple"] },
            ],
          },
          dinner: { items: [] },
        },
      },
    ],
  },
};

describe("runPicksToSelections", () => {
  const option = mbOptionsForMeal(client as any, "lunch")[0];

  it("maps plan-item ids onto builder component keys", () => {
    const sel = runPicksToSelections(option, {
      "blue-lunch-protein": "Trout",
      "blue-lunch-veg": "Carrot",
      "blue-lunch-fruit": "Apple",
    });
    const byKey = new Map(option.components.map((c) => [c.key, c]));
    expect(Object.keys(sel).length).toBe(3);
    for (const [key, food] of Object.entries(sel)) {
      expect(byKey.has(key)).toBe(true);
      expect(typeof food).toBe("string");
    }
    const vegKey = option.components.find((c) => c.itemId === "blue-lunch-veg" && !c.isVegAlt)!.key;
    expect(sel[vegKey]).toBe("Carrot");
  });

  it("maps the -alt second vegetable to the alt component", () => {
    const sel = runPicksToSelections(option, {
      "blue-lunch-veg": "Carrot",
      "blue-lunch-veg-alt": "Leek",
    });
    const veg = option.components.find((c) => c.itemId === "blue-lunch-veg" && !c.isVegAlt)!;
    const vegAlt = option.components.find((c) => c.itemId === "blue-lunch-veg" && c.isVegAlt)!;
    expect(sel[veg.key]).toBe("Carrot");
    expect(sel[vegAlt.key]).toBe("Leek");
  });

  it("ignores empty picks and components with no itemId", () => {
    expect(runPicksToSelections(option, {})).toEqual({});
    expect(runPicksToSelections(option, { "blue-lunch-veg": "   " })).toEqual({});
    const legacy = { id: 1, label: "x", components: [{ key: "fish", label: "Fish", qty: "140g", sources: [] as never[] }] };
    expect(runPicksToSelections(legacy as any, { fish: "Trout" })).toEqual({});
  });
});
