import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { customSlotLabel } from "@/lib/meal-slots";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type SlotKey = "breakfast" | "morning_snack" | "lunch" | "afternoon_snack" | "dinner";
type MealKey = "meal_1" | "meal_2" | "meal_3" | "meal_4" | "meal_5";

interface MacroSet { calories: number; protein_g: number; carbs_g: number; fat_g: number }
interface SlotMacros { calories: number; protein_g: number; carbs_g: number; fat_g: number }
type Allocation = Partial<Record<MealKey, SlotMacros>>;

interface Props {
  clientId: string;
  macros: MacroSet | null;
  mealsPerDay: number;
  allocation: Allocation | null;
  resetSignal?: number;
  onClientPatched?: (patch: { meals_per_day?: number; macro_allocation?: Allocation }) => void;
}

function activeSlots(meals: number): SlotKey[] {
  if (meals === 5) return ["breakfast", "morning_snack", "lunch", "afternoon_snack", "dinner"];
  if (meals === 4) return ["breakfast", "lunch", "afternoon_snack", "dinner"];
  return ["breakfast", "lunch", "dinner"];
}

const MEAL_KEYS: MealKey[] = ["meal_1", "meal_2", "meal_3", "meal_4", "meal_5"];

function evenSplit(macros: MacroSet | null, meals: number): Allocation {
  const out: Allocation = {};
  if (!macros || meals <= 0) return out;
  const fields: (keyof SlotMacros)[] = ["calories", "protein_g", "carbs_g", "fat_g"];
  const totals: Record<keyof SlotMacros, number> = {
    calories: macros.calories || 0,
    protein_g: macros.protein_g || 0,
    carbs_g: macros.carbs_g || 0,
    fat_g: macros.fat_g || 0,
  };
  for (let i = 0; i < meals; i += 1) {
    out[MEAL_KEYS[i]] = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
  }
  for (const f of fields) {
    const per = Math.round(totals[f] / meals);
    for (let i = 0; i < meals; i += 1) {
      (out[MEAL_KEYS[i]] as SlotMacros)[f] = per;
    }
    const remainder = totals[f] - per * meals;
    if (remainder !== 0) {
      (out[MEAL_KEYS[0]] as SlotMacros)[f] = per + remainder;
    }
  }
  return out;
}

function hasAnyValues(a: Allocation | null, meals: number): boolean {
  if (!a) return false;
  for (let i = 0; i < meals; i += 1) {
    const s = a[MEAL_KEYS[i]];
    if (s && (s.calories || s.protein_g || s.carbs_g || s.fat_g)) return true;
  }
  return false;
}

