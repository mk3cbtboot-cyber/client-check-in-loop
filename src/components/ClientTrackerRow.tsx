import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export interface ClientTrackerRowProps {
  mealStreak: number;
  waterStreak: number;
  waterToday: number;
  waterTarget?: number;
  foodLimits?: Record<string, number> | null;
  foodLimitCounts?: Record<string, number> | null;
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

function buildLimitCards(
  limits: Record<string, number> | null | undefined,
  counts: Record<string, number> | null | undefined,
  showTotals: boolean,
): LimitCard[] {
  return Object.entries(limits ?? {})
    .filter(([, lim]) => Number(lim) > 0)
    .map(([name, lim]) => {
      const used = Number((counts ?? {})[name] ?? 0);
      const left = Math.max(0, Number(lim) - used);
      const label = `${name.charAt(0).toUpperCase() + name.slice(1)} / Week`;
      return {
        key: name,
        label,
        value: showTotals ? `${used} / ${Number(lim)}` : `${used}`,
        sub: showTotals ? `${left} remaining this week` : undefined,
      };
    });
}

export default function ClientTrackerRow({
  mealStreak,
  waterStreak,
  waterToday,
  waterTarget,
  foodLimits,
  foodLimitCounts,
  showLimitTotals = false,
  lastMealLogged,
  onAddWater,
  variant = "portal",
}: ClientTrackerRowProps) {
  const limitCards = buildLimitCards(foodLimits, foodLimitCounts, showLimitTotals);

  if (variant === "compact") {
    const stats = [
      { label: "Meal Streak", value: `${mealStreak}d` },
      { label: "Water Streak", value: `${waterStreak}d` },
      { label: "Water Today", value: `${waterToday.toFixed(1)} L` },
      ...limitCards.map((c) => ({ label: c.label, value: c.value })),
      { label: "Last Meal Logged", value: lastMealLogged },
    ];
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {stats.map((s) => (
          <div key={s.label} className="rounded-md border p-2">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.label}</p>
            <p className="text-sm font-semibold truncate">{s.value}</p>
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
