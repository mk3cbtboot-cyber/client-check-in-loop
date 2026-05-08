// Phase 2 progress helpers — calculate day/week from phase2_strict_started_at.
// Days 1–14 = daily check-in. From day 15 onward, weekly (Week 3+).

import type { Phase } from "@/lib/phases";

export interface PhaseProgress {
  mode: "day" | "week" | null;
  day?: number;          // 1..14 when mode === "day"
  week?: number;         // 3+ when mode === "week"
  label: string;         // "Day 3 of 14", "Week 5", or ""
}

export function getPhaseProgress(phase: Phase | string | null | undefined, startedAt: string | null | undefined): PhaseProgress {
  if (!startedAt) return { mode: null, label: "" };
  const tracked = phase === "phase2_strict" || phase === "phase2_extended" || phase === "phase3" || phase === "phase4";
  if (!tracked) return { mode: null, label: "" };

  const start = new Date(startedAt).getTime();
  const diffDays = Math.floor((Date.now() - start) / 86_400_000);

  if (phase === "phase2_strict" && diffDays < 14) {
    const day = Math.max(1, diffDays + 1);
    return { mode: "day", day, label: `Day ${day} of 14` };
  }
  const week = Math.floor(diffDays / 7) + 1;
  return { mode: "week", week, label: `Week ${week}` };
}

// Label a single check-in entry based on the client's phase2 start date.
export function progressLabelForCheckin(
  phase: Phase | string | null | undefined,
  startedAt: string | null | undefined,
  checkinIso: string,
  isWeekly: boolean,
): string {
  if (!startedAt) return "";
  const start = new Date(startedAt).getTime();
  const diffDays = Math.floor((new Date(checkinIso).getTime() - start) / 86_400_000);
  if (diffDays < 0) return "";
  if (isWeekly) {
    const week = Math.floor(diffDays / 7) + 1;
    return `Week ${week}`;
  }
  if (phase === "phase2_strict") {
    const day = Math.max(1, Math.min(14, diffDays + 1));
    return `Day ${day} of 14`;
  }
  const week = Math.floor(diffDays / 7) + 1;
  return `Week ${week}`;
}
