// Phase 2 progress helpers — calculate day/week from phase2_strict_started_at.
// Days 1..14 = daily check-in. After that, weekly.

import type { Phase } from "@/lib/phases";

export interface PhaseProgress {
  mode: "day" | "week" | null;
  day?: number;
  week?: number;
  label: string;
}

const STRICT_DAYS = 14;

export function getPhaseProgress(
  phase: Phase | string | null | undefined,
  startedAt: string | null | undefined,
): PhaseProgress {
  if (!startedAt) return { mode: null, label: "" };
  const tracked = phase === "phase2_strict" || phase === "phase2_extended" || phase === "phase3" || phase === "phase4";
  if (!tracked) return { mode: null, label: "" };

  const start = new Date(startedAt).getTime();
  const diffDays = Math.floor((Date.now() - start) / 86_400_000);

  if (phase === "phase2_strict" && diffDays < STRICT_DAYS) {
    const day = Math.max(1, diffDays + 1);
    return { mode: "day", day, label: `Day ${day} of ${STRICT_DAYS}` };
  }
  const week = Math.floor(diffDays / 7) + 1;
  return { mode: "week", week, label: `Week ${week}` };
}

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
    const day = Math.max(1, Math.min(STRICT_DAYS, diffDays + 1));
    return `Day ${day} of ${STRICT_DAYS}`;
  }
  const week = Math.floor(diffDays / 7) + 1;
  return `Week ${week}`;
}
