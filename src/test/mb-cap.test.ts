import { describe, expect, it } from "vitest";
import {
  addDays,
  consumedFor,
  evaluateRunCaps,
  mealDemand,
  ledgerRowsForRun,
  perMealQty,
  planRunAgainstLedger,
  weekWindowFor,
  weeklyCapFor,
  type CapConsumed,
  type CapSuggestion,
} from "../../supabase/functions/_shared/mb-cap";
import { parseMbRun, resolveDayMeal, startRun, swapDayMeal } from "@/lib/mb-run";
import { vegAltIdFor, vegQtyOverrides } from "@/lib/mb-plan";

const suggestions = [
  {
    colour: "blue",
    label: "Suggestion 1",
    meals: {
      breakfast: {
        items: [{ id: "b1", category: "fixed", label: "Eggs", qty: 2, unit: "count" }],
      },
      lunch: {
        items: [
          { id: "l1", category: "fixed", label: "Eggs", qty: 2, unit: "count" },
          { id: "l2", category: "fixed", label: "2 Eggs", qty: null, unit: "as_listed", note: "2 Eggs" },
        ],
      },
      dinner: { items: [] },
    },
  },
  {
    colour: "green",
    label: "Suggestion 2",
    meals: {
      breakfast: { items: [{ id: "g1", category: "fixed", label: "Oatmeal", qty: 40, unit: "g" }] },
      lunch: { items: [] },
      dinner: { items: [] },
    },
  },
] as unknown as CapSuggestion[];

const legacyRun = {
  colour: "blue",
  meals: {
    breakfast: { colour: "blue", picks: {} },
    lunch: { colour: "blue", picks: {} },
    dinner: { colour: "blue", picks: {} },
  },
};

describe("mb cap primitives", () => {
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

  it("keeps the legacy run evaluator working", () => {
    const v = evaluateRunCaps(legacyRun, suggestions, [{ food: "eggs", type: "weekly", max: 5 }], {}, 3);
    expect(v.length).toBeGreaterThan(0);
  });

  it("matches consumed food names loosely", () => {
    expect(consumedFor("Eggs", { eggs: 4 })).toBe(4);
    expect(consumedFor("Eggs", { kale: 4 })).toBe(0);
  });
});

/* ---------------- v1 → v2 run model ---------------- */

describe("mb_run v1 → v2 upgrade", () => {
  const v1 = {
    colour: "blue",
    started_on: "2026-08-17",
    confirmed_on: "2026-08-17",
    meals: {
      breakfast: { colour: "blue", picks: { b1: "Eggs" } },
      lunch: { colour: "green", picks: { l1: "Chicken" } },
      dinner: { colour: "blue", picks: {} },
    },
  };

  it("parses an existing row into the identical 3-day run", () => {
    const run = parseMbRun(v1);
    expect(run.version).toBe(2);
    expect(run.colour).toBe("blue");
    expect(run.started_on).toBe("2026-08-17");
    expect(run.confirmed_on).toBe("2026-08-17");
    expect(run.meals.breakfast).toEqual({ colour: "blue", picks: { b1: "Eggs" } });
    expect(run.meals.lunch).toEqual({ colour: "green", picks: { l1: "Chicken" } });
    expect(run.day_overrides).toEqual({});
  });

  it("fills all three days from one set of picks until a day is swapped", () => {
    const run = parseMbRun(v1);
    for (const d of ["2026-08-17", "2026-08-18", "2026-08-19"]) {
      expect(resolveDayMeal(run, suggestions as never, d, "breakfast").colour).toBe("blue");
    }
    const swapped = swapDayMeal(run, "2026-08-19", "breakfast", "green");
    expect(resolveDayMeal(swapped, suggestions as never, "2026-08-18", "breakfast").colour).toBe("blue");
    expect(resolveDayMeal(swapped, suggestions as never, "2026-08-19", "breakfast").colour).toBe("green");
    expect(swapped.confirmed_on).toBeNull();
    // round-trips through storage unchanged
    expect(parseMbRun(JSON.parse(JSON.stringify(swapped)))).toEqual(swapped);
  });

  it("startRun produces one shared set of picks, no day forms", () => {
    const run = startRun("blue", "2026-08-20");
    expect(Object.keys(run.day_overrides)).toHaveLength(0);
    expect(run.meals.breakfast?.colour).toBe("blue");
  });
});

/* ---------------- week window ---------------- */

describe("weekWindowFor (Phase 2 anchored)", () => {
  const anchor = "2026-08-03"; // Phase 2 start

  it("counts 7-day windows from the anchor", () => {
    expect(weekWindowFor(anchor, "2026-08-03")).toEqual({
      week_start: "2026-08-03", week_end: "2026-08-09", index: 0,
    });
    expect(weekWindowFor(anchor, "2026-08-09").index).toBe(0);
    expect(weekWindowFor(anchor, "2026-08-10")).toEqual({
      week_start: "2026-08-10", week_end: "2026-08-16", index: 1,
    });
  });

  it("covers Phase 2's 14 days as exactly two windows", () => {
    const days = Array.from({ length: 14 }, (_, i) => addDays(anchor, i));
    const starts = new Set(days.map((d) => weekWindowFor(anchor, d).week_start));
    expect([...starts].sort()).toEqual(["2026-08-03", "2026-08-10"]);
  });

  it("falls back to the date itself with no anchor", () => {
    expect(weekWindowFor(null, "2026-08-20").week_start).toBe("2026-08-20");
  });
});

