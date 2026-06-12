import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { Check, Share2, ShoppingBag, Lock, AlertTriangle } from "lucide-react";
import { MB_FOODS, MB_OPTIONS, type MealType, type OptionDef } from "@/lib/mb-foods";
import { checkMealLimits, daySplitLabel, type FoodLimits } from "@/lib/food-limits";

type SelectionMap = Record<string, string>;

interface WeeklyPlan {
  id: string;
  week_start_date: string;
  breakfast_meal_id: number | null;
  lunch_meal_id: number | null;
  dinner_meal_id: number | null;
  breakfast_selections: SelectionMap;
  lunch_selections: SelectionMap;
  dinner_selections: SelectionMap;
  breakfast_meal_id_alt: number | null;
  lunch_meal_id_alt: number | null;
  dinner_meal_id_alt: number | null;
  breakfast_selections_alt: SelectionMap;
  lunch_selections_alt: SelectionMap;
  dinner_selections_alt: SelectionMap;
  breakfast_primary_days: number;
  lunch_primary_days: number;
  dinner_primary_days: number;
  confirmed_at: string | null;
}

interface Props {
  token: string;
  filteredSources: (sources: (keyof typeof MB_FOODS)[]) => string[];
  weeklyFoodLimits?: FoodLimits | null;
  eggsMaxPerWeek?: number | null;
  onPlanChanged?: (plan: WeeklyPlan | null) => void;
  oilAllowed?: boolean;
}

const MEALS: MealType[] = ["breakfast", "lunch", "dinner"];

const OIL_COMPONENT = {
  key: "oil",
  label: "Oil (optional)",
  qty: "1 tbsp",
  sources: ["oils"] as (keyof typeof MB_FOODS)[],
  optional: true as const,
};

function withOil(opt: OptionDef, oilAllowed: boolean): OptionDef {
  if (!oilAllowed) return opt;
  if (opt.components.some((c) => c.key === "oil")) return opt;
  return { ...opt, components: [...opt.components, OIL_COMPONENT] };
}


function parseGrams(qty: string): number | null {
  const m = qty.match(/(\d+(?:\.\d+)?)\s*g\b/i);
  return m ? parseFloat(m[1]) : null;
}
function parseMillilitres(qty: string): number | null {
  const m = qty.match(/(\d+(?:\.\d+)?)\s*ml\b/i);
  return m ? parseFloat(m[1]) : null;
}
function parseTrailingUnit(name: string): { base: string; qtyText: string | null } {
  const m = name.match(/^(.*)\s*\(([^)]+)\)\s*$/);
  if (m) return { base: m[1].trim(), qtyText: m[2].trim() };
  return { base: name, qtyText: null };
}

function categoryForSources(sources: (keyof typeof MB_FOODS)[]): string {
  const s = new Set(sources);
  if (s.has("fruit")) return "Produce — Fruit";
  if (s.has("vegetables") || s.has("vegLettuce")) return "Produce — Vegetables";
  if (s.has("fish") || s.has("seafood") || s.has("poultry") || s.has("meat")) return "Protein / Meat & Fish";
  if (s.has("cheese") || s.has("yogurt") || s.has("milkProducts")) return "Dairy";
  if (s.has("bread") || s.has("starch") || s.has("legumes")) return "Pantry / Dry Goods";
  return "Other";
}