function mergeWithEvenSplit(a: Allocation | null, macros: MacroSet | null, meals: number): Allocation {
  const split = evenSplit(macros, meals);
  if (!a) return split;
  const out: Allocation = {};
  for (let i = 0; i < meals; i += 1) {
    const mk = MEAL_KEYS[i];
    const saved = a[mk];
    if (saved && (saved.calories || saved.protein_g || saved.carbs_g || saved.fat_g)) {
      out[mk] = saved;
    } else {
      out[mk] = split[mk] ?? { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
    }
  }
  return out;
}

export default function MacroAllocationSection({ clientId, macros, mealsPerDay, allocation, resetSignal, onClientPatched }: Props) {
  const defaultMeals = [3, 4, 5].includes(Number(mealsPerDay)) ? Number(mealsPerDay) : 3;
  const [meals, setMeals] = useState<number>(defaultMeals);
  const [local, setLocal] = useState<Allocation>(() =>
    mergeWithEvenSplit(allocation, macros, defaultMeals)
  );
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => { setMeals(defaultMeals); }, [defaultMeals]);

  // Allocation prop changed (loaded from DB or saved): merge with even split.
  useEffect(() => {
    setLocal(mergeWithEvenSplit(allocation, macros, meals));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allocation, meals]);

  // Live macros changed in Results: always recompute even split.
  useEffect(() => {
    setLocal(evenSplit(macros, meals));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [macros?.calories, macros?.protein_g, macros?.carbs_g, macros?.fat_g]);

  // Macros were just saved by the practitioner: force even split and persist,
  // overwriting any prior per-slot customisations.
  useEffect(() => {
    if (resetSignal === undefined || resetSignal === 0) return;
    const split = evenSplit(macros, meals);
    setLocal(split);
    (async () => {
      const { error } = await supabase
        .from("clients")
        .update({ macro_allocation: split } as never)
        .eq("id", clientId);
      if (error) { toast.error("Failed to reset allocation"); return; }
      onClientPatched?.({ macro_allocation: split });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal]);


  async function handleMealsChange(v: string) {
    const n = Number(v);
    setMeals(n);
    const split = evenSplit(macros, n);
    setLocal(split);
    const { error } = await supabase
      .from("clients")
      .update({ meals_per_day: n, macro_allocation: split } as never)
      .eq("id", clientId);
    if (error) { toast.error("Failed to save meals per day"); return; }
    onClientPatched?.({ meals_per_day: n, macro_allocation: split });
  }

  type ReallocMacro = "protein_g" | "carbs_g" | "fat_g";
  interface PendingRealloc {
    mk: MealKey;
    slotIndex: number;
    macro: ReallocMacro;
    mode: "reduce" | "increase";
    delta: number; // absolute calorie delta
    choice: "protein" | "carbs" | "fat" | "split" | "total";
    prevVal: number; // prior macro grams value
    prevCalories: number; // prior calories value
  }
  interface PendingCalRealloc {
    mk: MealKey;
    slotIndex: number;
    mode: "reduce" | "increase";
    delta: number; // absolute calorie delta
    choice: MealKey | "split" | "total";
    prevVal: number; // prior calories value
  }
  interface PendingRecv {
    mk: MealKey;
    slotIndex: number;
    delta: number; // calories received
    choice: "protein" | "carbs" | "fat" | "split" | "custom";
    customP?: number;
    customC?: number;
    customF?: number;
  }
  interface PendingSend {
    mk: MealKey;
    slotIndex: number;
    delta: number; // calories lost (absolute)
    choice: "protein" | "carbs" | "fat" | "split" | "custom";
    customP?: number;
    customC?: number;
    customF?: number;
  }
  const [pending, setPending] = useState<Record<string, PendingRealloc | null>>({});
  const [pendingCal, setPendingCal] = useState<Record<string, PendingCalRealloc | null>>({});
  const [pendingRecv, setPendingRecv] = useState<Record<string, PendingRecv | null>>({});
  const [pendingSend, setPendingSend] = useState<Record<string, PendingSend | null>>({});
  const [recvConfirm, setRecvConfirm] = useState<{ mk: MealKey; allocated: number; target: number } | null>(null);
  const [sendConfirm, setSendConfirm] = useState<{ mk: MealKey; allocated: number; target: number } | null>(null);

  const MACRO_LABEL: Record<ReallocMacro, string> = {
    protein_g: "protein",
    carbs_g: "carbs",
    fat_g: "fat",
  };
  const KCAL_PER_G: Record<ReallocMacro, number> = { protein_g: 4, carbs_g: 4, fat_g: 9 };

  function updateField(mk: MealKey, field: keyof SlotMacros, raw: string) {
    const n = Number(raw);
    const v = Number.isFinite(n) ? n : 0;
    const prevSlot = local[mk] ?? { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
    const oldVal = prevSlot[field] || 0;
    setLocal((prev) => ({
      ...prev,
      [mk]: { ...(prev[mk] ?? { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }), [field]: v },
    }));
    if (field === "protein_g" || field === "carbs_g" || field === "fat_g") {
      const existing = pending[mk];
      // Preserve original prior value across consecutive keystrokes on the same field.
      const prevVal = existing && existing.macro === field ? existing.prevVal : oldVal;
      const prevCalories = existing && existing.macro === field ? existing.prevCalories : (prevSlot.calories || 0);
      const diffG = v - prevVal;
      if (diffG !== 0) {
        const deltaCal = Math.abs(diffG) * KCAL_PER_G[field];
        const slotIndex = MEAL_KEYS.indexOf(mk);
        setPending((p) => ({
          ...p,
          [mk]: {
            mk,
            slotIndex,
            macro: field,
            mode: diffG < 0 ? "reduce" : "increase",
            delta: deltaCal,
            choice: "split",
            prevVal,
            prevCalories,
          },
        }));
      } else {
        setPending((p) => ({ ...p, [mk]: null }));
      }
    } else if (field === "calories") {
      const existing = pendingCal[mk];
      const prevVal = existing ? existing.prevVal : oldVal;
      const diff = v - prevVal;
      if (diff !== 0) {
        const slotIndex = MEAL_KEYS.indexOf(mk);
        const otherKeys = MEAL_KEYS.slice(0, meals).filter((k) => k !== mk);
        const firstOther = otherKeys[0] ?? "split";
        setPendingCal((p) => ({
          ...p,
          [mk]: {
            mk,
            slotIndex,
            mode: diff < 0 ? "reduce" : "increase",
            delta: Math.abs(diff),
            choice: firstOther as PendingCalRealloc["choice"],
            prevVal,
          },
        }));
      } else {
        setPendingCal((p) => ({ ...p, [mk]: null }));
      }
    }
  }

  function applySlotCalRealloc(mk: MealKey) {
    const p = pendingCal[mk];
    if (!p) return;
    const otherKeys = MEAL_KEYS.slice(0, meals).filter((k) => k !== mk);
    const recipients: { k: MealKey; delta: number }[] = [];
    setLocal((prev) => {
      const next = { ...prev };
      const ensure = (k: MealKey) => ({ ...(next[k] ?? { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }) });
      const cals = p.delta;
      // sign applied to OTHER slots: reduce-source => add to others; increase-source => remove from others
      const sign = p.mode === "reduce" ? 1 : -1;
      if (p.choice === "total") {
        return next;
      }
      if (p.choice === "split") {
        if (otherKeys.length === 0) return next;
        const per = cals / otherKeys.length;
        for (const k of otherKeys) {
          const s = ensure(k);
          const before = Number(s.calories) || 0;
          const after = Math.max(0, Math.round(before + sign * per));
          s.calories = after;
          next[k] = s;
          if (p.mode === "reduce") recipients.push({ k, delta: after - before });
        }
        return next;
      }
      // single target meal
      const tk = p.choice as MealKey;
      const s = ensure(tk);
      const before = Number(s.calories) || 0;
      const after = Math.max(0, Math.round(before + sign * cals));
      s.calories = after;
      next[tk] = s;
      if (p.mode === "reduce") recipients.push({ k: tk, delta: after - before });
      return next;
    });
    setPendingCal((prev) => ({ ...prev, [mk]: null }));
    // Queue receive-allocation prompts for recipients that actually gained calories.
    if (recipients.length > 0) {
      setPendingRecv((prev) => {
        const out = { ...prev };
        for (const r of recipients) {
          if (r.delta > 0) {
            out[r.k] = { mk: r.k, slotIndex: MEAL_KEYS.indexOf(r.k), delta: r.delta, choice: "split" };
          }
        }
        return out;
      });
    }
  }

  function applySlotRecv(mk: MealKey) {
    const p = pendingRecv[mk];
    if (!p) return;
    setLocal((prev) => {
      const s = { ...(prev[mk] ?? { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }) };
      const cals = p.delta;
      const addG = (m: ReallocMacro, c: number) => {
        s[m] = Math.max(0, Math.round((Number(s[m]) || 0) + c / KCAL_PER_G[m]));
      };
      if (p.choice === "protein") addG("protein_g", cals);
      else if (p.choice === "carbs") addG("carbs_g", cals);
      else if (p.choice === "fat") addG("fat_g", cals);
      else if (p.choice === "split") {
        const third = cals / 3;
        addG("protein_g", third);
        addG("carbs_g", third);
        addG("fat_g", third);
      } else if (p.choice === "custom") {
        s.protein_g = Math.max(0, Math.round((Number(s.protein_g) || 0) + (Number(p.customP) || 0)));
        s.carbs_g = Math.max(0, Math.round((Number(s.carbs_g) || 0) + (Number(p.customC) || 0)));
        s.fat_g = Math.max(0, Math.round((Number(s.fat_g) || 0) + (Number(p.customF) || 0)));
      }
      // Recompute calories from macros so totals stay consistent.
      s.calories = Math.round((s.protein_g || 0) * 4 + (s.carbs_g || 0) * 4 + (s.fat_g || 0) * 9);
      return { ...prev, [mk]: s };
    });
    setPendingRecv((prev) => ({ ...prev, [mk]: null }));
  }


  function applySlotRealloc(mk: MealKey) {
    const p = pending[mk];
    if (!p) return;
    setLocal((prev) => {
      const s = { ...(prev[mk] ?? { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }) };
      const sign = p.mode === "reduce" ? 1 : 1; // "Add to X" always adds grams; for reduce we add freed cals, for increase spec says same options
      const cals = p.delta;
      const addG = (m: ReallocMacro, c: number) => {
        s[m] = Math.max(0, Math.round((s[m] || 0) + (c / KCAL_PER_G[m]) * sign));
      };
      if (p.choice === "protein") addG("protein_g", cals);
      else if (p.choice === "carbs") addG("carbs_g", cals);
      else if (p.choice === "fat") addG("fat_g", cals);
      else if (p.choice === "split") {
        const third = cals / 3;
        addG("protein_g", third);
        addG("carbs_g", third);
        addG("fat_g", third);
      } else if (p.choice === "total") {
        // "Remove from total" (reduce) or "Add to total" (increase): adjust calories
        s.calories = Math.max(0, Math.round((s.calories || 0) + (p.mode === "reduce" ? -cals : cals)));
      }
      // Recompute calories from macros if we touched macros (not total option)
      if (p.choice !== "total") {
        s.calories = Math.round((s.protein_g || 0) * 4 + (s.carbs_g || 0) * 4 + (s.fat_g || 0) * 9);
      }
      return { ...prev, [mk]: s };
    });
    setPending((prev) => ({ ...prev, [mk]: null }));
  }

  const totals = useMemo(() => {
    const t = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
    for (let i = 0; i < meals; i += 1) {
      const s = local[MEAL_KEYS[i]];
      if (!s) continue;
      t.calories += s.calories || 0;
      t.protein_g += s.protein_g || 0;
      t.carbs_g += s.carbs_g || 0;
      t.fat_g += s.fat_g || 0;
    }
    return t;
  }, [local, meals]);

  function totalClass(total: number, target: number): string {
    if (!target) return "text-muted-foreground";
    if (total > target) return "text-red-600 dark:text-red-400";
    return "text-emerald-600 dark:text-emerald-400";
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payload: Allocation = {};
      for (let i = 0; i < meals; i += 1) {
        payload[MEAL_KEYS[i]] = local[MEAL_KEYS[i]] ?? { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
      }
      const { error } = await supabase.from("clients").update({ macro_allocation: payload } as never).eq("id", clientId);
      if (error) throw error;
      onClientPatched?.({ macro_allocation: payload });
      toast.success("Allocation saved");
    } catch (e) {
      console.error(e);
      toast.error("Failed to save allocation");
    } finally {
      setSaving(false);
    }
  }

  const slots = activeSlots(meals);

  return (
    <Card className="p-4 space-y-4">
      <div>
        <p className="font-medium">Macro Allocation</p>
        <p className="text-xs text-muted-foreground">
          Set how the daily macros are split across each meal. Defaults to an even split.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Meals per day</Label>
          <Select value={String(meals)} onValueChange={handleMealsChange}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="3">3</SelectItem>
              <SelectItem value="4">4</SelectItem>
              <SelectItem value="5">5</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-3">
        {slots.map((slot, i) => {
          const mk = MEAL_KEYS[i];
          const s = local[mk] ?? { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
          return (
            <div key={mk} className="rounded-md border p-3 space-y-2">
              <p className="text-sm font-semibold">{customSlotLabel(slot, meals)}</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Calories</Label>
                  <Input type="number" value={Number(s.calories) || 0} onChange={(e) => updateField(mk, "calories", e.target.value)} className="h-8" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Protein (g)</Label>
                  <Input type="number" value={s.protein_g} onChange={(e) => updateField(mk, "protein_g", e.target.value)} className="h-8" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Carbs (g)</Label>
                  <Input type="number" value={s.carbs_g} onChange={(e) => updateField(mk, "carbs_g", e.target.value)} className="h-8" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Fat (g)</Label>
                  <Input type="number" value={s.fat_g} onChange={(e) => updateField(mk, "fat_g", e.target.value)} className="h-8" />
                </div>
              </div>
              {pending[mk] && (() => {
                const p = pending[mk]!;
                const mealNum = i + 1;
                const isReduce = p.mode === "reduce";
                return (
                  <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2">
                    <p className="text-xs">
                      {isReduce
                        ? `You freed up ${p.delta} calories in Meal ${mealNum} by reducing ${MACRO_LABEL[p.macro]}. Where would you like to reallocate them?`
                        : `You added ${p.delta} calories to Meal ${mealNum}. Where would you like to allocate them?`}
                    </p>
                    <Select
                      value={p.choice}
                      onValueChange={(v) =>
                        setPending((prev) => ({ ...prev, [mk]: { ...p, choice: v as PendingRealloc["choice"] } }))
                      }
                    >
                      <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="protein">Add to Protein</SelectItem>
                        <SelectItem value="carbs">Add to Carbs</SelectItem>
                        <SelectItem value="fat">Add to Fat</SelectItem>
                        <SelectItem value="split">Split evenly</SelectItem>
                        <SelectItem value="total">{isReduce ? "Remove from total" : "Add to total"}</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => applySlotRealloc(mk)}>Confirm reallocation</Button>
                      <Button size="sm" variant="ghost" onClick={() => {
                        const cur = pending[mk];
                        if (cur) {
                          setLocal((prev) => ({
                            ...prev,
                            [mk]: { ...(prev[mk] ?? { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }), [cur.macro]: cur.prevVal, calories: cur.prevCalories },
                          }));
                        }
                        setPending((prev) => ({ ...prev, [mk]: null }));
                      }}>Cancel</Button>
                    </div>
                  </div>
                );
              })()}
              {pendingCal[mk] && (() => {
                const p = pendingCal[mk]!;
                const mealNum = i + 1;
                const isReduce = p.mode === "reduce";
                const otherKeys = MEAL_KEYS.slice(0, meals).filter((k) => k !== mk);
                return (
                  <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2">
                    <p className="text-xs">
                      {isReduce
                        ? `You freed up ${p.delta} calories from Meal ${mealNum}. Where would you like to add them?`
                        : `You added ${p.delta} calories to Meal ${mealNum}. Where should these come from?`}
                    </p>
                    <Select
                      value={p.choice}
                      onValueChange={(v) =>
                        setPendingCal((prev) => ({ ...prev, [mk]: { ...p, choice: v as PendingCalRealloc["choice"] } }))
                      }
                    >
                      <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {otherKeys.map((k) => {
                          const idx = MEAL_KEYS.indexOf(k) + 1;
                          return (
                            <SelectItem key={k} value={k}>
                              {isReduce ? `Add to Meal ${idx}` : `Remove from Meal ${idx}`}
                            </SelectItem>
                          );
                        })}
                        <SelectItem value="split">Split evenly across other meals</SelectItem>
                        <SelectItem value="total">{isReduce ? "Remove from daily total" : "Add to daily total"}</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => applySlotCalRealloc(mk)}>Confirm reallocation</Button>
                      <Button size="sm" variant="ghost" onClick={() => {
                        const cur = pendingCal[mk];
                        if (cur) {
                          setLocal((prev) => ({
                            ...prev,
                            [mk]: { ...(prev[mk] ?? { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }), calories: cur.prevVal },
                          }));
                        }
                        setPendingCal((prev) => ({ ...prev, [mk]: null }));
                      }}>Cancel</Button>
                    </div>
                  </div>
                );
              })()}
              {pendingRecv[mk] && (() => {
                const p = pendingRecv[mk]!;
                const mealNum = i + 1;
                const cP = (Number(p.customP) || 0) * 4;
                const cC = (Number(p.customC) || 0) * 4;
                const cF = (Number(p.customF) || 0) * 9;
                const allocated = cP + cC + cF;
                const matches = p.choice === "custom" ? allocated === p.delta : true;
                const totalCls =
                  p.choice !== "custom"
                    ? "text-muted-foreground"
                    : allocated === p.delta
                    ? "text-emerald-600 dark:text-emerald-400"
                    : allocated > p.delta
                    ? "text-red-600 dark:text-red-400"
                    : "text-muted-foreground";
                return (
                  <div className="mt-2 rounded-md border border-sky-300 bg-sky-50 dark:bg-sky-950/30 p-3 space-y-2">
                    <p className="text-xs">
                      {`Meal ${mealNum} received ${p.delta} extra calories. How would you like to allocate them within this meal?`}
                    </p>
                    <Select
                      value={p.choice}
                      onValueChange={(v) =>
                        setPendingRecv((prev) => ({ ...prev, [mk]: { ...p, choice: v as PendingRecv["choice"] } }))
                      }
                    >
                      <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="protein">Add to Protein</SelectItem>
                        <SelectItem value="carbs">Add to Carbs</SelectItem>
                        <SelectItem value="fat">Add to Fat</SelectItem>
                        <SelectItem value="split">Split evenly</SelectItem>
                        <SelectItem value="custom">Custom</SelectItem>
                      </SelectContent>
                    </Select>
                    {p.choice === "custom" && (
                      <div className="space-y-2">
                        <div className="grid grid-cols-3 gap-2">
                          <div className="space-y-1">
                            <Label className="text-xs">Protein (g)</Label>
                            <Input
                              type="number"
                              value={Number(p.customP) || 0}
                              onChange={(e) =>
                                setPendingRecv((prev) => ({ ...prev, [mk]: { ...p, customP: Number(e.target.value) || 0 } }))
                              }
                              className="h-8"
                            />
                            <p className="text-[10px] text-muted-foreground">{cP} kcal</p>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Carbs (g)</Label>
                            <Input
                              type="number"
                              value={Number(p.customC) || 0}
                              onChange={(e) =>
                                setPendingRecv((prev) => ({ ...prev, [mk]: { ...p, customC: Number(e.target.value) || 0 } }))
                              }
                              className="h-8"
                            />
                            <p className="text-[10px] text-muted-foreground">{cC} kcal</p>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Fat (g)</Label>
                            <Input
                              type="number"
                              value={Number(p.customF) || 0}
                              onChange={(e) =>
                                setPendingRecv((prev) => ({ ...prev, [mk]: { ...p, customF: Number(e.target.value) || 0 } }))
                              }
                              className="h-8"
                            />
                            <p className="text-[10px] text-muted-foreground">{cF} kcal</p>
                          </div>
                        </div>
                        <p className={`text-xs font-medium ${totalCls}`}>
                          Allocated: {allocated} of {p.delta} calories.
                        </p>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => {
                          if (p.choice === "custom" && allocated !== p.delta) {
                            setRecvConfirm({ mk, allocated, target: p.delta });
                          } else {
                            applySlotRecv(mk);
                          }
                        }}
                      >Confirm allocation</Button>
                      <Button size="sm" variant="ghost" onClick={() => setPendingRecv((prev) => ({ ...prev, [mk]: null }))}>Cancel</Button>
                    </div>
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>

      <div className="rounded-md border p-3 bg-muted/30">
        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Total allocated</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Calories</p>
            <p className={`font-semibold ${totalClass(totals.calories, macros?.calories ?? 0)}`}>
              {totals.calories}<span className="text-xs text-muted-foreground"> / {macros?.calories ?? 0}</span>
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Protein</p>
            <p className={`font-semibold ${totalClass(totals.protein_g, macros?.protein_g ?? 0)}`}>
              {totals.protein_g}g<span className="text-xs text-muted-foreground"> / {macros?.protein_g ?? 0}g</span>
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Carbs</p>
            <p className={`font-semibold ${totalClass(totals.carbs_g, macros?.carbs_g ?? 0)}`}>
              {totals.carbs_g}g<span className="text-xs text-muted-foreground"> / {macros?.carbs_g ?? 0}g</span>
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Fat</p>
            <p className={`font-semibold ${totalClass(totals.fat_g, macros?.fat_g ?? 0)}`}>
              {totals.fat_g}g<span className="text-xs text-muted-foreground"> / {macros?.fat_g ?? 0}g</span>
            </p>
          </div>
        </div>
      </div>

      <div>
        <Button
          onClick={() => {
            const baseline = evenSplit(macros, meals);
            let differs = false;
            for (let i = 0; i < meals; i += 1) {
              const a = local[MEAL_KEYS[i]] ?? { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
              const b = baseline[MEAL_KEYS[i]] ?? { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
              if (
                a.calories !== b.calories ||
                a.protein_g !== b.protein_g ||
                a.carbs_g !== b.carbs_g ||
                a.fat_g !== b.fat_g
              ) { differs = true; break; }
            }
            if (differs) setConfirmOpen(true);
            else handleSave();
          }}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save allocation"}
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save custom macro allocation?</AlertDialogTitle>
            <AlertDialogDescription>
              You've changed one or more per-meal values from the even split. These custom allocations will be used to generate this client's meal plan. Make sure the values are clinically appropriate before proceeding.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setConfirmOpen(false);
                await handleSave();
              }}
            >
              Confirm and save
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!recvConfirm} onOpenChange={(o) => { if (!o) setRecvConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Allocation doesn't match target</AlertDialogTitle>
            <AlertDialogDescription>
              {recvConfirm && (recvConfirm.allocated < recvConfirm.target
                ? `You've allocated ${recvConfirm.allocated} of ${recvConfirm.target} calories. ${recvConfirm.target - recvConfirm.allocated} calories are unallocated and will not be assigned to any macro. Save anyway?`
                : `You've allocated ${recvConfirm.allocated} of ${recvConfirm.target} calories — ${recvConfirm.allocated - recvConfirm.target} over the target. This will increase the meal's total calories. Save anyway?`)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (recvConfirm) applySlotRecv(recvConfirm.mk);
                setRecvConfirm(null);
              }}
            >
              Save anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
