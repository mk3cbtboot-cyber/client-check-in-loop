import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { customSlotLabel } from "@/lib/meal-slots";
import { cn } from "@/lib/utils";

export type SlotKey = "breakfast" | "morning_snack" | "lunch" | "afternoon_snack" | "dinner";

export interface FoodItem {
  name: string;
  portion: string;
  category: string;
}

export type CategoryKey = "protein" | "carbs" | "veg" | "fat";

export type FoodSelections = Record<string, { protein?: string | null; carbs?: string | null; veg?: string | null; fat?: string | null }>;

const ALL_SLOTS: SlotKey[] = ["breakfast", "morning_snack", "lunch", "afternoon_snack", "dinner"];

const CATEGORY_DEFS: { key: CategoryKey; label: string; match: (raw: string) => boolean }[] = [
  { key: "protein", label: "Protein", match: (r) => r === "protein" },
  { key: "carbs", label: "Carbs", match: (r) => r === "carbs" || r === "carb" || r === "starch" || r === "starches" },
  { key: "veg", label: "Veg", match: (r) => r === "veg" || r === "vegetable" || r === "vegetables" },
  { key: "fat", label: "Fat", match: (r) => r === "fat" || r === "fats" || r === "oil" || r === "oils" },
];

function visibleSlotKeys(meals: number): SlotKey[] {
  if (meals === 5) return ["breakfast", "morning_snack", "lunch", "afternoon_snack", "dinner"];
  if (meals === 4) return ["breakfast", "lunch", "afternoon_snack", "dinner"];
  return ["breakfast", "lunch", "dinner"];
}

export function foodKey(f: FoodItem): string {
  return `${f.name}${f.portion ? ` · ${f.portion}` : ""}`;
}

function stripEstimated(name: string): string {
  return (name ?? "").replace(/\s*\(estimated\)\s*$/i, "").trim();
}

export function categorize(food: FoodItem): CategoryKey | null {
  const raw = (food.category ?? "").trim().toLowerCase();
  for (const c of CATEGORY_DEFS) {
    if (c.match(raw)) return c.key;
  }
  return null;
}

interface Props {
  token: string;
  foodList: Record<string, FoodItem[]>;
  mealsPerDay: number;
  initialSelections: FoodSelections;
  onSaved: (next: FoodSelections) => void;
}

export default function FoodSelectionPlanSection({ token, foodList, mealsPerDay, initialSelections, onSaved }: Props) {
  const slots = ALL_SLOTS.filter((s) => visibleSlotKeys(mealsPerDay).includes(s));

  return (
    <div className="space-y-5">
      <Card className="p-4">
        <p className="text-sm text-muted-foreground">
          Choose one food per category for each meal. Your selections will appear on the Home tab when you generate recipes.
        </p>
      </Card>
      {slots.map((s) => (
        <SlotSelector
          key={s}
          token={token}
          slotKey={s}
          label={customSlotLabel(s, mealsPerDay)}
          foods={Array.isArray(foodList?.[s]) ? foodList[s] : []}
          initial={initialSelections?.[s] ?? {}}
          onSaved={(slotSel) => {
            const next = { ...initialSelections, [s]: slotSel };
            onSaved(next);
          }}
        />
      ))}
    </div>
  );
}

interface SlotProps {
  token: string;
  slotKey: SlotKey;
  label: string;
  foods: FoodItem[];
  initial: { protein?: string | null; carbs?: string | null; veg?: string | null; fat?: string | null };
  onSaved: (sel: { protein: string | null; carbs: string | null; veg: string | null; fat: string | null }) => void;
}

function SlotSelector({ token, slotKey, label, foods, initial, onSaved }: SlotProps) {
  const grouped = useMemo(() => {
    const out: Record<CategoryKey, FoodItem[]> = { protein: [], carbs: [], veg: [], fat: [] };
    for (const f of foods) {
      const c = categorize(f);
      if (c) out[c].push(f);
    }
    return out;
  }, [foods]);

  // Auto-select the only option in any category with exactly one food and no prior selection.
  const buildAutoSel = (): Record<CategoryKey, string | null> => {
    const next: Record<CategoryKey, string | null> = {
      protein: initial.protein ?? null,
      carbs: initial.carbs ?? null,
      veg: initial.veg ?? null,
      fat: initial.fat ?? null,
    };
    for (const cat of ["protein", "carbs", "veg", "fat"] as CategoryKey[]) {
      if (!next[cat] && grouped[cat].length === 1) {
        next[cat] = foodKey(grouped[cat][0]);
      }
    }
    return next;
  };

  const [sel, setSel] = useState<Record<CategoryKey, string | null>>(buildAutoSel);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // On slot/foods change, recompute auto-selections and silently persist when newly filled.
  useEffect(() => {
    const next = buildAutoSel();
    setSel(next);
    setDirty(false);
    const autoFilled =
      (!initial.protein && next.protein) ||
      (!initial.carbs && next.carbs) ||
      (!initial.veg && next.veg) ||
      (!initial.fat && next.fat);
    if (autoFilled) {
      supabase.functions.invoke("save-food-selections", {
        body: { token, slot_key: slotKey, selections: next },
      }).then(({ data, error }) => {
        if (error || data?.error) return;
        onSaved({
          protein: next.protein ?? null,
          carbs: next.carbs ?? null,
          veg: next.veg ?? null,
          fat: next.fat ?? null,
        });
      });
    }
  }, [slotKey, foods]); // eslint-disable-line react-hooks/exhaustive-deps

  const empty = foods.length === 0;

  const toggle = (cat: CategoryKey, key: string) => {
    setSel((prev) => {
      const next = { ...prev, [cat]: prev[cat] === key ? null : key };
      return next;
    });
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("save-food-selections", {
        body: { token, slot_key: slotKey, selections: sel },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`${label} saved`);
      onSaved({
        protein: sel.protein ?? null,
        carbs: sel.carbs ?? null,
        veg: sel.veg ?? null,
        fat: sel.fat ?? null,
      });
      setDirty(false);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{label}</h2>
      {empty ? (
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">No foods available for this meal yet.</p>
        </Card>
      ) : (
        <Card className="p-4 space-y-4">
          {CATEGORY_DEFS.map((c) => {
            const items = grouped[c.key];
            if (items.length === 0) return null;
            return (
              <div key={c.key} className="space-y-2">
                <p className="text-xs uppercase text-muted-foreground tracking-wide">{c.label}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {items.map((f) => {
                    const key = foodKey(f);
                    const selected = sel[c.key] === key;
                    return (
                      <button
                        type="button"
                        key={key}
                        onClick={() => toggle(c.key, key)}
                        className={cn(
                          "text-left rounded-md border p-3 transition-colors",
                          selected
                            ? "border-primary bg-primary/10 ring-1 ring-primary"
                            : "border-input hover:bg-accent",
                        )}
                      >
                        <p className="text-sm font-medium">{stripEstimated(f.name)}</p>
                        {f.portion && <p className="text-xs text-muted-foreground">{f.portion}</p>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <Button className="w-full" onClick={save} disabled={saving || !dirty}>
            {saving ? "Saving…" : dirty ? "Save meal selections" : "Saved"}
          </Button>
        </Card>
      )}
    </section>
  );
}
