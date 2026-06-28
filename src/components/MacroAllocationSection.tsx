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
  if (!macros) return out;
  for (let i = 0; i < meals; i += 1) {
    out[MEAL_KEYS[i]] = {
      calories: Math.round((macros.calories || 0) / meals),
      protein_g: Math.round((macros.protein_g || 0) / meals),
      carbs_g: Math.round((macros.carbs_g || 0) / meals),
      fat_g: Math.round((macros.fat_g || 0) / meals),
    };
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

export default function MacroAllocationSection({ clientId, macros, mealsPerDay, allocation, onClientPatched }: Props) {
  const defaultMeals = [3, 4, 5].includes(Number(mealsPerDay)) ? Number(mealsPerDay) : 3;
  const [meals, setMeals] = useState<number>(defaultMeals);
  const [local, setLocal] = useState<Allocation>(() =>
    hasAnyValues(allocation, defaultMeals) ? (allocation as Allocation) : evenSplit(macros, defaultMeals)
  );
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => { setMeals(defaultMeals); }, [defaultMeals]);

  // When macros change (e.g. saved) and no saved allocation, refresh evenly.
  useEffect(() => {
    if (!hasAnyValues(allocation, meals)) {
      setLocal(evenSplit(macros, meals));
    } else {
      setLocal(allocation as Allocation);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [macros?.calories, macros?.protein_g, macros?.carbs_g, macros?.fat_g, allocation]);

  async function handleMealsChange(v: string) {
    const n = Number(v);
    setMeals(n);
    setLocal(evenSplit(macros, n));
    const { error } = await supabase.from("clients").update({ meals_per_day: n } as never).eq("id", clientId);
    if (error) { toast.error("Failed to save meals per day"); return; }
    onClientPatched?.({ meals_per_day: n });
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
        <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save allocation"}</Button>
      </div>
    </Card>
  );
}
