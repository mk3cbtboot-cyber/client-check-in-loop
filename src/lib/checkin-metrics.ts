// Single source of truth for the check-in rating metrics.
//
// These nine keys are real columns on public.check_ins. Practitioners can hide
// or rename metrics for their Custom (own-practice) clients; MB clients always
// see the fixed standard set because the MB protocol defines it.
//
// Hiding a metric is display/collection only — historical values stay in the
// database untouched and no backend validation changes.

export const CHECKIN_METRIC_KEYS = [
  "general_wellbeing",
  "fatigue",
  "sleep",
  "headache",
  "pain",
  "joint_pain",
  "acid_reflux",
  "digestion",
  "allergy_skin",
] as const;

export type CheckinMetricKey = (typeof CHECKIN_METRIC_KEYS)[number];

export interface CheckinMetric {
  key: CheckinMetricKey;
  label: string;
  /** Chart stroke colour token for the practitioner Progress tab. */
  color: string;
}

export const STANDARD_CHECKIN_METRICS: CheckinMetric[] = [
  { key: "general_wellbeing", label: "General Well-Being", color: "hsl(142 71% 45%)" },
  { key: "fatigue", label: "Fatigue", color: "hsl(38 92% 50%)" },
  { key: "sleep", label: "Sleep", color: "hsl(262 83% 58%)" },
  { key: "headache", label: "Headache", color: "hsl(330 80% 55%)" },
  { key: "pain", label: "Pain", color: "hsl(20 90% 55%)" },
  { key: "joint_pain", label: "Joint Pain", color: "hsl(0 72% 51%)" },
  { key: "acid_reflux", label: "Acid Reflux", color: "hsl(80 65% 45%)" },
  { key: "digestion", label: "Digestion", color: "hsl(173 80% 40%)" },
  { key: "allergy_skin", label: "Allergy / Skin", color: "hsl(217 91% 60%)" },
];

/** Shape stored in profiles.checkin_metrics. Empty object = untouched defaults. */
export interface CheckinMetricsConfig {
  /** Keys the practitioner keeps active for Custom clients. Missing = all active. */
  active?: string[];
  /** Per-key label overrides. Missing/blank = standard label. */
  labels?: Record<string, string>;
}

export function parseCheckinMetricsConfig(raw: unknown): CheckinMetricsConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  const cfg: CheckinMetricsConfig = {};
  if (Array.isArray(obj.active)) {
    cfg.active = obj.active.filter((k): k is string => typeof k === "string");
  }
  if (obj.labels && typeof obj.labels === "object" && !Array.isArray(obj.labels)) {
    const labels: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj.labels as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) labels[k] = v.trim();
    }
    if (Object.keys(labels).length) cfg.labels = labels;
  }
  return cfg;
}

/**
 * Resolve the metric list a given client should see.
 * MB clients always get the standard nine; Custom clients get the
 * practitioner's active/renamed list.
 */
export function resolveCheckinMetrics(
  config: unknown,
  clientType: string | null | undefined,
): CheckinMetric[] {
  if (clientType !== "custom") return STANDARD_CHECKIN_METRICS;
  const cfg = parseCheckinMetricsConfig(config);
  const active = cfg.active;
  const labels = cfg.labels ?? {};
  const list = STANDARD_CHECKIN_METRICS.filter((m) => !active || active.includes(m.key));
  // A config that switched everything off would leave nothing to answer;
  // fall back to the standard set rather than shipping an empty form.
  const base = list.length ? list : STANDARD_CHECKIN_METRICS;
  return base.map((m) => ({ ...m, label: labels[m.key]?.trim() || m.label }));
}