/* ---------------- the eggs example ---------------- */

describe("planRunAgainstLedger — eggs capped at 4/week, 2-egg breakfast", () => {
  const anchor = "2026-08-03";
  const limits = [{ food: "eggs", type: "weekly", max: 4 }];
  // Breakfast-only suggestion set so the example is exactly the spec's.
  const plan = [
    {
      colour: "blue",
      label: "Suggestion 1",
      meals: {
        breakfast: { items: [{ id: "b1", category: "fixed", label: "Eggs", qty: 2, unit: "count" }] },
        lunch: { items: [] },
        dinner: { items: [] },
      },
    },
    {
      colour: "green",
      label: "Suggestion 2",
      meals: {
        breakfast: { items: [{ id: "g1", category: "fixed", label: "Oatmeal", qty: 40, unit: "g" }] },
        lunch: { items: [] },
        dinner: { items: [] },
      },
    },
  ] as unknown as CapSuggestion[];

  const run = (startDate: string, overrides = {}) => ({
    colour: "blue",
    started_on: startDate,
    meals: {
      breakfast: { colour: "blue", picks: {} },
      lunch: { colour: "blue", picks: {} },
      dinner: { colour: "blue", picks: {} },
    },
    day_overrides: overrides,
  });

  it("passes days 1 and 2 and blocks day 3", () => {
    const res = planRunAgainstLedger(run("2026-08-03"), plan, limits, {}, {}, { anchor });
    expect(res.blocks).toHaveLength(1);
    expect(res.blocks[0]).toMatchObject({
      date: "2026-08-05", meal: "breakfast", food: "Eggs", need: 2, remaining: 0, cap: 4,
    });
    expect(res.rows.filter((r) => r.food === "Eggs")).toHaveLength(2);
    expect(res.rows.every((r) => r.week_start === "2026-08-03")).toBe(true);
  });

  it("clears day 3 once that breakfast is swapped to another suggestion", () => {
    const swapped = run("2026-08-03", {
      "2026-08-05": { breakfast: { colour: "green", picks: {} } },
    });
    const res = planRunAgainstLedger(swapped, plan, limits, {}, {}, { anchor });
    expect(res.blocks).toHaveLength(0);
    expect(res.rows.filter((r) => r.food === "Eggs")).toHaveLength(2);
  });

  it("blocks every day of a second run of the same colour that week", () => {
    const consumed: CapConsumed = { "2026-08-03": { Eggs: 4 } };
    const res = planRunAgainstLedger(run("2026-08-06"), plan, limits, {}, consumed, { anchor });
    expect(res.blocks.map((b) => b.date)).toEqual(["2026-08-06", "2026-08-07", "2026-08-08"]);
    expect(res.rows).toHaveLength(0);
  });

  it("clears the spent allowance once the window rolls to the next 7 days", () => {
    const consumed: CapConsumed = { "2026-08-03": { Eggs: 4 } };
    const res = planRunAgainstLedger(run("2026-08-10"), plan, limits, {}, consumed, { anchor });
    // Fresh allowance: days 1 and 2 pass again, day 3 blocks as in week 0.
    expect(res.blocks.map((b) => b.date)).toEqual(["2026-08-12"]);
    expect(res.rows).toHaveLength(2);
    expect(res.rows.every((r) => r.week_start === "2026-08-10")).toBe(true);
  });


  it("charges each day to its own window when a run straddles the roll", () => {
    // Days 08-09 (week 0, already spent), 08-10 and 08-11 (week 1, free).
    const consumed: CapConsumed = { "2026-08-03": { Eggs: 4 } };
    const res = planRunAgainstLedger(run("2026-08-09"), plan, limits, {}, consumed, { anchor });
    expect(res.blocks.map((b) => b.date)).toEqual(["2026-08-09"]);
    expect(res.rows.map((r) => r.week_start)).toEqual(["2026-08-10", "2026-08-10"]);
  });

  it("ledgerRowsForRun returns exactly what a confirm would write", () => {
    const rows = ledgerRowsForRun(run("2026-08-03"), plan, limits, {}, {}, { anchor });
    expect(rows).toEqual([
      { week_start: "2026-08-03", day: "2026-08-03", meal: "breakfast", food: "Eggs", qty: 2, status: "planned", source: "run" },
      { week_start: "2026-08-03", day: "2026-08-04", meal: "breakfast", food: "Eggs", qty: 2, status: "planned", source: "run" },
    ]);
  });

  it("blocks the whole meal atomically, consuming nothing from it", () => {
    const twoCapped = [
      {
        colour: "blue",
        label: "Suggestion 1",
        meals: {
          breakfast: {
            items: [
              { id: "b1", category: "fixed", label: "Cheese", qty: 30, unit: "g" },
              { id: "b2", category: "fixed", label: "Eggs", qty: 2, unit: "count" },
            ],
          },
          lunch: { items: [] },
          dinner: { items: [] },
        },
      },
    ] as unknown as CapSuggestion[];
    const res = planRunAgainstLedger(
      run("2026-08-03"), twoCapped,
      [{ food: "eggs", type: "weekly", max: 4 }, { food: "cheese", type: "weekly", max: 10 }],
      {}, {}, { anchor },
    );
    // Day 3's breakfast is blocked on eggs, so its cheese is not charged either.
    expect(res.rows.filter((r) => r.food === "Cheese")).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------ */
/* Optional second vegetable (veg2)                                     */
/* ------------------------------------------------------------------ */

const vegSuggestions = [
  {
    colour: "blue",
    label: "Suggestion 1",
    meals: {
      breakfast: { items: [] },
      lunch: {
        items: [
          { id: "v1", category: "vegetables", label: "Vegetables", qty: 190, unit: "g" },
        ],
      },
      dinner: { items: [] },
    },
  },
] as unknown as CapSuggestion[];

const vegRun = (picks: Record<string, string>) => ({
  colour: "blue",
  started_on: "2026-08-24",
  meals: {
    breakfast: { colour: "blue", picks: {} },
    lunch: { colour: "blue", picks },
    dinner: { colour: "blue", picks: {} },
  },
  day_overrides: {},
});

describe("second vegetable pick and weekly caps", () => {
  it("counts a capped food picked as the second vegetable", () => {
    const rows = mealDemand(
      [{ id: "v1", category: "vegetables", label: "Vegetables", qty: 190, unit: "g" }],
      { v1: "Broccoli", "v1-alt": "Avocado" },
    );
    expect(rows).toEqual([
      { food: "Broccoli", qty: 1 },
      { food: "Avocado", qty: 1 },
    ]);
  });

  it("does not add demand when no second vegetable is chosen", () => {
    expect(
      mealDemand([{ id: "v1", category: "vegetables", label: "Vegetables", qty: 190, unit: "g" }], {
        v1: "Broccoli",
      }),
    ).toEqual([{ food: "Broccoli", qty: 1 }]);
  });

  it("blocks a second-vegetable pick that exceeds its weekly cap", () => {
    const consumed: CapConsumed = { "2026-08-24": { Avocado: 3 } };
    const plan = planRunAgainstLedger(
      vegRun({ v1: "Broccoli", "v1-alt": "Avocado" }),
      vegSuggestions,
      [],
      { Avocado: 3 },
      consumed,
      { anchor: "2026-08-24", runDays: 3, startDate: "2026-08-24" },
    );
    expect(plan.blocks.length).toBe(3);
    expect(plan.blocks[0].food).toBe("Avocado");
  });

  it("allows the second-vegetable pick inside the cap", () => {
    const plan = planRunAgainstLedger(
      vegRun({ v1: "Broccoli", "v1-alt": "Avocado" }),
      vegSuggestions,
      [],
      { Avocado: 3 },
      {},
      { anchor: "2026-08-24", runDays: 3, startDate: "2026-08-24" },
    );
    expect(plan.blocks.length).toBe(0);
    expect(plan.rows.filter((r) => r.food === "Avocado").length).toBe(3);
  });
});

describe("veg qty split helpers", () => {
  it("halves gram portions only when both vegetables are picked", () => {
    const components = [
      { key: "vegetables-0", qty: "190g" },
      { key: "vegetables-0-alt", qty: "" },
    ];
    expect(vegQtyOverrides(components, { "vegetables-0": "Broccoli" })).toEqual({});
    expect(
      vegQtyOverrides(components, { "vegetables-0": "Broccoli", "vegetables-0-alt": "Kale" }),
    ).toEqual({ "vegetables-0": "95g", "vegetables-0-alt": "95g" });
  });

  it("supports the legacy veg1/veg2 keys", () => {
    expect(
      vegQtyOverrides([{ key: "veg1", qty: "200g" }, { key: "veg2", qty: "" }], {
        veg1: "Broccoli",
        veg2: "Kale",
      }),
    ).toEqual({ veg1: "100g", veg2: "100g" });
  });

  it("only offers a second pick for non-optional veg categories", () => {
    expect(vegAltIdFor({ id: "v1", category: "vegetables" })).toBe("v1-alt");
    expect(vegAltIdFor({ id: "v2", category: "vegLettuce" })).toBe("v2-alt");
    expect(vegAltIdFor({ id: "v3", category: "vegetables", optional: true })).toBeNull();
    expect(vegAltIdFor({ id: "p1", category: "protein" })).toBeNull();
  });
});
