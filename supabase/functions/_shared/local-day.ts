// One source of truth for "what day is it for this client".
//
// Every day-boundary decision (cap-ledger week windows, ledger `day` stamps,
// run confirmation dates) must be taken in the client's own timezone — a
// Toronto client confirming at 9pm is still on today, even though UTC has
// already rolled over. Same fallback zone as the evening reminder job.

export const FALLBACK_TZ = "America/Toronto";

/** YYYY-MM-DD for `now` in `tz` (falls back to Toronto for missing/bad zones). */
export function localTodayISO(tz?: string | null, now: Date = new Date()): string {
  const zone = typeof tz === "string" && tz.trim() ? tz.trim() : FALLBACK_TZ;
  const fmt = (z: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: z, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(now);
  try {
    return fmt(zone);
  } catch {
    return fmt(FALLBACK_TZ);
  }
}

/** The Monday (ISO week start) of a YYYY-MM-DD date, date-only arithmetic. */
export function mondayOfISO(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}
