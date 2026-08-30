import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import type { MealType } from "@/lib/mb-foods";
import { vegAltIdFor } from "@/lib/mb-plan";
import type { MbColour, MbFoodLimit, MbPlanItem, MbSuggestion } from "@/lib/mb-plan";
import {
  capFoodFor, categoryLabel, consumedFor, describeBlock, perMealQty,
  planRunAgainstLedger, weekWindowFor, weeklyCapFor,
  type CapConsumed, type MbFoodListMap,
} from "@/lib/mb-food-list";
import {
  RUN_DAYS, RUN_MEALS, clearDayMeal, emptyRun, fmtQty, parseMbRun, resolveDayMeal,
  resolveRunMeal, runDates, startRun, swapDayMeal, todayISO, type MbRun,
} from "@/lib/mb-run";
import { MbFoodListReadonly, MbSuggestionsBoard } from "@/components/MbSuggestionBoard";

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
  token: string;
  suggestions: MbSuggestion[];
  foodList: MbFoodListMap;
  enrichedLimits: MbFoodLimit[];
  legacyLimits: Record<string, number>;
  initialRun: unknown;
  onGoHome: () => void;
  /** Lifts the server-confirmed run into the parent so Home sees it immediately. */
  onRunChanged?: (run: unknown) => void;

  /** Client's current MB phase — labels the food list. */
  phase?: string | null;
  /** Full client row — used to show the separate Phase 3 additional foods. */
  client?: Record<string, unknown> | null;
}

/**
 * Colour-locked run picker for MB clients.
 *
 * The model is "pick once, applies to all three days": one colour, one set of
 * food picks. A day only becomes independently editable when a weekly cap
 * blocks that meal on that day — the sanctioned remedy is swapping that one
 * meal to one of the other two suggestions, which is then re-checked against
 * the same shared evaluator the server runs on confirm.
 */
