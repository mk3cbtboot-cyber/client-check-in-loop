// Detects meal slots a client was expected to eat but never logged.
//
// "Logged" is a row in public.recipes for that client on that date with the
// matching meal_type (the universal "I ate this" record for every client type).
// Expected slots depend on the client's plan:
//   • MB              → RUN_MEALS of the confirmed mb_run, for dates inside the run
//   • food_list(_gen) → meals_per_day slots
//   • recipe          → each client_recipe_assignments.meal_slot
// MB clients also surface stale `planned` cap-ledger rows as a "you prepped
// this" hint.

export type SlotKey =
  | "breakfast"
  | "morning_snack"
  | "lunch"
  | "afternoon_snack"
  | "dinner";

export const SLOT_TO_MEAL_TYPE: Record<SlotKey, string> = {
  breakfast: "breakfast",
  morning_snack: "snack",
  lunch: "lunch",
  afternoon_snack: "snack",
  dinner: "dinner",
};

const SLOT_ORDER: Record<number, SlotKey[]> = {
  3: ["breakfast", "lunch", "dinner"],
  4: ["breakfast", "lunch", "afternoon_snack", "dinner"],
  5: ["breakfast", "morning_snack", "lunch", "afternoon_snack", "dinner"],
};

const SLOT_LABEL: Record<SlotKey, string> = {
  breakfast: "Breakfast",
  morning_snack: "Morning snack",
  lunch: "Lunch",
  afternoon_snack: "Afternoon snack",
  dinner: "Dinner",
};

export interface PendingLog {
  /** Calendar date (YYYY-MM-DD) the slot belongs to. */
  date: string;
  /** 0 = today, 1 = yesterday (retroactive). */
  days_ago: number;
  slot: SlotKey;
  /** recipes.meal_type this slot logs as. */
  meal_type: string;
  label: string;
  /** Recipe-plan clients: the assignment to log. */
  assignment_id?: string;
  /** MB only: a cap-ledger row for this day is still `planned`. */
  prepped?: boolean;
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

const FALLBACK_TZ = "America/Toronto";

/**
 * Local clock for `now` in `tz`. Invalid zones fall back to Toronto so a
 * client with a missing/garbage timezone still gets sane nudge timing.
 */
export function localParts(
  tz: string,
  now: Date,
): { date: string; hour: number; minute: number } {
  let zone = tz && tz.trim() ? tz.trim() : FALLBACK_TZ;
  const make = (z: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: z,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    });
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = make(zone);
  } catch {
    zone = FALLBACK_TZ;
    fmt = make(zone);
  }
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour === "24" ? "0" : parts.hour);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour, minute: Number(parts.minute) };
}

/** Hour-of-day (client-local) after which a slot counts as "missed" if unlogged. */
export const DEFAULT_SLOT_DUE_HOUR: Record<SlotKey, number> = {
  breakfast: 10,
  morning_snack: 11,
  lunch: 14,
  afternoon_snack: 16,
  dinner: 20,
};

/** Small buffer past the due hour before a slot is treated as missed. */
export const DUE_GRACE_MINUTES = 30;

/** True once the slot's due time (due hour + grace) has passed locally. */
export function isSlotDue(slot: SlotKey, localHour: number, localMinute: number): boolean {
  const dueMinutes = DEFAULT_SLOT_DUE_HOUR[slot] * 60 + DUE_GRACE_MINUTES;
  return localHour * 60 + localMinute >= dueMinutes;
}

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

function customSlotLabel(slot: SlotKey, mealsPerDay: number): string {
  const order = SLOT_ORDER[mealsPerDay] ?? SLOT_ORDER[3];
  const idx = order.indexOf(slot);
  return idx === -1 ? SLOT_LABEL[slot] : `Meal ${idx + 1}`;
}

/** Dates the confirmed MB run covers. */
function mbRunDates(run: Record<string, unknown> | null): string[] {
  if (!run || typeof run !== "object") return [];
  const started = typeof run.started_on === "string" ? run.started_on : null;
  const confirmed = typeof run.confirmed_on === "string" ? run.confirmed_on : null;
  if (!started || !confirmed) return [];
  return [0, 1, 2].map((i) => addDaysISO(started, i));
}

interface ExpectedSlot {
  slot: SlotKey;
  label: string;
  assignment_id?: string;
}

