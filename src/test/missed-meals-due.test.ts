import { describe, expect, it } from "vitest";
import {
  DEFAULT_SLOT_DUE_HOUR,
  DUE_GRACE_MINUTES,
  isSlotDue,
  localParts,
  missedMealSlots,
} from "../../supabase/functions/_shared/missed-meals";

describe("DEFAULT_SLOT_DUE_HOUR", () => {
  it("uses the agreed default due hours", () => {
    expect(DEFAULT_SLOT_DUE_HOUR).toEqual({
      breakfast: 10,
      morning_snack: 11,
      lunch: 14,
      afternoon_snack: 16,
      dinner: 20,
    });
  });
});

describe("isSlotDue", () => {
  it("is not due before the due hour", () => {
    expect(isSlotDue("breakfast", 8, 0)).toBe(false);
    expect(isSlotDue("lunch", 8, 0)).toBe(false);
    expect(isSlotDue("dinner", 8, 0)).toBe(false);
  });

  it("is not due inside the grace window", () => {
    expect(isSlotDue("breakfast", 10, DUE_GRACE_MINUTES - 1)).toBe(false);
  });

  it("is due once the due hour + grace has passed", () => {
    expect(isSlotDue("breakfast", 10, DUE_GRACE_MINUTES)).toBe(true);
    expect(isSlotDue("lunch", 15, 0)).toBe(true);
    expect(isSlotDue("dinner", 21, 0)).toBe(true);
  });

  it("still hides dinner before its evening due time", () => {
    expect(isSlotDue("dinner", 19, 59)).toBe(false);
    expect(isSlotDue("dinner", 20, DUE_GRACE_MINUTES)).toBe(true);
  });
});

describe("localParts", () => {
  it("resolves the local date/hour in the client timezone, not UTC", () => {
    // 02:00 UTC on Aug 29 = 22:00 on Aug 28 in Toronto (EDT).
    const p = localParts("America/Toronto", new Date("2026-08-29T02:00:00Z"));
    expect(p.date).toBe("2026-08-28");
    expect(p.hour).toBe(22);
  });

  it("falls back to America/Toronto for an invalid timezone", () => {
    const p = localParts("Not/AZone", new Date("2026-08-29T02:00:00Z"));
    expect(p.date).toBe("2026-08-28");
  });

  it("handles midnight (hour 24) without crashing", () => {
    const p = localParts("America/Toronto", new Date("2026-08-29T04:00:00Z"));
    expect(p.hour).toBe(0);
    expect(p.date).toBe("2026-08-29");
  });
});

describe("missedMealSlots — Recipe Plan slot grouping", () => {


  const client = {
    id: "c1",
    client_type: "custom",
    plan_format: "recipe",
    meals_per_day: 3,
    timezone: "America/Toronto",
  };

  // Chainable stub: recipes → no logs; client_recipe_assignments → 3 options
  // in each of breakfast/lunch/dinner (9 rows).
  const stubAdmin = (assignments: Array<{ id: string; meal_slot: string }>) => {
    const chain = (rows: unknown[]): any => {
      const c: any = {
        select: () => c, eq: () => c, is: () => c, gte: () => c, lte: () => c,
        then: (res: any) => Promise.resolve({ data: rows }).then(res),
      };
      return c;
    };
    return {
      from: (t: string) =>
        chain(t === "client_recipe_assignments" ? assignments : []),
    };
  };

  const nineAssignments = [
    ...["b1", "b2", "b3"].map((id) => ({ id, meal_slot: "breakfast" })),
    ...["l1", "l2", "l3"].map((id) => ({ id, meal_slot: "lunch" })),
    ...["d1", "d2", "d3"].map((id) => ({ id, meal_slot: "dinner" })),
  ];

  it("lists each slot once even with multiple recipe options assigned", async () => {
    // 23:00 Toronto so every slot's due time has passed.
    const pending = await missedMealSlots(stubAdmin(nineAssignments), client, 1, {
      now: new Date("2026-09-16T03:00:00Z"),
    });
    expect(pending.map((p) => p.slot).sort()).toEqual([
      "breakfast",
      "dinner",
      "lunch",
    ]);
  });

  it("logged slots are not listed (unchanged)", async () => {
    const loggedAdmin: any = {
      from: (t: string) => {
        const rows =
          t === "client_recipe_assignments"
            ? nineAssignments
            : t === "recipes"
              ? [
                  { meal_type: "breakfast", created_at: "2026-09-15T12:00:00Z" },
                  { meal_type: "lunch", created_at: "2026-09-15T17:00:00Z" },
                  { meal_type: "dinner", created_at: "2026-09-15T23:00:00Z" },
                ]
              : [];
        const c: any = {
          select: () => c, eq: () => c, is: () => c, gte: () => c, lte: () => c,
          then: (res: any) => Promise.resolve({ data: rows }).then(res),
        };
        return c;
      },
    };
    const pending = await missedMealSlots(loggedAdmin, client, 1, {
      now: new Date("2026-09-16T03:00:00Z"),
    });
    expect(pending).toEqual([]);
  });
});
