import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import type { MealType } from "@/lib/mb-foods";
import type { MbColour, MbFoodLimit, MbPlanItem, MbSuggestion } from "@/lib/mb-plan";
import { capBlocksRun, categoryLabel, type MbFoodListMap } from "@/lib/mb-food-list";
import { RUN_DAYS, RUN_MEALS, emptyRun, parseMbRun, startRun, type MbRun } from "@/lib/mb-run";

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

function fmtQty(it: MbPlanItem): string {
  if (it.unit === "g" && it.qty != null) return `${it.qty}g`;
  if (it.unit === "ml" && it.qty != null) return `${it.qty}ml`;
  if (it.unit === "count" && it.qty != null) return `${it.qty}`;
  return (it.note ?? "").trim();
}

interface Props {
  token: string;
  suggestions: MbSuggestion[];
  foodList: MbFoodListMap;
  enrichedLimits: MbFoodLimit[];
  legacyLimits: Record<string, number>;
  initialRun: unknown;
  onGoHome: () => void;
}

/**
 * Colour-locked run picker for MB clients: choose one suggestion (all three
 * meals lock together), then pick the actual food for each item from the
 * client's Personal Food List. Weekly-capped foods that can't cover the run
 * trigger a whole-meal swap from another colour — never a same-category swap.
 */