async function expectedSlotsFor(
  admin: any,
  client: Record<string, any>,
  date: string,
): Promise<ExpectedSlot[]> {
  const clientType = client.client_type === "custom" ? "custom" : "mb";
  const planFormat = typeof client.plan_format === "string" ? client.plan_format : "recipe";

  if (clientType !== "custom") {
    const dates = mbRunDates((client.mb_run ?? null) as Record<string, unknown> | null);
    if (!dates.includes(date)) return [];
    return (["breakfast", "lunch", "dinner"] as SlotKey[]).map((slot) => ({
      slot,
      label: SLOT_LABEL[slot],
    }));
  }

  if (planFormat === "food_list" || planFormat === "food_list_generated") {
    const mealsPerDay = Number(client.meals_per_day ?? 3);
    const order = SLOT_ORDER[mealsPerDay] ?? SLOT_ORDER[3];
    return order.map((slot) => ({ slot, label: customSlotLabel(slot, mealsPerDay) }));
  }

  if (planFormat === "recipe") {
    const { data } = await admin
      .from("client_recipe_assignments")
      .select("id, meal_slot")
      .eq("client_id", client.id);
    const mealsPerDay = Number(client.meals_per_day ?? 3);
    return ((data ?? []) as Array<{ id: string; meal_slot: string }>)
      .filter((a) => a.meal_slot in SLOT_TO_MEAL_TYPE)
      .map((a) => ({
        slot: a.meal_slot as SlotKey,
        label: customSlotLabel(a.meal_slot as SlotKey, mealsPerDay),
        assignment_id: a.id,
      }));
  }

  return [];
}

/**
 * Meal slots expected but not logged over the last `days` calendar days
 * (day 0 = today, day 1 = yesterday's grace window).
 */
export async function missedMealSlots(
  admin: any,
  client: Record<string, any>,
  days = 2,
  opts: { tz?: string; now?: Date } = {},
): Promise<PendingLog[]> {
  const now = opts.now ?? new Date();
  const tz = typeof client.timezone === "string" && client.timezone.trim()
    ? client.timezone.trim()
    : (opts.tz ?? FALLBACK_TZ);
  const local = localParts(tz, now);
  const today = local.date;
  const dates = Array.from({ length: Math.max(1, days) }, (_, i) => addDaysISO(today, -i));
  const windowStart = dates[dates.length - 1];

  const { data: logs } = await admin
    .from("recipes")
    .select("meal_type, created_at")
    .eq("client_id", client.id)
    .gte("created_at", `${windowStart}T00:00:00Z`);

  // date → meal_type → count of logged meals (bucketed in the client's tz so
  // a late-evening log isn't pushed across the UTC day boundary)
  const logged = new Map<string, Map<string, number>>();
  for (const r of (logs ?? []) as Array<{ meal_type: string | null; created_at: string }>) {
    const d = localParts(tz, new Date(r.created_at)).date;
    const mt = r.meal_type ?? "";
    const byType = logged.get(d) ?? new Map<string, number>();
    byType.set(mt, (byType.get(mt) ?? 0) + 1);
    logged.set(d, byType);
  }

  // MB "you prepped this" hint — cap-ledger rows still sitting at planned.
  const preppedDays = new Set<string>();
  if (client.client_type !== "custom") {
    const { data: ledger } = await admin
      .from("mb_cap_ledger")
      .select("day, status")
      .eq("client_id", client.id)
      .eq("status", "planned")
      .gte("day", windowStart)
      .lte("day", today);
    for (const row of (ledger ?? []) as Array<{ day: string }>) preppedDays.add(row.day);
  }

  const pending: PendingLog[] = [];
  for (const date of dates) {
    const expected = await expectedSlotsFor(admin, client, date);
    if (!expected.length) continue;
    const remaining = new Map(logged.get(date) ?? []);
    for (const e of expected) {
      const mealType = SLOT_TO_MEAL_TYPE[e.slot];
      const left = remaining.get(mealType) ?? 0;
      if (left > 0) {
        remaining.set(mealType, left - 1);
        continue;
      }
      pending.push({
        date,
        days_ago: dates.indexOf(date),
        slot: e.slot,
        meal_type: mealType,
        label: e.label,
        ...(e.assignment_id ? { assignment_id: e.assignment_id } : {}),
        ...(preppedDays.has(date) ? { prepped: true } : {}),
      });
    }
  }
  return pending;
}
