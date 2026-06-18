export type Phase =
  | "phase1"
  | "phase2_strict"
  | "phase2_extended"
  | "phase3"
  | "phase4";

export const PHASE_OPTIONS: { value: Phase; label: string; short: string }[] = [
  { value: "phase1", label: "Phase 1 — Preparation", short: "Phase 1" },
  { value: "phase2_strict", label: "Phase 2 — Strict Conversion", short: "Phase 2" },
  { value: "phase2_extended", label: "Phase 2 Extended — Treat Meals", short: "Phase 2 Extended" },
  { value: "phase3", label: "Phase 3 — Relaxed Conversion", short: "Phase 3" },
  { value: "phase4", label: "Phase 4 — Maintenance", short: "Phase 4" },
];

export const phaseLabel = (p: string) =>
  PHASE_OPTIONS.find((o) => o.value === p)?.label ?? p;

export const phaseShort = (p: string) =>
  PHASE_OPTIONS.find((o) => o.value === p)?.short ?? p;

export const oilAllowed = (p: string) =>
  p === "phase2_extended" || p === "phase3" || p === "phase4";

export const recipeBuilderEnabled = (p: string) => p !== "phase1";
