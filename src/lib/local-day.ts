// Client-local calendar day helpers (browser side).
//
// Mirrors supabase/functions/_shared/local-day.ts: every "what day is it for
// this client" decision — streaks, day grouping, week anchors — must be taken
// in the client's own timezone, never UTC.

export const FALLBACK_TZ = "America/Toronto";

const fmt = (zone: string, d: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);

/** YYYY-MM-DD for `instant` in `tz` (falls back to Toronto for missing/bad zones). */
export function localDayISO(instant: Date | string, tz?: string | null): string {
  const d = instant instanceof Date ? instant : new Date(instant);
  const zone = typeof tz === "string" && tz.trim() ? tz.trim() : FALLBACK_TZ;
  try {
    return fmt(zone, d);
  } catch {
    return fmt(FALLBACK_TZ, d);
  }
}

/** YYYY-MM-DD for "now" in `tz`. */
export const localTodayISO = (tz?: string | null, now: Date = new Date()): string =>
  localDayISO(now, tz);

/** Date-only arithmetic on a YYYY-MM-DD string. */
export function shiftISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The Monday (ISO week start) of a YYYY-MM-DD date. */
export function mondayOfISO(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}
