import { describe, it, expect } from "vitest";
import { capBlocksMeal, capUnitsForIngredient, foldLedger } from "@/lib/mb-food-list";

const fold = (rows: any[]) => foldLedger(rows);
describe("capBlocksMeal", () => {
  const limits = { eggs: 5, salmon: 2 };
  const meal = [{ label: "3 Eggs", qty: "3" }, { label: "Vegetables: Spinach", qty: "200g" }];
  it("counts eggs", () => expect(capUnitsForIngredient({ label: "3 Eggs", qty: "3" }, "eggs")).toBe(3));
  it("weight = 1 serving", () => expect(capUnitsForIngredient({ label: "Salmon", qty: "120g" }, "salmon")).toBe(1));
  it("2-egg meal usable twice against cap 5, third blocked", () => {
    const two = [{ label: "2 Eggs", qty: "2" }];
    expect(capBlocksMeal(two, limits, fold([]))).toBeNull();
    expect(capBlocksMeal(two, limits, fold([{ food: "eggs", qty: 2, status: "eaten" }]))).toBeNull();
    const third = capBlocksMeal(two, limits, fold([{ food: "eggs", qty: 4, status: "eaten" }]));
    expect(third).toMatchObject({ food: "eggs", need: 2, remaining: 1, cap: 5 });
  });
  it("leftover 1 egg funds a 1-egg meal", () => {
    expect(capBlocksMeal([{ label: "1 Egg", qty: "1" }], limits, fold([{ food: "eggs", qty: 4, status: "eaten" }]))).toBeNull();
  });
  it("non-egg food blocked at cap", () => {
    expect(capBlocksMeal([{ label: "Fish: Salmon", qty: "150g" }], limits, fold([{ food: "salmon", qty: 2, status: "eaten" }]))).toMatchObject({ food: "salmon" });
  });
  it("own planned slot does not block", () => {
    const f = fold([{ food: "eggs", qty: 5, status: "planned" }]);
    expect(capBlocksMeal([{ label: "3 Eggs", qty: "3" }], limits, f, { eaten: {}, planned: {}, committed: f.planned })).toBeNull();
  });
  it("mixed meal fine", () => expect(capBlocksMeal(meal, limits, fold([]))).toBeNull());
});