export function MbRunPlanner({
  token, suggestions, foodList, enrichedLimits, legacyLimits, initialRun, onGoHome,
}: Props) {
  const [run, setRun] = useState<MbRun>(() => parseMbRun(initialRun));
  const [saving, setSaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);

  const byColour = useMemo(() => {
    const m = new Map<MbColour, MbSuggestion>();
    for (const s of suggestions) m.set(s.colour, s);
    return m;
  }, [suggestions]);

  const save = useCallback(async (next: MbRun) => {
    setSaving(true);
    const { error } = await supabase.functions.invoke("mb-run", {
      body: { token, action: "save", run: next },
    });
    setSaving(false);
    if (error) toast.error("Couldn't save your choice — please try again.");
  }, [token]);

  useEffect(() => {
    if (!dirty.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(run), 500);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [run, save]);

  const mutate = (fn: (r: MbRun) => MbRun) => {
    dirty.current = true;
    setRun((r) => fn(structuredClone(r)));
  };

  const lockColour = (colour: MbColour) => mutate(() => startRun(colour));
  const clearRun = () => mutate(() => emptyRun());

  const setPick = (meal: MealType, itemId: string, food: string) =>
    mutate((r) => {
      const rm = r.meals[meal];
      if (rm) rm.picks[itemId] = food;
      return r;
    });

  const swapMealColour = (meal: MealType, colour: MbColour) =>
    mutate((r) => {
      r.meals[meal] = { colour, picks: {} };
      return r;
    });

  const pickableItems = (s: MbSuggestion | undefined, meal: MealType): MbPlanItem[] =>
    (s?.meals?.[meal]?.items ?? []).filter((i) => i.category !== "fixed");

  const mealComplete = (meal: MealType): boolean => {
    const rm = run.meals[meal];
    if (!rm) return false;
    const s = byColour.get(rm.colour);
    return pickableItems(s, meal)
      .filter((i) => !i.optional)
      .every((i) => !!rm.picks[i.id]);
  };

  const runReady = !!run.colour && RUN_MEALS.every((m) => mealComplete(m));

  /* ---------------- colour choice ---------------- */
  if (!run.colour) {
    return (
      <Card className="p-4 space-y-4">
        <div>
          <p className="font-medium">Choose your suggestion for the next {RUN_DAYS} days</p>
          <p className="text-sm text-muted-foreground">
            Tap any meal to choose that suggestion. All three meals lock together — you follow one colour for the whole run.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {suggestions.map((s) => (
            <button
              key={s.colour}
              type="button"
              onClick={() => lockColour(s.colour)}
              className="text-left rounded-lg border p-3 space-y-2 hover:border-primary hover:bg-primary/5 transition-colors"
            >
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
            </button>
          ))}
        </div>
      </Card>
    );
  }

  /* ---------------- locked run ---------------- */
  const locked = byColour.get(run.colour);

  return (
    <Card className="p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium flex items-center gap-2">
            <span className={`h-3 w-3 rounded-full ${COLOUR_DOT[run.colour]}`} aria-hidden />
            {locked?.label ?? "Your suggestion"}
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </p>
          <p className="text-sm text-muted-foreground">
            Locked for {RUN_DAYS} days. Tap each food group to choose what you'll eat.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={clearRun}>Change suggestion</Button>
      </div>

      {RUN_MEALS.map((meal) => {
        const rm = run.meals[meal];
        const mealColour = rm?.colour ?? run.colour!;
        const s = byColour.get(mealColour);
        const items = s?.meals?.[meal]?.items ?? [];
        const swapped = mealColour !== run.colour;
        return (
          <div key={meal} className="rounded-lg border p-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide flex items-center gap-2">
                {MEAL_LABEL[meal]}
                {swapped && (
                  <span className="inline-flex items-center gap-1 normal-case text-[11px] font-normal text-muted-foreground">
                    <span className={`h-2 w-2 rounded-full ${COLOUR_DOT[mealColour]}`} aria-hidden />
                    from {s?.label ?? "another suggestion"}
                  </span>
                )}
                {mealComplete(meal) && <Check className="h-3.5 w-3.5 text-emerald-600" />}
              </p>
              {swapped && (
                <Button
                  variant="ghost" size="sm" className="h-7 text-xs"
                  onClick={() => swapMealColour(meal, run.colour!)}
                >
                  Back to {locked?.label ?? "my suggestion"}
                </Button>
              )}
            </div>

            {items.length === 0 && <p className="text-sm text-muted-foreground">Not set.</p>}

            {items.map((it) => {
              if (it.category === "fixed") {
                return (
                  <div key={it.id} className="text-sm">
                    <span className="font-medium">{it.label}</span>
                    {fmtQty(it) ? <span className="text-muted-foreground"> · {fmtQty(it)}</span> : null}
                  </div>
                );
              }
              const options = (foodList[it.category] ?? []).length
                ? foodList[it.category]
                : (it.options ?? []);
              const picked = rm?.picks[it.id] ?? "";
              const perMeal = it.unit === "count" && it.qty ? it.qty : 1;
              const conflict = picked
                ? capBlocksRun(picked, perMeal, RUN_DAYS, enrichedLimits, legacyLimits)
                : { blocked: false, cap: null as number | null, needed: 0 };
              return (
                <div key={it.id} className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{categoryLabel(it.category)}</span>
                    {fmtQty(it) && <span className="text-xs text-muted-foreground">{fmtQty(it)}</span>}
                    {it.optional && <span className="text-xs text-muted-foreground">(optional)</span>}
                  </div>
                  {options.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No approved foods listed for this group yet — ask your practitioner.
                    </p>
                  ) : (
                    <Select value={picked} onValueChange={(v) => setPick(meal, it.id, v)}>
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder={`Choose your ${categoryLabel(it.category).toLowerCase()}`} />
                      </SelectTrigger>
                      <SelectContent>
                        {options.map((f) => (
                          <SelectItem key={f} value={f}>{f}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}

                  {conflict.blocked && (
                    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 space-y-2">
                      <p className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        {picked} is limited to {conflict.cap} per week, so it can't cover all {RUN_DAYS} days
                        of this run. For one of those days, swap this whole meal to another suggestion.
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-muted-foreground">Swap this meal to</span>
                        <Select value="" onValueChange={(v) => swapMealColour(meal, v as MbColour)}>
                          <SelectTrigger className="h-8 w-48 text-xs">
                            <SelectValue placeholder="Choose a suggestion" />
                          </SelectTrigger>
                          <SelectContent>
                            {suggestions
                              .filter((o) => o.colour !== mealColour)
                              .map((o) => (
                                <SelectItem key={o.colour} value={o.colour}>{o.label}</SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}

      {runReady ? (
        <div className="rounded-md border border-primary/40 bg-primary/5 p-3 space-y-2">
          <p className="text-sm font-medium">Your run is ready</p>
          <p className="text-sm text-muted-foreground">
            All three meals are picked. Head to Home to generate recipes for what you chose.
          </p>
          <Button size="sm" onClick={onGoHome}>Go to Home</Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Pick a food for every group above to finish your run.
        </p>
      )}
    </Card>
  );
}

export default MbRunPlanner;
