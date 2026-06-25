import { useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { customSlotLabel } from "@/lib/meal-slots";

type SlotKey = "breakfast" | "morning_snack" | "lunch" | "afternoon_snack" | "dinner";

export interface RecipeAssignment {
  id: string;
  meal_slot: string;
  recipe_id: string;
  name: string;
  ingredients: Array<{ food: string; amount: string }>;
  method: string;
  notes?: string;
}

const ALL_SLOTS: { key: SlotKey; label: string }[] = [
  { key: "breakfast", label: "Breakfast" },
  { key: "morning_snack", label: "Morning Snack" },
  { key: "lunch", label: "Lunch" },
  { key: "afternoon_snack", label: "Afternoon Snack" },
  { key: "dinner", label: "Dinner" },
];

function visibleSlotKeys(meals: number): SlotKey[] {
  if (meals === 5) return ["breakfast", "morning_snack", "lunch", "afternoon_snack", "dinner"];
  if (meals === 4) return ["breakfast", "lunch", "afternoon_snack", "dinner"];
  return ["breakfast", "lunch", "dinner"];
}

interface Props {
  token: string;
  assignments: RecipeAssignment[];
  mealsPerDay: number;
  onLogged: () => Promise<void> | void;
}

export default function RecipePlanClientHome({ token, assignments, mealsPerDay, onLogged }: Props) {
  const [open, setOpen] = useState<RecipeAssignment | null>(null);
  const [logging, setLogging] = useState(false);

  const bySlot = useMemo(() => {
    const m = new Map<string, RecipeAssignment[]>();
    for (const a of assignments) {
      const arr = m.get(a.meal_slot) ?? [];
      arr.push(a);
      m.set(a.meal_slot, arr);
    }
    return m;
  }, [assignments]);

  const slots = ALL_SLOTS.filter((s) => visibleSlotKeys(mealsPerDay).includes(s.key));

  const logIt = async () => {
    if (!open) return;
    setLogging(true);
    try {
      const { data, error } = await supabase.functions.invoke("log-recipe-meal", {
        body: { token, assignment_id: open.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Meal logged");
      setOpen(null);
      await onLogged();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to log meal";
      toast.error(msg);
    } finally {
      setLogging(false);
    }
  };

  const methodSteps = (m: string): string[] =>
    (m || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

  return (
    <div className="space-y-5">
      {slots.map((s) => {
        const list = bySlot.get(s.key) ?? [];
        return (
          <section key={s.key} className="space-y-3">
            <h2 className="text-lg font-semibold">{customSlotLabel(s.key, mealsPerDay)}</h2>
            {list.length === 0 ? (
              <Card className="p-4">
                <p className="text-sm text-muted-foreground">
                  Your practitioner hasn't set up this meal yet. Check back soon.
                </p>
              </Card>
            ) : (
              <div className="space-y-2">
                {list.map((a) => (
                  <Card
                    key={a.id}
                    className="p-4 cursor-pointer hover:bg-accent/50 transition-colors"
                    onClick={() => setOpen(a)}
                  >
                    <p className="font-medium">{a.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.ingredients.length} ingredient{a.ingredients.length === 1 ? "" : "s"}
                    </p>
                  </Card>
                ))}
              </div>
            )}
          </section>
        );
      })}

      {open && (
        <div className="fixed inset-0 z-50 bg-background flex flex-col">
          <div className="flex items-center gap-3 p-4 border-b shrink-0">
            <Button variant="ghost" size="icon" onClick={() => setOpen(null)} aria-label="Back">
              <ArrowLeft />
            </Button>
            <p className="font-semibold text-base truncate">{open.name}</p>
          </div>
          <div className="flex-1 overflow-y-auto p-4 pb-28 space-y-5">
            <div>
              <p className="text-xs uppercase text-muted-foreground mb-2">Ingredients</p>
              {open.ingredients.length === 0 ? (
                <p className="text-sm text-muted-foreground">No ingredients listed.</p>
              ) : (
                <ul className="text-sm space-y-1 list-disc list-inside">
                  {open.ingredients.map((i, idx) => (
                    <li key={idx}>
                      <span className="font-medium">{i.food}</span>
                      {i.amount ? <> · {i.amount}</> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground mb-2">Method</p>
              {methodSteps(open.method).length === 0 ? (
                <p className="text-sm text-muted-foreground">No method provided.</p>
              ) : (
                <ol className="text-sm space-y-2 list-decimal list-inside">
                  {methodSteps(open.method).map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              )}
            </div>
          </div>
          <div className="fixed bottom-0 left-0 right-0 p-4 border-t bg-background">
            <Button className="w-full" disabled={logging} onClick={logIt}>
              {logging ? "Logging…" : "I Ate This"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
