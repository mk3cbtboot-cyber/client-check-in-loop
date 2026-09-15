import { describe, it, expect } from "vitest";
import {
  resolveCheckinMetrics,
  parseCheckinMetricsConfig,
  STANDARD_CHECKIN_METRICS,
} from "@/lib/checkin-metrics";

describe("checkin metrics", () => {
  it("defaults to all nine standard metrics", () => {
    expect(resolveCheckinMetrics({}, "custom")).toHaveLength(9);
    expect(resolveCheckinMetrics(null, "custom").map((m) => m.label)).toEqual(
      STANDARD_CHECKIN_METRICS.map((m) => m.label),
    );
  });

  it("MB clients ignore the practitioner's config", () => {
    const cfg = { active: ["sleep"], labels: { sleep: "Kip" } };
    expect(resolveCheckinMetrics(cfg, "mb")).toEqual(STANDARD_CHECKIN_METRICS);
    expect(resolveCheckinMetrics(cfg, undefined)).toEqual(STANDARD_CHECKIN_METRICS);
  });

  it("Custom clients get the filtered and renamed list", () => {
    const cfg = {
      active: ["general_wellbeing", "sleep", "digestion"],
      labels: { sleep: "Sleep quality" },
    };
    const out = resolveCheckinMetrics(cfg, "custom");
    expect(out.map((m) => m.key)).toEqual(["general_wellbeing", "sleep", "digestion"]);
    expect(out.find((m) => m.key === "sleep")!.label).toBe("Sleep quality");
  });

  it("falls back to the standard set if everything is switched off", () => {
    expect(resolveCheckinMetrics({ active: [] }, "custom")).toHaveLength(9);
  });

  it("ignores malformed config values", () => {
    expect(parseCheckinMetricsConfig("nope")).toEqual({});
    expect(parseCheckinMetricsConfig({ active: ["sleep", 3], labels: { sleep: "  " } })).toEqual({
      active: ["sleep"],
    });
  });
});