export function MbRunPlanner({
  token, suggestions, foodList, enrichedLimits, legacyLimits, initialRun, onGoHome,
  onRunChanged, phase = null,
  client = null,
}: Props) {
  const [run, setRun] = useState<MbRun>(() => parseMbRun(initialRun));
  const [consumed, setConsumed] = useState<CapConsumed>({});
  const [anchor, setAnchor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);

  const byColour = useMemo(() => {
    const m = new Map<MbColour, MbSuggestion>();
    for (const s of suggestions) m.set(s.colour, s);
    return m;
  }, [suggestions]);

  /* Ledger history — the client's already-committed consumption this week. */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.functions.invoke("mb-run", { body: { token, action: "get" } });
      if (cancelled || !data) return;
      const payload = data as { consumed?: CapConsumed; anchor?: string | null };
      setConsumed(payload.consumed ?? {});
      setAnchor(payload.anchor ?? null);
    })();
    return () => { cancelled = true; };
  }, [token]);

  const save = useCallback(async (next: MbRun) => {
    setSaving(true);
    const { data, error } = await supabase.functions.invoke("mb-run", {
      body: { token, action: "save", run: next },
    });
    setSaving(false);
    if (error) return toast.error("Couldn't save your choice — please try again.");
    // A draft save always clears confirmation server-side — keep the parent in sync.
    onRunChanged?.((data as { run?: unknown } | null)?.run ?? { ...next, confirmed_on: null });
  }, [token, onRunChanged]);

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

  /** Base pick — fills all three days. */
  const setPick = (meal: MealType, itemId: string, food: string) =>
    mutate((r) => {
      const rm = r.meals[meal];
      if (rm) rm.picks[itemId] = food;
      r.confirmed_on = null;
      return r;
    });

  /** Pick inside a swapped day's meal — that day only. */
  const setDayPick = (date: string, meal: MealType, itemId: string, food: string) =>
    mutate((r) => {
      const dm = r.day_overrides[date]?.[meal];
      if (dm) dm.picks[itemId] = food;
      r.confirmed_on = null;
      return r;
    });

  const swapDay = (date: string, meal: MealType, colour: MbColour) =>
    mutate((r) => swapDayMeal(r, date, meal, colour));
  const unswapDay = (date: string, meal: MealType) =>
    mutate((r) => clearDayMeal(r, date, meal));

  const pickable = (items: MbPlanItem[]) => items.filter((i) => i.category !== "fixed");

  const optionsFor = (it: MbPlanItem): string[] => {
    const fromList = foodList[it.category] ?? [];
    if (fromList.length) return fromList;
    if (it.options?.length) return it.options;
    // Last resort: the MB standard list for this group (e.g. a Sunflower Seeds
    // slot on a client whose practitioner never filled that column in).
    return (MB_FOODS as Record<string, string[]>)[it.category] ?? [];
  };

  const start = run.started_on ?? todayISO();
  const dates = useMemo(() => (run.colour ? runDates(run, RUN_DAYS) : []), [run]);

  /* Same shared evaluator the mb-run edge function runs on confirm. */
  const plan = useMemo(
    () => planRunAgainstLedger(run, suggestions, enrichedLimits, legacyLimits, consumed, {
      anchor, runDays: RUN_DAYS, startDate: start,
    }),
    [run, suggestions, enrichedLimits, legacyLimits, consumed, anchor, start],
  );

  const blockFor = (date: string, meal: MealType) =>
    plan.blocks.find((b) => b.date === date && b.meal === meal) ?? null;

  /** "x left of your weekly y" for a capped food, in the run's first window. */
  const remainingLine = (food: string): string | null => {
    if (!food) return null;
    const cap = weeklyCapFor(food, enrichedLimits, legacyLimits);
    if (cap == null) return null;
    const week = weekWindowFor(anchor, start).week_start;
    const already = consumedFor(food, consumed[week]);
    return `${Math.max(0, cap - already)} of ${cap} left this week`;
  };

  const mealPicksComplete = (items: MbPlanItem[], picks: Record<string, string>) =>
    pickable(items).filter((i) => !i.optional).every((i) => !!picks[i.id]);

  const baseComplete = (meal: MealType): boolean => {
    const { items, picks } = resolveRunMeal(run, suggestions, meal);
    return mealPicksComplete(items, picks);
  };

  const allPicked = useMemo(() => {
    if (!run.colour) return false;
    if (!RUN_MEALS.every((m) => baseComplete(m))) return false;
    for (const date of dates) {
      for (const meal of RUN_MEALS) {
        if (!run.day_overrides[date]?.[meal]) continue;
        const { items, picks } = resolveDayMeal(run, suggestions, date, meal);
        if (!mealPicksComplete(items, picks)) return false;
      }
    }
    return true;
  }, [run, suggestions, dates]);

  const runReady = allPicked && plan.blocks.length === 0;

  const confirmRun = async () => {
    setConfirming(true);
    if (timer.current) clearTimeout(timer.current);
    const { data, error } = await supabase.functions.invoke("mb-run", {
      body: { token, action: "confirm", run },
    });
    setConfirming(false);
    const payload = (data ?? {}) as {
      error?: string; message?: string; run?: unknown; consumed?: CapConsumed;
    };
    if (error || payload.error) {
      setServerError(
        payload.message ??
          (payload.error === "cap_exceeded"
            ? "These meals exceed a weekly food cap."
            : "Couldn't confirm your meals — please try again."),
      );
      toast.error(payload.message ?? "Couldn't confirm your meals.");
      return;
    }
    setServerError(null);
    dirty.current = false;
    setRun(parseMbRun(payload.run));
    if (payload.consumed) setConsumed(payload.consumed);
    onRunChanged?.(payload.run);
    toast.success("Meals confirmed.");
    onGoHome();
  };

  /* ---------------- colour choice ---------------- */
  if (!run.colour) {
    return (
      <Card className="p-4 space-y-4">
        <div>
          <p className="font-medium">Choose your suggestion for the next {RUN_DAYS} days</p>
          <p className="text-sm text-muted-foreground">
            Tap any meal to choose that suggestion. All three meals lock together — you follow one colour for all 3 days.
          </p>
        </div>
        <MbSuggestionsBoard suggestions={suggestions} onPick={lockColour} />
        <MbFoodListReadonly foodList={foodList} phase={phase} client={client} />

      </Card>
    );
  }

  /* ---------------- locked run ---------------- */
  const locked = byColour.get(run.colour);

  /** Item row renderer shared by the base picks and any swapped day. */
  const renderItem = (
    it: MbPlanItem,
    picks: Record<string, string>,
    onPick: (itemId: string, food: string) => void,
  ) => {
    const isFixed = it.category === "fixed";
    const picked = picks[it.id] ?? "";
    const food = capFoodFor(it, picked);
    const remaining = remainingLine(food);
    const per = perMealQty(it);

    if (isFixed) {
      return (
        <div key={it.id} className="text-sm space-y-0.5">
          <div>
            <span className="font-medium">{it.label}</span>
            {fmtQty(it) ? <span className="text-muted-foreground"> · {fmtQty(it)}</span> : null}
          </div>
          {remaining && (
            <p className="text-xs text-muted-foreground">{remaining} · this meal uses {per}</p>
          )}
        </div>
      );
    }

    const options = optionsFor(it);
    // Optional second vegetable: a variety split of the same allowance — the
    // gram amount above is shared 50/50, so it never adds a second portion.
    const altId = vegAltIdFor(it);
    const altPicked = altId ? picks[altId] ?? "" : "";
    const altRemaining = altId ? remainingLine(altPicked) : null;
    return (
      <div key={it.id} className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{it.label || categoryLabel(it.category)}</span>
          {fmtQty(it) && <span className="text-xs text-muted-foreground">{fmtQty(it)}</span>}
          {it.optional && <span className="text-xs text-muted-foreground">(optional)</span>}
        </div>
        {options.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No approved foods listed for this group yet — ask your practitioner.
          </p>
        ) : (
          <Select value={picked} onValueChange={(v) => onPick(it.id, v)}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder={`Choose your ${(it.label || categoryLabel(it.category)).toLowerCase()}`} />
            </SelectTrigger>
            <SelectContent>
              {options.map((f) => (
                <SelectItem key={f} value={f}>{f}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {remaining && <p className="text-xs text-muted-foreground">{remaining}</p>}

        {altId && options.length > 0 && (
          <div className="space-y-1 pl-3 border-l">
            <p className="text-xs text-muted-foreground">
              Second {(it.label || categoryLabel(it.category)).toLowerCase()} (optional) — splits the same
              {fmtQty(it) ? ` ${fmtQty(it)}` : ""} amount, it isn't an extra portion.
            </p>
            <Select value={altPicked} onValueChange={(v) => onPick(altId, v)}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Add a second choice (optional)" />
              </SelectTrigger>
              <SelectContent>
                {options.filter((f) => f !== picked).map((f) => (
                  <SelectItem key={f} value={f}>{f}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {altRemaining && <p className="text-xs text-muted-foreground">{altRemaining}</p>}
          </div>
        )}
      </div>
    );
  };

  const swapSelect = (date: string, meal: MealType, currentColour: MbColour) => (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">Swap this meal to</span>
      <Select value="" onValueChange={(v) => swapDay(date, meal, v as MbColour)}>
        <SelectTrigger className="h-8 w-48 text-xs">
          <SelectValue placeholder="Choose a suggestion" />
        </SelectTrigger>
        <SelectContent>
          {suggestions.filter((o) => o.colour !== currentColour).map((o) => (
            <SelectItem key={o.colour} value={o.colour}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  /* Days that need their own card: a cap block, or an existing swap. */
  const dayNeedsCard = (date: string) =>
    RUN_MEALS.some((m) => !!blockFor(date, m) || !!run.day_overrides[date]?.[m]);
  const specialDays = dates.filter(dayNeedsCard);

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
            Locked for {RUN_DAYS} days. Pick your foods once — they apply to all {RUN_DAYS} days.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={clearRun}>Change suggestion</Button>
      </div>

      {/* One set of picks for the whole run. */}
      {RUN_MEALS.map((meal) => {
        const { items, picks } = resolveRunMeal(run, suggestions, meal);
        return (
          <div key={meal} className="rounded-lg border p-3 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide flex items-center gap-2">
              {MEAL_LABEL[meal]}
              {baseComplete(meal) && <Check className="h-3.5 w-3.5 text-emerald-600" />}
            </p>
            {items.length === 0 && <p className="text-sm text-muted-foreground">Not set.</p>}
            {items.map((it) => renderItem(it, picks, (id, v) => setPick(meal, id, v)))}
          </div>
        );
      })}

      {/* Only days a cap forced off the run colour get their own form. */}
      {specialDays.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium">Days that need a change</p>
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
                  <div key={meal} className="space-y-2 border-t pt-2 first:border-t-0 first:pt-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wide flex items-center gap-2">
                        {MEAL_LABEL[meal]}
                        {swapped && (
                          <span className="inline-flex items-center gap-1 normal-case text-[11px] font-normal text-muted-foreground">
                            <span className={`h-2 w-2 rounded-full ${COLOUR_DOT[mealColour]}`} aria-hidden />
                            {s?.label ?? "another suggestion"}
                          </span>
                        )}
                      </p>
                      {override && (
                        <Button variant="ghost" size="sm" className="h-7 text-xs"
                          onClick={() => unswapDay(date, meal)}>
                          Back to {locked?.label ?? "my suggestion"}
                        </Button>
                      )}
                    </div>

                    {block && (
                      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 space-y-2">
                        <p className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
                          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                          {block.food}: this meal needs {block.need}, but you have {block.remaining} left
                          of your weekly {block.cap}. Swap this meal on {dayLabel(date)} to another suggestion.
                        </p>
                        {swapSelect(date, meal, mealColour)}
                      </div>
                    )}

                    {override && items.map((it) =>
                      renderItem(it, picks, (id, v) => setDayPick(date, meal, id, v)),
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {plan.blocks.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 space-y-1">
          <p className="text-sm font-medium text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4" /> These meals go over a weekly food cap
          </p>
          <ul className="text-xs text-amber-700 dark:text-amber-400 list-disc pl-5">
            {plan.blocks.map((b) => (
              <li key={`${b.date}-${b.meal}`}>{describeBlock(b)}</li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Swap the affected meal on those days to another suggestion — then you can confirm your meals.
          </p>
        </div>
      )}

      {serverError && <p className="text-xs text-destructive">{serverError}</p>}

      {run.confirmed_on ? (
        <div className="rounded-md border border-primary/40 bg-primary/5 p-3 space-y-2">
          <p className="text-sm font-medium flex items-center gap-1.5">
            <Check className="h-4 w-4" /> Your meals are confirmed through {dayLabel(dates[dates.length - 1] ?? start)}.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={onGoHome}>Go to Home</Button>
            <Button size="sm" variant="outline" onClick={clearRun}>Choose new meals</Button>
          </div>
        </div>
      ) : runReady ? (
        <div className="rounded-md border border-primary/40 bg-primary/5 p-3 space-y-2">
          <p className="text-sm font-medium">Your 3 days of meals are ready</p>
          <p className="text-sm text-muted-foreground">
            All your meals for 3 days are selected and within your caps. Confirm your meals to start.
          </p>
          <Button size="sm" onClick={() => void confirmRun()} disabled={confirming}>
            {confirming && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Confirm Meals
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <Button size="sm" disabled>Confirm Meals</Button>
          <p className="text-xs text-muted-foreground">
            {allPicked
              ? "Resolve the cap conflicts above to confirm your meals."
              : "Pick a food for every group above to finish your meals."}
          </p>
        </div>
      )}

      <MbFoodListReadonly foodList={foodList} phase={phase} client={client} />
    </Card>
  );
}

export default MbRunPlanner;
