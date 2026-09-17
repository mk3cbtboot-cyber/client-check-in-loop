import { describe, expect, it } from "vitest";
import { currentCheckinPeriod } from "../../supabase/functions/_shared/checkin-period.ts";

const mb = (over: Record<string, unknown> = {}) => ({
  client_type: "mb",
  system_mode: "mb",
  phase: "phase2_strict",
  phase2_strict_started_at: "2026-09-01T10:00:00Z",
  ...over,
});

const custom = (over: Record<string, unknown> = {}) => ({
  client_type: "custom",
  system_mode: "own_practice",
  phase: null,
  checkin_cadence: "weekly",
  checkin_cadence_anchor: "2026-09-01",
  created_at: "2026-08-01T00:00:00Z",
  ...over,
});

describe("MB path (phase-driven)", () => {
  it("is a single day during the first 14 strict days", () => {
    expect(currentCheckinPeriod(mb(), "2026-09-05")).toEqual({ start: "2026-09-05", end: "2026-09-05" });
  });

  it("becomes weekly blocks from day 14", () => {
    expect(currentCheckinPeriod(mb(), "2026-09-16")).toEqual({ start: "2026-09-15", end: "2026-09-21" });
    expect(currentCheckinPeriod(mb(), "2026-09-22")).toEqual({ start: "2026-09-22", end: "2026-09-28" });
  });

  it("is weekly from the phase start in phase 3", () => {
    expect(currentCheckinPeriod(mb({ phase: "phase3" }), "2026-09-10")).toEqual({
      start: "2026-09-08",
      end: "2026-09-14",
    });
  });

  it("has no determinable period for phase 1, phase 4 or a missing start date", () => {
    expect(currentCheckinPeriod(mb({ phase: "phase1" }), "2026-09-10")).toBeNull();
    expect(currentCheckinPeriod(mb({ phase: "phase4" }), "2026-09-10")).toBeNull();
    expect(currentCheckinPeriod(mb({ phase2_strict_started_at: null }), "2026-09-10")).toBeNull();
  });
});

describe("Custom path (cadence-driven)", () => {
  it("daily cadence is one day", () => {
    expect(currentCheckinPeriod(custom({ checkin_cadence: "daily" }), "2026-09-17")).toEqual({
      start: "2026-09-17",
      end: "2026-09-17",
    });
  });

  it("weekly cadence steps from the anchor", () => {
    expect(currentCheckinPeriod(custom(), "2026-09-17")).toEqual({ start: "2026-09-15", end: "2026-09-21" });
  });

  it("biweekly cadence spans 14 days", () => {
    expect(currentCheckinPeriod(custom({ checkin_cadence: "biweekly" }), "2026-09-17")).toEqual({
      start: "2026-09-15",
      end: "2026-09-28",
    });
  });

  it("honours a chosen weekday from its effective date", () => {
    // Friday = 5, effective from Sep 10.
    const p = currentCheckinPeriod(
      custom({ checkin_weekday: 5, checkin_weekday_effective_from: "2026-09-10" }),
      "2026-09-17",
    );
    expect(p).toEqual({ start: "2026-09-11", end: "2026-09-17" });
  });

  it("has no period when cadence is none", () => {
    expect(currentCheckinPeriod(custom({ checkin_cadence: "none" }), "2026-09-17")).toBeNull();
  });

  it("falls back to sign-up date when no anchor is set", () => {
    const p = currentCheckinPeriod(custom({ checkin_cadence_anchor: null, created_at: "2026-09-02T00:00:00Z" }), "2026-09-17");
    expect(p).toEqual({ start: "2026-09-16", end: "2026-09-22" });
  });
});