export default function MealPlanner({ token, filteredSources, weeklyFoodLimits, eggsMaxPerWeek = null, onPlanChanged, oilAllowed = false }: Props) {
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  const [weekStart, setWeekStart] = useState<string>("");
  const [picker, setPicker] = useState<{ slot: "primary" | "alt"; meal: MealType; componentKey: string; label: string; items: string[] } | null>(null);
  const [showShopping, setShowShopping] = useState(false);
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [acks, setAcks] = useState<Array<{ food_name: string }>>([]);
  const [eggConfirm, setEggConfirm] = useState<{ meal: MealType; slot: "primary" | "alt"; optId: number; eggsInMeal: number; eggsPlanned: number } | null>(null);

  const normalizeFood = (s: string) => s.trim().toLowerCase();
  const isAcknowledged = (food: string) => acks.some((a) => normalizeFood(a.food_name) === normalizeFood(food));

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("weekly-meal-plan", { body: { token, action: "get" } });
      if (error) throw error;
      setPlan(data?.plan ?? null);
      setWeekStart(data?.week_start_date ?? "");
      setAcks(data?.acknowledgements ?? []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [token]);

  const acknowledge = async (food: string, limit: number, perServing: number) => {
    try {
      const { data, error } = await supabase.functions.invoke("weekly-meal-plan", {
        body: { token, action: "acknowledge", ack_food_name: food, ack_limit: limit, ack_per_serving_qty: perServing },
      });
      if (error) throw error;
      setAcks(data?.acknowledgements ?? []);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save acknowledgement");
    }
  };


  const sel = (m: MealType, slot: "primary" | "alt"): SelectionMap => {
    if (!plan) return {};
    const key = slot === "primary" ? `${m}_selections` : `${m}_selections_alt`;
    return ((plan as any)[key] as SelectionMap) || {};
  };
  const mealIdFor = (m: MealType, slot: "primary" | "alt"): number | null => {
    if (!plan) return null;
    const key = slot === "primary" ? `${m}_meal_id` : `${m}_meal_id_alt`;
    return ((plan as any)[key] as number | null) ?? null;
  };
  const primaryDaysFor = (m: MealType): number => plan ? ((plan as any)[`${m}_primary_days`] as number ?? 7) : 7;

  const selectedOption = (m: MealType, slot: "primary" | "alt"): OptionDef | null => {
    const id = mealIdFor(m, slot);
    if (!id) return null;
    const base = MB_OPTIONS[m].find((o) => o.id === id) ?? null;
    return base ? withOil(base, oilAllowed) : null;
  };


  const limitCheck = (m: MealType) => checkMealLimits(selectedOption(m, "primary"), sel(m, "primary"), weeklyFoodLimits ?? null);

  const isOptionComplete = (opt: OptionDef | null, s: SelectionMap): boolean => {
    if (!opt) return false;
    return opt.components.filter((c) => !c.optional).every((c) => !!s[c.key]);
  };

  const isMealComplete = (m: MealType): boolean => {
    const primaryOpt = selectedOption(m, "primary");
    if (!isOptionComplete(primaryOpt, sel(m, "primary"))) return false;
    const lc = limitCheck(m);
    if (!lc.limited) return true;
    // require ack for every limited reason
    if (!lc.reasons.every((r) => isAcknowledged(r.food))) return false;
    const altOpt = selectedOption(m, "alt");
    if (!altOpt) return false;
    const altLc = checkMealLimits(altOpt, sel(m, "alt"), weeklyFoodLimits ?? null);
    if (altLc.maxDays < 7 - lc.maxDays) return false;
    return isOptionComplete(altOpt, sel(m, "alt"));
  };

  const allComplete = MEALS.every(isMealComplete);
  const confirmed = !!plan?.confirmed_at;

  const persist = async (patch: Partial<WeeklyPlan>) => {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { token, action: "save" };
      for (const m of MEALS) {
        body[`${m}_meal_id`] = patch[`${m}_meal_id` as const] ?? mealIdFor(m, "primary");
        body[`${m}_selections`] = patch[`${m}_selections` as const] ?? sel(m, "primary");
        body[`${m}_meal_id_alt`] = patch[`${m}_meal_id_alt` as const] ?? mealIdFor(m, "alt");
        body[`${m}_selections_alt`] = patch[`${m}_selections_alt` as const] ?? sel(m, "alt");
        body[`${m}_primary_days`] = patch[`${m}_primary_days` as const] ?? primaryDaysFor(m);
      }
      const { data, error } = await supabase.functions.invoke("weekly-meal-plan", { body });
      if (error) throw error;
      if (data?.plan) {
        setPlan(data.plan);
        onPlanChanged?.(data.plan);
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const chooseOption = async (m: MealType, slot: "primary" | "alt", optId: number) => {
    if (confirmed) return;
    const current = mealIdFor(m, slot);
    const toggling = current === optId;
    const next: Partial<WeeklyPlan> = {};
    if (slot === "primary") {
      next[`${m}_meal_id` as const] = toggling ? null : (optId as any);
      next[`${m}_selections` as const] = {} as any;
      // resetting primary clears alt too
      next[`${m}_meal_id_alt` as const] = null as any;
      next[`${m}_selections_alt` as const] = {} as any;
      next[`${m}_primary_days` as const] = 7 as any;
    } else {
      next[`${m}_meal_id_alt` as const] = toggling ? null : (optId as any);
      next[`${m}_selections_alt` as const] = {} as any;
    }
    await persist(next);
  };

  const openPicker = (slot: "primary" | "alt", m: MealType, c: { key: string; label: string; sources: (keyof typeof MB_FOODS)[] }) => {
    if (confirmed) return;
    setPicker({ slot, meal: m, componentKey: c.key, label: c.label, items: filteredSources(c.sources) });
  };

  const pickItem = async (food: string) => {
    if (!picker) return;
    const m = picker.meal;
    const cur = sel(m, picker.slot);
    const next = { ...cur, [picker.componentKey]: food };
    setPicker(null);
    const patch: Partial<WeeklyPlan> = {};
    const key = picker.slot === "primary" ? `${m}_selections` : `${m}_selections_alt`;
    (patch as any)[key] = next;
    // when primary selection changes, recompute limit & primary_days
    if (picker.slot === "primary") {
      const opt = selectedOption(m, "primary");
      const lc = checkMealLimits(opt, next, weeklyFoodLimits ?? null);
      (patch as any)[`${m}_primary_days`] = lc.limited ? lc.maxDays : 7;
      if (!lc.limited) {
        (patch as any)[`${m}_meal_id_alt`] = null;
        (patch as any)[`${m}_selections_alt`] = {};
      }
    }
    await persist(patch);
  };

  const confirm = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("weekly-meal-plan", { body: { token, action: "confirm" } });
      if (error) throw error;
      if (data?.plan) {
        setPlan(data.plan);
        onPlanChanged?.(data.plan);
      }
      toast.success("Your meal plan is set for the week.");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to confirm");
    } finally {
      setBusy(false);
    }
  };

  const resetWeek = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("weekly-meal-plan", { body: { token, action: "reset" } });
      if (error) throw error;
      setPlan(null);
      onPlanChanged?.(null);
      toast.success("Week cleared.");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to reset");
    } finally {
      setBusy(false);
    }
  };

  // ---------- Shopping list (supports primary/alt split) ----------
  const shoppingList = useMemo(() => {
    type Row = { name: string; qty: string; category: string; key: string };
    const rows: Row[] = [];

    const accumulate = (opt: OptionDef | null, selections: SelectionMap, days: number) => {
      if (!opt || days <= 0) return;
      const eat = (name: string, qty: string, sources: (keyof typeof MB_FOODS)[]) => {
        const cat = categoryForSources(sources);
        const key = `${cat}::${name}::${qty}`;
        rows.push({ name, qty, category: cat, key });
      };

      for (const f of opt.fixed ?? []) {
        const grams = parseGrams(f.qty);
        const eggs = /eggs?/i.test(f.label) ? (parseInt(f.qty.match(/(\d+)/)?.[1] ?? "2", 10)) : 0;
        if (eggs) eat("Eggs", `${eggs * days} eggs`, ["yogurt"] as any);
        else if (grams != null) eat(f.label, `${Math.round(grams * days)}g`, ["yogurt"] as any);
        else eat(f.label, `${f.qty} × ${days} days`, ["yogurt"] as any);
      }

      const vegBothFilled = !!selections["veg1"] && !!selections["veg2"];
      let vegSplitGrams: number | null = null;
      const veg1 = opt.components.find((c) => c.key === "veg1");
      if (vegBothFilled && veg1) {
        const g = parseGrams(veg1.qty);
        if (g != null) vegSplitGrams = Math.round(g / 2);
      }

      for (const c of opt.components) {
        const choice = selections[c.key];
        if (!choice) continue;
        const grams = parseGrams(c.qty);
        const ml = parseMillilitres(c.qty);
        const parsed = parseTrailingUnit(choice);
        let qtyText = "";
        if (c.key === "veg1" || c.key === "veg2") {
          const g = vegSplitGrams ?? grams;
          qtyText = g != null ? `${g * days}g` : `${days} servings`;
        } else if (grams != null) qtyText = `${Math.round(grams * days)}g`;
        else if (ml != null) qtyText = `${Math.round(ml * days)}ml`;
        else if (parsed.qtyText) {
          const innerG = parseGrams(parsed.qtyText);
          const innerNum = parsed.qtyText.match(/^\s*(\d+(?:\.\d+)?)\s*$/);
          if (innerG != null) qtyText = `${Math.round(innerG * days)}g`;
          else if (innerNum) qtyText = `${Math.round(parseFloat(innerNum[1]) * days)} pcs`;
          else qtyText = `${parsed.qtyText} × ${days} days`;
        } else qtyText = `${days} servings`;
        eat(parsed.base, qtyText, c.sources);
      }
    };

    for (const m of MEALS) {
      const days = primaryDaysFor(m);
      accumulate(selectedOption(m, "primary"), sel(m, "primary"), days);
      if (days < 7) accumulate(selectedOption(m, "alt"), sel(m, "alt"), 7 - days);
    }

    const byCat = new Map<string, Row[]>();
    const seen = new Set<string>();
    for (const r of rows) {
      if (seen.has(r.key)) continue;
      seen.add(r.key);
      const arr = byCat.get(r.category) ?? [];
      arr.push(r);
      byCat.set(r.category, arr);
    }
    return Array.from(byCat.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [plan]);

  const shareText = useMemo(() => {
    const lines: string[] = [`Shopping List — Week of ${weekStart}`, ""];
    for (const [cat, items] of shoppingList) {
      lines.push(cat.toUpperCase());
      for (const it of items) lines.push(`  • ${it.name} — ${it.qty}`);
      lines.push("");
    }
    return lines.join("\n");
  }, [shoppingList, weekStart]);

  const onShare = async () => {
    try {
      if (navigator.share) await navigator.share({ title: "Shopping List", text: shareText });
      else { await navigator.clipboard.writeText(shareText); toast.success("Copied to clipboard"); }
    } catch {
      try { await navigator.clipboard.writeText(shareText); toast.success("Copied to clipboard"); }
      catch { toast.error("Could not share"); }
    }
  };

  if (loading) return <Card className="p-6 text-sm text-muted-foreground">Loading your meal plan…</Card>;

  return (
    <section className="space-y-4">
      <Card className="p-4">
        <h2 className="text-lg font-semibold">This Week's Meal Plan</h2>
        <p className="text-sm text-muted-foreground">
          Select one option from each meal below. Your choices will be used for the week and loaded into your Recipe Generator.
        </p>
        {weekStart && <p className="text-xs text-muted-foreground mt-1">Week of {weekStart} · resets every Monday</p>}
        {confirmed && (
          <div className="mt-3 flex items-center gap-2 text-xs text-primary">
            <Lock className="h-3.5 w-3.5" /> Plan confirmed — locked for the week.
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {MEALS.map((m) => {
          const options = MB_OPTIONS[m];
          const primaryOpt = selectedOption(m, "primary");
          const lc = limitCheck(m);
          const primaryDays = lc.limited ? lc.maxDays : 7;
          const altDays = 7 - primaryDays;
          const altOpt = selectedOption(m, "alt");
          const complete = isMealComplete(m);

          const renderOptionCard = (slot: "primary" | "alt", opt: OptionDef, days: number, dayLabel: string) => {
            const id = mealIdFor(m, slot);
            const active = id === opt.id;
            const s = sel(m, slot);
            return (
              <Card
                key={`${slot}-${opt.id}`}
                className={`p-3 transition-colors ${active ? "border-primary" : ""} ${confirmed ? "opacity-90" : "cursor-pointer hover:border-primary/60"}`}
                onClick={() => !active && chooseOption(m, slot, opt.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium">
                    {m[0].toUpperCase() + m.slice(1)} {opt.id} — {opt.label}
                  </p>
                  {active && <span className="text-[10px] uppercase tracking-wide text-primary">{dayLabel}</span>}
                </div>
                {active && (
                  <div className="mt-3 space-y-2" onClick={(e) => e.stopPropagation()}>
                    {opt.fixed?.map((f, i) => (
                      <p key={i} className="text-xs text-muted-foreground">
                        Fixed: <span className="text-foreground">{f.label} — {f.qty}</span>
                      </p>
                    ))}
                    {opt.components.map((c) => {
                      const chosen = s[c.key];
                      return (
                        <Button
                          key={c.key}
                          size="sm"
                          variant={chosen ? "default" : "outline"}
                          className="w-full justify-between h-auto py-2 whitespace-normal text-left"
                          onClick={() => openPicker(slot, m, c)}
                          disabled={confirmed}
                        >
                          <span className="text-xs">
                            {c.label}
                            {c.qty && <span className="text-muted-foreground"> · {c.qty}</span>}
                          </span>
                          <span className="text-xs font-medium">{chosen ?? "Choose"}</span>
                        </Button>
                      );
                    })}
                    {!confirmed && (
                      <Button size="sm" variant="ghost" className="w-full text-xs text-muted-foreground"
                        onClick={() => chooseOption(m, slot, opt.id)}>
                        Clear selection
                      </Button>
                    )}
                  </div>
                )}
              </Card>
            );
          };

          // Pick which options to show in alt list — exclude the primary so user picks an actual alternative
          const altOptions = options.filter((o) => o.id !== primaryOpt?.id);

          return (
            <div key={m} className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium capitalize">{m}</p>
                {complete && (
                  <span className="inline-flex items-center gap-1 text-xs text-primary">
                    <Check className="h-3.5 w-3.5" /> Complete
                  </span>
                )}
              </div>

              {lc.limited && primaryOpt && !confirmed && (() => {
                const r = lc.reasons[0];
                const acked = isAcknowledged(r.food);
                return (
                  <Alert variant="default" className="border-amber-500/50 bg-amber-50/50 dark:bg-amber-950/20">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <AlertTitle className="text-sm">Weekly limit reached</AlertTitle>
                    <AlertDescription className="text-xs space-y-2">
                      <p>
                        Your plan allows <span className="font-medium">{r.limit} {r.food.toLowerCase()} / week</span>.
                        This meal uses <span className="font-medium">{r.unitNote}</span> — enough for{" "}
                        <span className="font-medium">{primaryDays} {primaryDays === 1 ? "day" : "days"}</span>.
                        Pick an alternative for the remaining <span className="font-medium">{altDays} {altDays === 1 ? "day" : "days"}</span>.
                      </p>
                      <label className="flex items-center gap-2 pt-1 cursor-pointer">
                        <Checkbox
                          checked={acked}
                          onCheckedChange={(v) => { if (v && !acked) void acknowledge(r.food, r.limit, r.perServing); }}
                          disabled={acked}
                        />
                        <span className={acked ? "text-muted-foreground" : "font-medium"}>
                          {acked ? "Acknowledged — you can now pick an alternate meal." : "I understand and want to continue"}
                        </span>
                      </label>
                    </AlertDescription>
                  </Alert>
                );
              })()}

              <div className="space-y-2">
                {options.map((opt) =>
                  renderOptionCard("primary", withOil(opt, oilAllowed), primaryDays,
                    primaryOpt?.id === opt.id && lc.limited
                      ? `${daySplitLabel(0, primaryDays - 1)} · ${primaryDays}d`
                      : "Selected"),
                )}
              </div>


              {lc.limited && primaryOpt && lc.reasons.every((r) => isAcknowledged(r.food)) && (
                <div className="space-y-2 pt-1">
                  <p className="text-xs font-medium text-muted-foreground">
                    Alternate {m} — covers {altDays} {altDays === 1 ? "day" : "days"}
                    {altDays > 0 && <> ({daySplitLabel(primaryDays, 6)})</>}
                  </p>
                  {altOptions.map((opt) =>
                    renderOptionCard("alt", withOil(opt, oilAllowed), altDays,
                      altOpt?.id === opt.id ? `${daySplitLabel(primaryDays, 6)} · ${altDays}d` : "Selected"),
                  )}

                </div>
              )}
            </div>
          );
        })}
      </div>

      <Card className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <p className="text-sm font-medium">
            {confirmed
              ? "Your meal plan is set for the week. Head to the Home tab to create your recipes."
              : allComplete
                ? "All three meals are selected. Confirm to lock the week in."
                : "Choose one option per meal and fill in every component to confirm the week."}
          </p>
        </div>
        <div className="flex gap-2">
          {confirmed ? (
            <>
              <Button onClick={() => setShowShopping(true)} variant="default">
                <ShoppingBag className="h-4 w-4" /> View Shopping List
              </Button>
              <Button onClick={resetWeek} variant="outline" disabled={busy}>Reset week</Button>
            </>
          ) : (
            <Button onClick={confirm} disabled={!allComplete || busy}>
              {busy ? "Saving…" : "Confirm My Week"}
            </Button>
          )}
        </div>
      </Card>

      <Dialog open={!!picker} onOpenChange={(o) => !o && setPicker(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Choose your {picker?.label}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto space-y-1">
            {picker?.items.length === 0 && (
              <p className="text-sm text-muted-foreground">No options available in your personal list for this category.</p>
            )}
            {picker?.items.map((it) => (
              <Button key={it} variant="outline" className="w-full justify-start" onClick={() => pickItem(it)}>
                {it}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showShopping} onOpenChange={setShowShopping}>
        <DialogContent className="max-w-lg">
          <DialogHeader className="flex flex-row items-center justify-between">
            <DialogTitle>Shopping List</DialogTitle>
            <Button size="sm" variant="outline" onClick={onShare}>
              <Share2 className="h-4 w-4" /> Share
            </Button>
          </DialogHeader>
          <div className="max-h-[65vh] overflow-y-auto space-y-4">
            {shoppingList.length === 0 && (
              <p className="text-sm text-muted-foreground">Your shopping list will appear here once your week is set.</p>
            )}
            {shoppingList.map(([cat, items]) => (
              <div key={cat} className="space-y-2">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{cat}</p>
                <ul className="space-y-1">
                  {items.map((it) => {
                    const checked = !!checkedItems[it.key];
                    return (
                      <li key={it.key} className="flex items-start gap-2">
                        <Checkbox
                          id={it.key}
                          checked={checked}
                          onCheckedChange={(v) => setCheckedItems((p) => ({ ...p, [it.key]: !!v }))}
                          className="mt-1"
                        />
                        <Label htmlFor={it.key} className={`text-sm flex-1 cursor-pointer ${checked ? "line-through text-muted-foreground" : ""}`}>
                          <span className="font-medium">{it.name}</span>
                          <span className="text-muted-foreground"> — {it.qty}</span>
                        </Label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowShopping(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export type { WeeklyPlan };
