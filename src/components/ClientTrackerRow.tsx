import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { capTallyFor, type CapFold } from "@/lib/mb-food-list";

export interface ClientTrackerRowProps {
  mealStreak: number;
  waterStreak: number;
  waterToday: number;
  waterTarget?: number;
  foodLimits?: Record<string, number> | null;
  /** MB weekly ledger fold for the current cap window — the sole usage source. */
  capFold?: CapFold | null;
  /** The cap window the fold covers — shown when it isn't a Mon–Sun week. */
  capWindow?: { week_start: string; week_end: string } | null;
  /** Show "used / limit" instead of just "used" (MB plans with a parsed PDF). */
  showLimitTotals?: boolean;
  lastMealLogged: string;
  /** Client-facing water logging. Omit to render Water Today read-only. */
  onAddWater?: () => void;
  variant?: "portal" | "compact";
}

interface LimitCard {
  key: string;
  label: string;
  value: string;
  sub?: string;
}

const isMonSunWeek = (w: { week_start: string; week_end: string } | null | undefined): boolean => {
  if (!w?.week_start) return true;
  const d = new Date(`${w.week_start}T00:00:00Z`);
  return d.getUTCDay() === 1;
};

const shortDate = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
};

function buildLimitCards(
  limits: Record<string, number> | null | undefined,
  showTotals: boolean,
  capFold?: CapFold | null,
  capWindow?: { week_start: string; week_end: string } | null,
): LimitCard[] {
  const windowLabel =
    capFold && capWindow && !isMonSunWeek(capWindow)
      ? `${shortDate(capWindow.week_start)}–${shortDate(capWindow.week_end)}`
      : "this week";
  return Object.entries(limits ?? {})
    .filter(([, lim]) => Number(lim) > 0)
    .map(([name, lim]) => {
      const tally = capFold ? capTallyFor(name, capFold) : null;
      const used = tally ? tally.committed : 0;
      const left = Math.max(0, Number(lim) - used);
      const label = `${name.charAt(0).toUpperCase() + name.slice(1)} / Week`;
      const sub = tally
        ? `${tally.eaten} eaten · ${tally.planned} planned · ${left} left ${windowLabel}`
        : showTotals
        ? `${left} remaining this week`
        : undefined;
      return {
        key: name,
        label,
        value: showTotals || tally ? `${used} / ${Number(lim)}` : `${used}`,
        sub,
      };
    });
}

export default function ClientTrackerRow({
  mealStreak,
  waterStreak,
  waterToday,
  waterTarget,
  foodLimits,
  capFold,
  capWindow,
  showLimitTotals = false,
  lastMealLogged,
  onAddWater,
  variant = "portal",
}: ClientTrackerRowProps) {
  const limitCards = buildLimitCards(foodLimits, showLimitTotals, capFold, capWindow);


  if (variant === "compact") {
    const stats: Array<{ label: string; value: string; sub?: string }> = [
      { label: "Meal Streak", value: `${mealStreak}d` },
      { label: "Water Streak", value: `${waterStreak}d` },
      { label: "Water Today", value: `${waterToday.toFixed(1)} L` },
      ...limitCards.map((c) => ({ label: c.label, value: c.value, sub: capFold ? c.sub : undefined })),
      { label: "Last Meal Logged", value: lastMealLogged },
    ];
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {stats.map((s) => (
          <div key={s.label} className="rounded-md border p-2">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.label}</p>
            <p className="text-sm font-semibold truncate">{s.value}</p>
            {s.sub && <p className="text-[10px] text-muted-foreground truncate">{s.sub}</p>}
          </div>
        ))}
      </div>
    );

  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      <Card className="p-4">
        <p className="text-xs uppercase text-muted-foreground">Meal Streak</p>
        <p className="text-2xl font-semibold">{mealStreak}</p>
        <p className="text-xs text-muted-foreground">consecutive meals logged</p>
      </Card>
      <Card className="p-4">
        <p className="text-xs uppercase text-muted-foreground">Water Streak</p>
        <p className="text-2xl font-semibold">{waterStreak}</p>
        <p className="text-xs text-muted-foreground">consecutive days on target</p>
      </Card>
      <Card className="p-4">
        <p className="text-xs uppercase text-muted-foreground">Water Today</p>
        <p className="text-2xl font-semibold">
          {waterToday.toFixed(2)}L
          {waterTarget ? <span className="text-sm text-muted-foreground"> / {waterTarget}L</span> : null}
        </p>
        {onAddWater && (
          <Button size="sm" variant="outline" className="mt-2 w-full" onClick={onAddWater}>
            + Glass (250ml)
          </Button>
        )}
      </Card>
      {limitCards.map((c) => (
        <Card key={c.key} className="p-4">
          <p className="text-xs uppercase text-muted-foreground">{c.label}</p>
          <p className="text-2xl font-semibold">{c.value}</p>
          {c.sub && <p className="text-xs text-muted-foreground">{c.sub}</p>}
        </Card>
      ))}
      <Card className="p-4">
        <p className="text-xs uppercase text-muted-foreground">Last Meal Logged</p>
        <p className="text-base font-semibold leading-tight">{lastMealLogged}</p>
      </Card>
    </div>
  );
}
