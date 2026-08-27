import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import type { MealType } from "@/lib/mb-foods";
import { vegAltIdFor } from "@/lib/mb-plan";
import type { MbColour, MbFoodLimit, MbPlanItem, MbSuggestion } from "@/lib/mb-plan";
import {
  capFoodFor, categoryLabel, consumedFor, perMealQty, planRunAgainstLedger,
  weekWindowFor, weeklyCapFor, type CapConsumed, type MbFoodListMap,
} from "@/lib/mb-food-list";
import { RUN_DAYS, RUN_MEALS, fmtQty, parseMbRun, resolveDayMeal, resolveRunMeal, runDates, todayISO } from "@/lib/mb-run";
import {
  COLOUR_BAR, COLOUR_LABEL, MEAL_LABEL, MbColourHeader, MbFoodListReadonly, MbSuggestionsBoard,
} from "@/components/MbSuggestionBoard";
import MbPhase1Guide from "@/components/MbPhase1Guide";

const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

interface Props {
  clientId: string;
  suggestions: MbSuggestion[];
  foodList: MbFoodListMap;
  /** Raw clients.mb_run. */
  run: unknown;
  /** Whether the practitioner has confirmed (published) the plan. */
  confirmed: boolean;
  clientName: string;
  enrichedLimits?: MbFoodLimit[];
  legacyLimits?: Record<string, number>;
  /** clients.phase2_strict_started_at — anchors the 7-day cap window. */
  anchor?: string | null;
  /** Client's current MB phase — labels the food list. */
  phase?: string | null;
  /** Full client row — used to show the separate Phase 3 additional foods. */
  client?: Record<string, unknown> | null;
}

/**
 * Read-only mirror of the MB client's "My Plan" tab, for the practitioner.
 * Same layout as MB Plan Setup: before the client locks a colour, all three
 * suggestions side by side; after, just the suggestion they picked, once —
 * with any cap-forced day swap called out. No controls, no writes.
 */
