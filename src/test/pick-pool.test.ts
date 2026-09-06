import { describe, it, expect } from "vitest";
import { resolvePickPool } from "@/lib/mb-food-list";
const base = { mb_food_list: { fish: ["Trout"], vegetables: ["Broccoli"], vegLettuce: ["Romaine"] } };
describe("resolvePickPool", () => {
  it("phase3 fish merges", () => {
    expect(resolvePickPool({ ...base, phase: "phase3", phase3_mb_fish: "Salmon, Cod" }, "fish")).toEqual(["Trout","Salmon","Cod"]);
  });
  it("approved categorized request", () => {
    expect(resolvePickPool({ ...base, phase: "phase3", phase3_approved_foods: [{ food: "Sauerkraut", category: "vegetables" }] }, "vegetables")).toEqual(["Broccoli","Sauerkraut"]);
  });
  it("sprouts fold into vegetables", () => {
    expect(resolvePickPool({ ...base, phase: "phase3", phase3_mb_sprouts: "Alfalfa Sprouts" }, "vegetables")).toEqual(["Broccoli","Alfalfa Sprouts"]);
  });
  it("oils only from client's list", () => {
    expect(resolvePickPool({ ...base, phase: "phase3", phase3_mb_fat_oil: "Cold-Pressed Olive Oil" }, "oils")).toEqual(["Cold-Pressed Olive Oil"]);
    expect(resolvePickPool({ ...base, phase: "phase3" }, "oils")).toEqual([]);
  });
  it("phase4 keeps additions", () => {
    expect(resolvePickPool({ ...base, phase: "phase4", phase3_mb_fish: "Salmon" }, "fish")).toEqual(["Trout","Salmon"]);
  });
  it("phase2 unaffected", () => {
    expect(resolvePickPool({ ...base, phase: "phase2_strict", phase3_mb_fish: "Salmon" }, "fish")).toEqual(["Trout"]);
  });
  it("empty column = no catalogue leak", () => {
    expect(resolvePickPool({ ...base, phase: "phase3", phase3_mb_meat: "" }, "meat")).toEqual([]);
  });
  it("vegLettuce merges veg + p3", () => {
    expect(resolvePickPool({ ...base, phase: "phase3", phase3_mb_veg_lettuce: "Endive", phase3_mb_vegetables: "Fennel" }, "vegLettuce")).toEqual(["Romaine","Broccoli","Fennel","Endive"]);
  });
});
