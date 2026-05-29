// Shared office-hours / out-of-office utilities used by frontend and edge functions.
export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export const DAY_KEYS: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const DAY_LABELS: Record<DayKey, string> = {
  mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday",
  fri: "Friday", sat: "Saturday", sun: "Sunday",
};

export interface DayHours { enabled: boolean; start: string; end: string }
export interface OfficeHours {
  tz?: string;
  days?: Partial<Record<DayKey, DayHours>>;
}

export const DEFAULT_DAY: DayHours = { enabled: true, start: "09:00", end: "17:00" };
export const DEFAULT_WEEKEND: DayHours = { enabled: false, start: "09:00", end: "17:00" };

export function defaultOfficeHours(tz?: string): Required<OfficeHours> {
  return {
    tz: tz || "UTC",
    days: {
      mon: { ...DEFAULT_DAY }, tue: { ...DEFAULT_DAY }, wed: { ...DEFAULT_DAY },
      thu: { ...DEFAULT_DAY }, fri: { ...DEFAULT_DAY },
      sat: { ...DEFAULT_WEEKEND }, sun: { ...DEFAULT_WEEKEND },
    },
  };
}

export function normalizeOfficeHours(raw: unknown, fallbackTz?: string): Required<OfficeHours> {
  const base = defaultOfficeHours(fallbackTz);
  if (!raw || typeof raw !== "object") return base;
  const r = raw as OfficeHours;
  const tz = (typeof r.tz === "string" && r.tz) || base.tz;
  const days = { ...base.days };
  for (const k of DAY_KEYS) {
    const d = r.days?.[k];
    if (d && typeof d === "object") {
      days[k] = {
        enabled: !!d.enabled,
        start: typeof d.start === "string" ? d.start : base.days[k].start,
        end: typeof d.end === "string" ? d.end : base.days[k].end,
      };
    }
  }
  return { tz, days };
}

// Returns { y, m, d, hour, minute, dow } for a Date in the given IANA tz.
// dow: 0=Sun..6=Sat (matches JS getDay()).
function tzParts(date: Date, tz: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) if (p.type !== "literal") map[p.type] = p.value;
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    y: +map.year, m: +map.month, d: +map.day,
    hour: +map.hour % 24, minute: +map.minute,
    dow: dowMap[map.weekday] ?? 0,
  };
}

const DOW_TO_KEY: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function parseHM(s: string): [number, number] {
  const [h, m] = s.split(":").map((x) => parseInt(x, 10));
  return [isNaN(h) ? 0 : h, isNaN(m) ? 0 : m];
}

export interface AvailabilityState {
  available: boolean;
  reason: "in_hours" | "out_of_hours" | "out_of_office";
}

export function checkAvailability(
  profile: {
    office_hours?: unknown;
    out_of_office?: boolean;
    ooo_return_date?: string | null;
    timezone?: string | null;
  },
  now: Date = new Date(),
): AvailabilityState {
  const tz = (profile.timezone as string) || (profile.office_hours as OfficeHours)?.tz || "UTC";
  const oh = normalizeOfficeHours(profile.office_hours, tz);

  // OOO check (respect return date)
  if (profile.out_of_office) {
    const returnIso = profile.ooo_return_date;
    if (!returnIso) return { available: false, reason: "out_of_office" };
    const parts = tzParts(now, tz);
    const todayIso = `${parts.y.toString().padStart(4, "0")}-${parts.m
      .toString().padStart(2, "0")}-${parts.d.toString().padStart(2, "0")}`;
    if (todayIso < returnIso) return { available: false, reason: "out_of_office" };
  }

  const p = tzParts(now, tz);
  const dayKey = DOW_TO_KEY[p.dow];
  const day = oh.days[dayKey];
  if (!day.enabled) return { available: false, reason: "out_of_hours" };
  const [sh, sm] = parseHM(day.start);
  const [eh, em] = parseHM(day.end);
  const cur = p.hour * 60 + p.minute;
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  if (cur >= startMin && cur < endMin) return { available: true, reason: "in_hours" };
  return { available: false, reason: "out_of_hours" };
}