export function MbPlanMirror({
  clientId, suggestions, foodList, run: rawRun, confirmed, clientName,
  enrichedLimits = [], legacyLimits = {}, anchor = null, phase = null, client = null,
}: Props) {
  const firstName = clientName.split(" ")[0] || "This client";
  const [consumed, setConsumed] = useState<CapConsumed>({});

  const run = useMemo(() => parseMbRun(rawRun), [rawRun]);
  const start = run.started_on ?? todayISO();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("mb_cap_ledger")
        .select("week_start, food, qty, day")
        .eq("client_id", clientId);
      if (cancelled) return;
      const dates = new Set(run.colour ? runDates(run, RUN_DAYS) : []);
      const out: CapConsumed = {};
      for (const r of (data ?? []) as Array<{ week_start: string; food: string; qty: number; day: string }>) {
        if (dates.has(r.day)) continue; // this run's own days aren't "already used"
        const w = (out[r.week_start] = out[r.week_start] ?? {});
        w[r.food] = (w[r.food] ?? 0) + Number(r.qty || 0);
      }
      setConsumed(out);
    })();
    return () => { cancelled = true; };
  }, [clientId, rawRun]);

  const plan = useMemo(
    () => planRunAgainstLedger(run, suggestions, enrichedLimits, legacyLimits, consumed, {
      anchor, runDays: RUN_DAYS, startDate: start,
    }),
    [run, suggestions, enrichedLimits, legacyLimits, consumed, anchor, start],
  );

  const remainingLine = (food: string): string | null => {
    if (!food) return null;
    const cap = weeklyCapFor(food, enrichedLimits, legacyLimits);
    if (cap == null) return null;
    const week = weekWindowFor(anchor, start).week_start;
    const already = consumedFor(food, consumed[week]);
    return `${Math.max(0, cap - already)} of ${cap} left this week`;
  };

  if (phase === "phase1") return <MbPhase1Guide />;

  if (!confirmed || suggestions.length === 0) {
    return (
      <div className="rounded-md border p-6 text-center space-y-2">
        <p className="text-sm font-medium">No live plan yet</p>
        <p className="text-xs text-muted-foreground">
          Build and confirm this client's three colour suggestions in <span className="font-medium">MB Plan Setup</span> (Overview tab).
          Once confirmed, their live plan appears here exactly as they see it.
        </p>
      </div>
    );
  }

  /* ---------------- not picked yet: three suggestions side by side ---------------- */
  if (!run.colour) {
    return (
      <Card className="p-4 space-y-4">
        <div>
          <p className="font-medium">{firstName} hasn't chosen a suggestion yet</p>
          <p className="text-sm text-muted-foreground">
            This is their My Plan view: three suggestions to choose from, locking all meals for {RUN_DAYS} days.
          </p>
        </div>
        <MbSuggestionsBoard suggestions={suggestions} />
        <MbFoodListReadonly foodList={foodList} phase={phase} client={client} />
      </Card>
    );
  }

  /* ---------------- locked run: the picked suggestion, once ---------------- */
  const locked = suggestions.find((s) => s.colour === run.colour);
  const dates = runDates(run, RUN_DAYS);
  const blockFor = (date: string, meal: MealType) =>
    plan.blocks.find((b) => b.date === date && b.meal === meal) ?? null;

  const renderItem = (it: MbPlanItem, picks: Record<string, string>) => {
    const picked = picks[it.id] ?? "";
    const food = capFoodFor(it, picked);
    const remaining = remainingLine(food);
    if (it.category === "fixed") {
      return (
        <div key={it.id} className="text-sm">
          <span className="font-medium">{it.label}</span>
          {fmtQty(it) ? <span className="text-muted-foreground"> · {fmtQty(it)}</span> : null}
          {remaining && (
            <span className="text-xs text-muted-foreground"> · {remaining} (uses {perMealQty(it)})</span>
          )}
        </div>
      );
    }
    const hasOptions = ((foodList[it.category] ?? []).length || (it.options ?? []).length) > 0;
    const altId = vegAltIdFor(it);
    const altPicked = altId ? picks[altId] ?? "" : "";
    return (
      <div key={it.id} className="space-y-0.5">
        <div className="text-sm flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium">{categoryLabel(it.category)}</span>
          {fmtQty(it) && <span className="text-xs text-muted-foreground">{fmtQty(it)}</span>}
          {it.optional && <span className="text-xs text-muted-foreground">(optional)</span>}
          <span aria-hidden className="text-muted-foreground">→</span>
          {picked ? (
            <span>{picked}</span>
          ) : (
            <span className="text-muted-foreground italic">
              {hasOptions ? "Not picked yet" : "No approved foods listed for this group"}
            </span>
          )}
          {remaining && <span className="text-xs text-muted-foreground">· {remaining}</span>}
        </div>
        {altId && altPicked && (
          <div className="text-sm flex flex-wrap items-baseline gap-x-2 pl-3">
            <span className="text-xs text-muted-foreground">Second choice (splits the same amount)</span>
            <span aria-hidden className="text-muted-foreground">→</span>
            <span>{altPicked}</span>
            {remainingLine(altPicked) && (
              <span className="text-xs text-muted-foreground">· {remainingLine(altPicked)}</span>
            )}
          </div>
        )}
      </div>
    );
  };

  /* Days that need calling out: a cap block, or an existing swap. */
  const specialDays = dates.filter((date) =>
    RUN_MEALS.some((m) => !!blockFor(date, m) || !!run.day_overrides[date]?.[m]),
  );

  return (
    <Card className="p-4 space-y-4">
      <div>
        <p className="font-medium flex items-center gap-2">
          <span className={`h-3 w-3 rounded-full ${COLOUR_BAR[run.colour]}`} aria-hidden />
          {locked?.label ?? COLOUR_LABEL[run.colour]}
          {run.confirmed_on && (
            <span className="text-xs font-normal text-muted-foreground">confirmed {run.confirmed_on}</span>
          )}
        </p>
        <p className="text-sm text-muted-foreground">
          Locked for {RUN_DAYS} days{run.started_on ? ` from ${dayLabel(run.started_on)}` : ""}.
          Read-only — this is what {firstName} sees. Edit the plan in MB Plan Setup.
        </p>
      </div>

      {/* One set of picks for the whole run. */}
      <div className="rounded-lg border overflow-hidden">
        <MbColourHeader colour={run.colour} />
        <div className="p-3 grid gap-3">
          {RUN_MEALS.map((meal) => {
            const { items, picks } = resolveRunMeal(run, suggestions, meal);
            return (
              <div key={meal} className="rounded-md border p-2 space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wide">{MEAL_LABEL[meal]}</p>
                {items.length === 0 && <p className="text-sm text-muted-foreground">Not set.</p>}
                {items.map((it) => renderItem(it, picks))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Only days a cap forced off the run colour are shown separately. */}
      {specialDays.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium">Days that changed</p>
          {specialDays.map((date) => (
            <div key={date} className="rounded-lg border p-3 space-y-3">
              <p className="text-sm font-medium">{dayLabel(date)}</p>
              {RUN_MEALS.map((meal) => {
                const block = blockFor(date, meal);
                const override = run.day_overrides[date]?.[meal];
                if (!block && !override) return null;
                const { colour: mealColour, suggestion: s, items, picks, swapped } =
                  resolveDayMeal(run, suggestions, date, meal);
                return (
                  <div key={meal} className="space-y-1.5 border-t pt-2 first:border-t-0 first:pt-0">
                    <p className="text-xs font-semibold uppercase tracking-wide flex items-center gap-2">
                      {MEAL_LABEL[meal]}
                      {swapped && (
                        <span className="inline-flex items-center gap-1 normal-case text-[11px] font-normal text-muted-foreground">
                          <span className={`h-2 w-2 rounded-full ${COLOUR_BAR[mealColour as MbColour]}`} aria-hidden />
                          swapped to {s?.label ?? COLOUR_LABEL[mealColour as MbColour]}
                        </span>
                      )}
                      {block && (
                        <span className="normal-case text-[11px] font-normal text-amber-700 dark:text-amber-400">
                          over cap — {block.food}: needs {block.need}, {block.remaining} left of {block.cap}
                        </span>
                      )}
                    </p>
                    {override && items.map((it) => renderItem(it, picks))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      <MbFoodListReadonly foodList={foodList} phase={phase} client={client} />
    </Card>
  );
}

export default MbPlanMirror;
