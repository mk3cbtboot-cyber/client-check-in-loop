import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import type { MealType } from "@/lib/mb-foods";
import type { MbColour, MbFoodLimit, MbSuggestion } from "@/lib/mb-plan";
import {
  capFoodFor, categoryLabel, consumedFor, perMealQty, planRunAgainstLedger,
  weekWindowFor, weeklyCapFor, type CapConsumed, type MbFoodListMap,
} from "@/lib/mb-food-list";
import { RUN_DAYS, RUN_MEALS, fmtQty, parseMbRun, resolveDayMeal, runDates, todayISO } from "@/lib/mb-run";

const MEAL_LABEL: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
};
const COLOUR_DOT: Record<MbColour, string> = {
  blue: "bg-sky-500",
  green: "bg-emerald-500",
  orange: "bg-amber-500",
};

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
}

/**
 * Read-only mirror of the MB client's "My Plan" tab, for the practitioner.
 * Same day layout the client sees — one set of picks across the run, per-day
 * swap badges where a cap forced a change, and the week's remaining allowance
 * for capped foods. No controls, no writes.
 */
export function MbPlanMirror({
  clientId, suggestions, foodList, run: rawRun, confirmed, clientName,
  enrichedLimits = [], legacyLimits = {}, anchor = null,
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

  /* ---------------- not picked yet: three cards ---------------- */
  if (!run.colour) {
    return (
      <Card className="p-4 space-y-4">
        <div>
          <p className="font-medium">{firstName} hasn't chosen a suggestion yet</p>
          <p className="text-sm text-muted-foreground">
            This is their My Plan view: three suggestions to choose from, locking all meals for {RUN_DAYS} days.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {suggestions.map((s) => (
            <div key={s.colour} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className={`h-3 w-3 rounded-full ${COLOUR_DOT[s.colour]}`} aria-hidden />
                <span className="font-medium">{s.label}</span>
              </div>
              {RUN_MEALS.map((m) => (
                <div key={m} className="text-sm">
                  <p className="text-xs uppercase text-muted-foreground">{MEAL_LABEL[m]}</p>
                  <ul className="list-disc pl-5">
                    {(s.meals[m]?.items ?? []).map((it) => (
                      <li key={it.id}>
                        {it.category === "fixed" ? it.label : categoryLabel(it.category)}
                        {fmtQty(it) ? ` · ${fmtQty(it)}` : ""}
                      </li>
                    ))}
                    {(s.meals[m]?.items ?? []).length === 0 && (
                      <li className="text-muted-foreground">Not set</li>
                    )}
                  </ul>
                </div>
              ))}
            </div>
          ))}
        </div>
      </Card>
    );
  }

  /* ---------------- locked run ---------------- */
  const locked = suggestions.find((s) => s.colour === run.colour);
  const dates = runDates(run, RUN_DAYS);
  const blockFor = (date: string, meal: MealType) =>
    plan.blocks.find((b) => b.date === date && b.meal === meal) ?? null;

  return (
    <Card className="p-4 space-y-4">
      <div>
        <p className="font-medium flex items-center gap-2">
          <span className={`h-3 w-3 rounded-full ${COLOUR_DOT[run.colour]}`} aria-hidden />
          {locked?.label ?? "Their suggestion"}
          {run.confirmed_on && (
            <span className="text-xs font-normal text-muted-foreground">confirmed {run.confirmed_on}</span>
          )}
        </p>
        <p className="text-sm text-muted-foreground">
          Locked for {RUN_DAYS} days{run.started_on ? ` from ${dayLabel(run.started_on)}` : ""}.
          Read-only — this is what {firstName} sees. Edit the plan in MB Plan Setup.
        </p>
      </div>

      {dates.map((date) => (
        <div key={date} className="rounded-lg border p-3 space-y-3">
          <p className="text-sm font-medium">{dayLabel(date)}</p>
          {RUN_MEALS.map((meal) => {
            const { colour: mealColour, suggestion: s, items, picks, swapped } =
              resolveDayMeal(run, suggestions, date, meal);
            const block = blockFor(date, meal);
            return (
              <div key={meal} className="space-y-1.5 border-t pt-2 first:border-t-0 first:pt-0">
                <p className="text-xs font-semibold uppercase tracking-wide flex items-center gap-2">
                  {MEAL_LABEL[meal]}
                  {swapped && (
                    <span className="inline-flex items-center gap-1 normal-case text-[11px] font-normal text-muted-foreground">
                      <span className={`h-2 w-2 rounded-full ${COLOUR_DOT[mealColour]}`} aria-hidden />
                      swapped to {s?.label ?? "another suggestion"}
                    </span>
                  )}
                  {block && (
                    <span className="normal-case text-[11px] font-normal text-amber-700 dark:text-amber-400">
                      over cap — {block.food}: needs {block.need}, {block.remaining} left of {block.cap}
                    </span>
                  )}
                </p>

                {items.length === 0 && <p className="text-sm text-muted-foreground">Not set.</p>}

                {items.map((it) => {
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
                  return (
                    <div key={it.id} className="text-sm flex flex-wrap items-baseline gap-x-2">
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
                  );
                })}
              </div>
            );
          })}
        </div>
      ))}
    </Card>
  );
}

export default MbPlanMirror;
