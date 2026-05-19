import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Check, Share2, ShoppingBag, Lock } from "lucide-react";
import { MB_FOODS, MB_OPTIONS, type MealType, type OptionDef } from "@/lib/mb-foods";

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
  confirmed_at: string | null;
}

interface Props {
  token: string;
  /** Function returning available items for a given list of MB_FOODS source keys, respecting client's personal list */
  filteredSources: (sources: (keyof typeof MB_FOODS)[]) => string[];
  /** Triggered after the plan changes (e.g. confirmed/reset) so parent can refetch */
  onPlanChanged?: (plan: WeeklyPlan | null) => void;
}

const MEALS: MealType[] = ["breakfast", "lunch", "dinner"];

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

export default function MealPlanner({ token, filteredSources, onPlanChanged }: Props) {
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  const [weekStart, setWeekStart] = useState<string>("");
  const [picker, setPicker] = useState<{ meal: MealType; componentKey: string; label: string; items: string[] } | null>(null);
  const [showShopping, setShowShopping] = useState(false);
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("weekly-meal-plan", { body: { token, action: "get" } });
      if (error) throw error;
      setPlan(data?.plan ?? null);
      setWeekStart(data?.week_start_date ?? "");
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [token]);

  const selectionsFor = (m: MealType): SelectionMap =>
    (plan && (plan[`${m}_selections` as const] as SelectionMap)) || {};
  const mealIdFor = (m: MealType): number | null =>
    (plan && (plan[`${m}_meal_id` as const] as number | null)) || null;

  const selectedOption = (m: MealType): OptionDef | null => {
    const id = mealIdFor(m);
    if (!id) return null;
    return MB_OPTIONS[m].find((o) => o.id === id) ?? null;
  };

  const isMealComplete = (m: MealType): boolean => {
    const opt = selectedOption(m);
    if (!opt) return false;
    const sel = selectionsFor(m);
    return opt.components.filter((c) => !c.optional).every((c) => !!sel[c.key]);
  };

  const allComplete = MEALS.every(isMealComplete);
  const confirmed = !!plan?.confirmed_at;

  const persist = async (patch: Partial<WeeklyPlan>) => {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { token, action: "save" };
      for (const m of MEALS) {
        body[`${m}_meal_id`] = patch[`${m}_meal_id` as const] ?? mealIdFor(m);
        body[`${m}_selections`] = patch[`${m}_selections` as const] ?? selectionsFor(m);
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

  const chooseOption = async (m: MealType, optId: number) => {
    if (confirmed) return;
    const current = mealIdFor(m);
    const nextSelections = current === optId ? selectionsFor(m) : {};
    await persist({
      [`${m}_meal_id`]: current === optId ? null : optId,
      [`${m}_selections`]: nextSelections,
    } as Partial<WeeklyPlan>);
  };

  const openPicker = (m: MealType, c: { key: string; label: string; sources: (keyof typeof MB_FOODS)[] }) => {
    if (confirmed) return;
    setPicker({ meal: m, componentKey: c.key, label: c.label, items: filteredSources(c.sources) });
  };

  const pickItem = async (food: string) => {
    if (!picker) return;
    const m = picker.meal;
    const sel = { ...selectionsFor(m), [picker.componentKey]: food };
    setPicker(null);
    await persist({ [`${m}_selections`]: sel } as Partial<WeeklyPlan>);
  };

  const confirm = async () => {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { token, action: "confirm" };
      const { data, error } = await supabase.functions.invoke("weekly-meal-plan", { body });
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

  // Build shopping list
  const shoppingList = useMemo(() => {
    type Row = { name: string; qty: string; category: string; key: string };
    const rows: Row[] = [];
    const eat = (name: string, qty: string, sources: (keyof typeof MB_FOODS)[]) => {
      const cat = categoryForSources(sources);
      const key = `${cat}::${name}::${qty}`;
      rows.push({ name, qty, category: cat, key });
    };

    for (const m of MEALS) {
      const opt = selectedOption(m);
      if (!opt) continue;
      const sel = selectionsFor(m);

      // Fixed ingredients (e.g. eggs)
      for (const f of opt.fixed ?? []) {
        const grams = parseGrams(f.qty);
        const eggs = /eggs?/i.test(f.label) ? (parseInt(f.qty.match(/(\d+)/)?.[1] ?? "2", 10)) : 0;
        if (eggs) eat("Eggs", `${eggs * 7} eggs`, ["yogurt"] as any); // dairy bucket
        else if (grams != null) eat(f.label, `${Math.round(grams * 7)}g`, ["yogurt"] as any);
        else eat(f.label, `${f.qty} × 7 days`, ["yogurt"] as any);
      }

      // Veg split when both selected
      const vegBothFilled = !!sel["veg1"] && !!sel["veg2"];
      let vegSplitGrams: number | null = null;
      const veg1 = opt.components.find((c) => c.key === "veg1");
      if (vegBothFilled && veg1) {
        const g = parseGrams(veg1.qty);
        if (g != null) vegSplitGrams = Math.round(g / 2);
      }

      for (const c of opt.components) {
        const choice = sel[c.key];
        if (!choice) continue;
        const grams = parseGrams(c.qty);
        const ml = parseMillilitres(c.qty);
        const parsed = parseTrailingUnit(choice);
        let qtyText = "";

        if (c.key === "veg1" || c.key === "veg2") {
          const g = vegSplitGrams ?? grams;
          qtyText = g != null ? `${g * 7}g` : "7 servings";
        } else if (grams != null) {
          qtyText = `${Math.round(grams * 7)}g`;
        } else if (ml != null) {
          qtyText = `${Math.round(ml * 7)}ml`;
        } else if (parsed.qtyText) {
          // food carries its own per-serve qty e.g. "(160g)" or "(1)"
          const innerG = parseGrams(parsed.qtyText);
          const innerNum = parsed.qtyText.match(/^\s*(\d+(?:\.\d+)?)\s*$/);
          if (innerG != null) qtyText = `${Math.round(innerG * 7)}g`;
          else if (innerNum) qtyText = `${Math.round(parseFloat(innerNum[1]) * 7)} pcs`;
          else qtyText = `${parsed.qtyText} × 7 days`;
        } else {
          qtyText = "7 servings";
        }
        eat(parsed.base, qtyText, c.sources);
      }
    }

    // Group by category, dedupe identical name+qty
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
      if (navigator.share) {
        await navigator.share({ title: "Shopping List", text: shareText });
      } else {
        await navigator.clipboard.writeText(shareText);
        toast.success("Copied to clipboard");
      }
    } catch {
      try {
        await navigator.clipboard.writeText(shareText);
        toast.success("Copied to clipboard");
      } catch {
        toast.error("Could not share");
      }
    }
  };

  if (loading) {
    return <Card className="p-6 text-sm text-muted-foreground">Loading your meal plan…</Card>;
  }

  return (
    <section className="space-y-4">
      <Card className="p-4">
        <h2 className="text-lg font-semibold">This Week's Meal Plan</h2>
        <p className="text-sm text-muted-foreground">
          Select one option from each meal below. Your choices will be used for the week and loaded into your Recipe Generator.
        </p>
        {weekStart && (
          <p className="text-xs text-muted-foreground mt-1">Week of {weekStart} · resets every Monday</p>
        )}
        {confirmed && (
          <div className="mt-3 flex items-center gap-2 text-xs text-primary">
            <Lock className="h-3.5 w-3.5" /> Plan confirmed — locked for the week.
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {MEALS.map((m) => {
          const options = MB_OPTIONS[m];
          const selOpt = selectedOption(m);
          const sel = selectionsFor(m);
          const complete = isMealComplete(m);

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
              <div className="space-y-2">
                {options.map((opt) => {
                  const active = selOpt?.id === opt.id;
                  return (
                    <Card
                      key={opt.id}
                      className={`p-3 transition-colors ${active ? "border-primary" : ""} ${confirmed ? "opacity-90" : "cursor-pointer hover:border-primary/60"}`}
                      onClick={() => !active && chooseOption(m, opt.id)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium">
                          {m[0].toUpperCase() + m.slice(1)} {opt.id} — {opt.label}
                        </p>
                        {active && (
                          <span className="text-[10px] uppercase tracking-wide text-primary">Selected</span>
                        )}
                      </div>

                      {active && (
                        <div className="mt-3 space-y-2" onClick={(e) => e.stopPropagation()}>
                          {opt.fixed?.map((f, i) => (
                            <p key={i} className="text-xs text-muted-foreground">
                              Fixed: <span className="text-foreground">{f.label} — {f.qty}</span>
                            </p>
                          ))}
                          {opt.components.map((c) => {
                            const chosen = sel[c.key];
                            return (
                              <Button
                                key={c.key}
                                size="sm"
                                variant={chosen ? "default" : "outline"}
                                className="w-full justify-between h-auto py-2 whitespace-normal text-left"
                                onClick={() => openPicker(m, c)}
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
                            <Button
                              size="sm"
                              variant="ghost"
                              className="w-full text-xs text-muted-foreground"
                              onClick={() => chooseOption(m, opt.id)}
                            >
                              Clear selection
                            </Button>
                          )}
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
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
              <Button onClick={resetWeek} variant="outline" disabled={busy}>
                Reset week
              </Button>
            </>
          ) : (
            <Button onClick={confirm} disabled={!allComplete || busy}>
              {busy ? "Saving…" : "Confirm My Week"}
            </Button>
          )}
        </div>
      </Card>

      {/* Component picker */}
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
              <Button
                key={it}
                variant="outline"
                className="w-full justify-start"
                onClick={() => pickItem(it)}
              >
                {it}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Shopping list */}
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
