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

  function updateField(mk: MealKey, field: keyof SlotMacros, raw: string) {
    const n = Number(raw);
    const v = Number.isFinite(n) ? n : 0;
    setLocal((prev) => ({
      ...prev,
      [mk]: { ...(prev[mk] ?? { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }), [field]: v },
    }));
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
                  <Input type="number" value={s.calories} onChange={(e) => updateField(mk, "calories", e.target.value)} className="h-8" />
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
    </Card>
  );
}
