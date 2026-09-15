import { describe, expect, it } from "vitest";
import { dueCheckinDates, nextCheckinDue, resolveCheckinSchedule } from "@/lib/checkin-schedule";
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
    // Weekly cadence => trailing 7 complete days (Sep 8..14), today = Sep 15.
    const window = days(14, "2026-09-01");
    const res = computeAdherence({
      client: custom,
      today: "2026-09-15",
      mealLogs: window.flatMap((d) => [1, 2, 3].map(() => ({ created_at: `${d}T12:00:00Z` }))),
      waterLogs: window.map((d) => ({ log_date: d, litres: 3 })),
      checkins: [{ created_at: "2026-09-01T12:00:00Z" }, { created_at: "2026-09-08T12:00:00Z" }],
      waterTarget: 2.5,
    });
    expect(res.applicable).toBe(true);
    expect(res.windowStart).toBe("2026-09-08");
    expect(res.meals).toMatchObject({ done: 21, total: 21 });
    expect(res.water.pct).toBe(100);
    expect(res.checkins).toMatchObject({ done: 1, total: 1 });
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
    // Phase 2 day 1-14 daily period: window = days elapsed, capped at 14.
    expect(res.windowStart).toBe("2026-09-01");
    // Only Sep 10/11/12 are scheduled: 9 meals, not every day x 3.
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

describe("cadence-matched window and weekday changes", () => {
  it("Phase 2 daily period grows with days elapsed, then drops to 7 days", () => {
    const early = computeAdherence({
      client: { ...mbPhase2, timezone: "UTC", mb_run: {} },
      today: "2026-09-06",
      mealLogs: [], waterLogs: [], checkins: [], waterTarget: 2.5,
    });
    expect(early.windowStart).toBe("2026-09-01");
    expect(early.windowEnd).toBe("2026-09-05");

    const later = computeAdherence({
      client: { ...mbPhase2, phase: "phase3", timezone: "UTC", mb_run: {} },
      today: "2026-09-30",
      mealLogs: [], waterLogs: [], checkins: [], waterTarget: 2.5,
    });
    expect(later.windowStart).toBe("2026-09-23");
    expect(later.windowEnd).toBe("2026-09-29");
  });

  it("a custom client set to no check-ins gets no badge", () => {
    const res = computeAdherence({
      client: { client_type: "custom", system_mode: "own_practice", checkin_cadence: "none", created_at: "2026-08-01T00:00:00Z", timezone: "UTC" },
      today: "2026-09-15",
      mealLogs: [], waterLogs: [], checkins: [], waterTarget: 2.5,
    });
    expect(res.applicable).toBe(false);
  });

  it("a weekday change does not rewrite past due dates", () => {
    const base = {
      client_type: "custom",
      system_mode: "own_practice",
      checkin_cadence: "weekly",
      checkin_cadence_anchor: "2026-09-01", // Tuesday
      created_at: "2026-08-01T00:00:00Z",
    };
    const before = dueCheckinDates(resolveCheckinSchedule(base), "2026-09-01", "2026-09-29");
    expect(before).toEqual(["2026-09-01", "2026-09-08", "2026-09-15", "2026-09-22", "2026-09-29"]);

    const changed = resolveCheckinSchedule({
      ...base,
      checkin_weekday: 5, // Friday
      checkin_weekday_effective_from: "2026-09-16",
    });
    const after = dueCheckinDates(changed, "2026-09-01", "2026-09-29");
    // History intact before the change date, Fridays afterwards.
    expect(after.filter((d) => d < "2026-09-16")).toEqual(["2026-09-01", "2026-09-08", "2026-09-15"]);
    expect(after.filter((d) => d >= "2026-09-16")).toEqual(["2026-09-18", "2026-09-25"]);
  });

  it("nextCheckinDue returns the first upcoming due date", () => {
    const s = resolveCheckinSchedule({ ...mbPhase2, phase: "phase3" });
    expect(nextCheckinDue(s, "2026-09-16")).toBe("2026-09-22");
  });
});
