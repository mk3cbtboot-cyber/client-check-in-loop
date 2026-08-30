import { describe, it, expect } from "vitest";
import { scoreKbMatches, buildKbBlock, buildKbIndexBlock, KB_PRECEDENCE_RULE } from "../../supabase/functions/_shared/nutrition-kb";

const rows = [
  { slug: "hydration", title: "Hydration", summary: "Water intake and fluid balance.", keywords: ["water", "hydration", "dehydration", "thirst", "electrolytes"] },
  { slug: "carbohydrates", title: "Carbohydrates", summary: "Carbs, fibre and blood sugar.", keywords: ["carbs", "sugar", "fibre", "blood sugar", "cravings", "bread"] },
  { slug: "digestion", title: "Digestion, cells, and organ systems", summary: "How food is broken down.", keywords: ["digestion", "bloating", "gut health", "enzymes"] },
  { slug: "fad-diets", title: "Navigating trending and fad diets", summary: "Keto, paleo, fasting.", keywords: ["keto", "intermittent fasting", "paleo", "fad diet"] },
];

describe("nutrition kb retrieval", () => {
  it("matches hydration for a water question", () => {
    expect(scoreKbMatches(rows, "Why do I need to drink so much water?", 2)[0]).toBe("hydration");
  });

  it("matches carbohydrates for a bread craving message", () => {
    expect(scoreKbMatches(rows, "I keep getting cravings for bread", 2)[0]).toBe("carbohydrates");
  });

  it("stem-matches bloated to the digestion article", () => {
    expect(scoreKbMatches(rows, "I feel bloated after dinner", 2)).toContain("digestion");
  });

  it("matches multi-word keywords", () => {
    expect(scoreKbMatches(rows, "Should I try intermittent fasting?", 2)[0]).toBe("fad-diets");
  });

  it("returns nothing for a plan-specific swap question", () => {
    expect(scoreKbMatches(rows, "Can I swap the chicken at lunch for salmon?", 2)).toEqual([]);
  });

  it("returns nothing for small talk", () => {
    expect(scoreKbMatches(rows, "Thanks, feeling great!", 2)).toEqual([]);
  });

  it("caps results at the requested limit", () => {
    expect(scoreKbMatches(rows, "water carbs bloating keto", 2).length).toBeLessThanOrEqual(2);
  });

  it("puts the plan-authoritative precedence rule above the article bodies", () => {
    const block = buildKbBlock([{ slug: "hydration", title: "Hydration", summary: "s", body: "b", keywords: [] }]);
    expect(block.indexOf(KB_PRECEDENCE_RULE)).toBe(0);
    expect(block).toContain("b");
  });

  it("builds an index block listing every article", () => {
    const idx = buildKbIndexBlock(rows);
    for (const r of rows) expect(idx).toContain(r.title);
  });

  it("returns an empty block when nothing matched", () => {
    expect(buildKbBlock([])).toBe("");
  });
});
