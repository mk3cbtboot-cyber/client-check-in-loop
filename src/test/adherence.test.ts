import { describe, expect, it } from "vitest";
import { dueCheckinDates, resolveCheckinSchedule } from "@/lib/checkin-schedule";
import { computeAdherence } from "@/lib/adherence";

const mbPhase2 = {
  client_type: "mb",
  system_mode: "mb",
  phase: "phase2_strict",
  phase2_strict_started_at: "2026-09-01T12:00:00Z",
  created_at: "2026-08-20T00:00:00Z",
  timezone: "America/Toronto",
};

describe("check-in cadence engine", () => {
  it("MB Phase 1 and Phase 4 have no schedule", () => {
    expect(resolveCheckinSchedule({ ...mbPhase2, phase: "phase1" }).mode).toBe("none");
    expect(resolveCheckinSchedule({ ...mbPhase2, phase: "phase4" }).mode).toBe("none");
  });

  it("MB Phase 2 is daily for 14 days, then weekly", () => {
    const s = resolveCheckinSchedule(mbPhase2);
    expect(s.mode).toBe("phase2");
    const due = dueCheckinDates(s, "2026-09-01", "2026-09-30");
    expect(due.slice(0, 3)).toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]);
    expect(due).toContain("2026-09-14"); // day 14
    expect(due).toContain("2026-09-15"); // first weekly
    expect(due).not.toContain("2026-09-16");
    expect(due).toContain("2026-09-22");
  });

  it("MB Phase 3 is weekly from the phase anchor", () => {
    const s = resolveCheckinSchedule({ ...mbPhase2, phase: "phase3" });
    expect(s.mode).toBe("weekly");
    expect(dueCheckinDates(s, "2026-09-01", "2026-09-22")).toEqual([
      "2026-09-01", "2026-09-08", "2026-09-15", "2026-09-22",
    ]);
  });

  it("a practitioner-set cadence wins for custom clients", () => {
    const s = resolveCheckinSchedule({
      client_type: "custom",
      system_mode: "own_practice",
      checkin_cadence: "biweekly",
      checkin_cadence_anchor: "2026-09-01",
      created_at: "2026-07-01T00:00:00Z",
    });
    expect(s.mode).toBe("biweekly");
    expect(dueCheckinDates(s, "2026-09-01", "2026-09-30")).toEqual(["2026-09-01", "2026-09-15", "2026-09-29"]);
    expect(resolveCheckinSchedule({ client_type: "custom", checkin_cadence: "none" }).mode).toBe("none");
  });
});

describe("adherence", () => {
  const days = (n: number, from: string) =>
    Array.from({ length: n }, (_, i) => {
      const d = new Date(`${from}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + i);
      return d.toISOString().slice(0, 10);
    });

  it("scores meals, water and check-ins with the locked weights", () => {
    const custom = {
      client_type: "custom" as const,
      system_mode: "own_practice",
      plan_format: "food_list",
      meals_per_day: 3,
      checkin_cadence: "weekly",
      checkin_cadence_anchor: "2026-09-01",
      created_at: "2026-08-01T00:00:00Z",
      timezone: "UTC",
    };
    const window = days(14, "2026-09-01"); // Sep 1..14, today = Sep 15
    const res = computeAdherence({
      client: custom,
      today: "2026-09-15",
      mealLogs: window.flatMap((d) => [1, 2, 3].map(() => ({ created_at: `${d}T12:00:00Z` }))),
      waterLogs: window.map((d) => ({ log_date: d, litres: 3 })),
      checkins: [{ created_at: "2026-09-01T12:00:00Z" }, { created_at: "2026-09-08T12:00:00Z" }],
      waterTarget: 2.5,
    });
    expect(res.applicable).toBe(true);
    expect(res.meals).toMatchObject({ done: 42, total: 42 });
    expect(res.water.pct).toBe(100);
    expect(res.checkins).toMatchObject({ done: 2, total: 2 });
    expect(res.score).toBe(100);
  });

  it("excludes MB days outside a confirmed run instead of failing them", () => {
    const mb = {
      ...mbPhase2,
      timezone: "UTC",
      mb_run: { started_on: "2026-09-10", confirmed_on: "2026-09-10" },
    };
    const res = computeAdherence({
      client: mb,
      today: "2026-09-15",
      mealLogs: [],
      waterLogs: [],
      checkins: [],
      waterTarget: 2.5,
    });
    // Only Sep 10/11/12 are scheduled: 9 meals, not 14 days x 3.
    expect(res.meals.total).toBe(9);
    expect(res.meals.pct).toBe(0);
  });

  it("gives Phase 1 and Phase 4 MB clients no adherence window", () => {
    for (const phase of ["phase1", "phase4"]) {
      const res = computeAdherence({
        client: { ...mbPhase2, phase, timezone: "UTC" },
        today: "2026-09-15",
        mealLogs: [],
        waterLogs: [],
        checkins: [],
        waterTarget: 2.5,
      });
      expect(res.applicable).toBe(false);
      expect(res.score).toBeNull();
    }
  });
});
