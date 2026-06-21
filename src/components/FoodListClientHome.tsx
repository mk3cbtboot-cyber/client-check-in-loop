import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";

type SlotKey = "breakfast" | "morning_snack" | "lunch" | "afternoon_snack" | "dinner";

interface FoodItem {
  name: string;
  portion: string;
  category: string;
}

interface RecipeOption {
  recipe_title: string;
  recipe: string[];
  method: string[];
  notes: string[];
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
  foodList: Record<string, FoodItem[]>;
  foodListNotes: Record<string, string>;
  mealsPerDay: number;
  onLogged: () => Promise<void> | void;
}

export default function FoodListClientHome({ token, foodList, foodListNotes, mealsPerDay, onLogged }: Props) {
  const slots = ALL_SLOTS.filter((s) => visibleSlotKeys(mealsPerDay).includes(s.key));
  return (
    <div className="space-y-5">
      {slots.map((s) => {
        const foods = Array.isArray(foodList?.[s.key]) ? foodList[s.key] : [];
        const note = typeof foodListNotes?.[s.key] === "string" ? foodListNotes[s.key] : "";
        return (
          <FoodListSlotSection
            key={s.key}
            token={token}
            slotKey={s.key}
            label={s.label}
            foods={foods}
            note={note}
            onLogged={onLogged}
          />
        );
      })}
    </div>
  );
}

interface SectionProps {
  token: string;
  slotKey: SlotKey;
  label: string;
  foods: FoodItem[];
  note: string;
  onLogged: () => Promise<void> | void;
}

function FoodListSlotSection({ token, slotKey, label, foods, note, onLogged }: SectionProps) {
  const [generating, setGenerating] = useState(false);
  const [options, setOptions] = useState<RecipeOption[]>([]);
  const [regenCount, setRegenCount] = useState(0);
  const [loggingIdx, setLoggingIdx] = useState<number | null>(null);
  const [fullScreenIdx, setFullScreenIdx] = useState<number | null>(null);
  const regenLimitReached = regenCount >= 1;

  const empty = foods.length === 0;

  const generate = async () => {
    if (empty) return;
    const isRegen = options.length > 0;
    if (isRegen && regenLimitReached) {
      toast.error("Regeneration limit reached for this meal slot.");
      return;
    }
    setGenerating(true);
    setOptions([]);
    try {
      const { data, error } = await supabase.functions.invoke("generate-foodlist-recipe", {
        body: { token, slot_key: slotKey },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const opts: RecipeOption[] = Array.isArray(data?.options) ? data.options : [];
      if (opts.length === 0) throw new Error("No recipes returned");
      setOptions(opts);
      if (isRegen) setRegenCount((n) => n + 1);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to generate");
    } finally {
      setGenerating(false);
    }
  };

  const logRecipe = async (idx: number, recipe: RecipeOption) => {
    setLoggingIdx(idx);
    try {
      const { data, error } = await supabase.functions.invoke("log-foodlist-meal", {
        body: { token, slot_key: slotKey, recipe },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Meal logged");
      setOptions([]);
      setFullScreenIdx(null);
      await onLogged();
    } catch (e: any) {
      toast.error(e.message ?? "Failed to log meal");
    } finally {
      setLoggingIdx(null);
    }
  };

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{label}</h2>

      {empty ? (
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">
            Your practitioner hasn't set up this meal yet. Check back soon.
          </p>
        </Card>
      ) : (
        <>
          <Card className="p-4 space-y-3">
            <div className="space-y-1">
              <p className="text-xs uppercase text-muted-foreground">Approved foods</p>
              <ul className="text-sm space-y-1">
                {foods.map((f, i) => (
                  <li key={i}>
                    <span className="font-medium">{f.name}</span>
                    {f.portion ? <> · {f.portion}</> : null}
                    {f.category ? <span className="text-muted-foreground"> · {f.category}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
            {note && (
              <p className="text-xs text-muted-foreground border-t pt-2">
                <span className="font-medium text-foreground">Note: </span>{note}
              </p>
            )}
            <Button onClick={generate} disabled={generating} className="w-full">
              {generating ? "Generating recipes…" : "Generate Recipes"}
            </Button>
          </Card>

          {options.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">{options.length} recipe options</p>
                <Button size="sm" variant="outline" onClick={generate} disabled={generating || regenLimitReached}>
                  {regenLimitReached ? "No regenerations left" : "Generate new options"}
                </Button>
              </div>
              <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 -mx-4 px-4">
                {options.map((r, idx) => (
                  <Card key={idx} className="p-4 shrink-0 w-[85%] sm:w-[420px] snap-start">
                    <p className="font-medium mb-3">Option {idx + 1}: {r.recipe_title}</p>
                    <Tabs defaultValue="recipe">
                      <TabsList>
                        <TabsTrigger value="recipe">Recipe</TabsTrigger>
                        <TabsTrigger value="method">Method</TabsTrigger>
                        <TabsTrigger value="notes">Notes</TabsTrigger>
                      </TabsList>
                      <TabsContent value="recipe" className="pt-3">
                        <ul className="list-disc list-inside text-sm space-y-1">
                          {r.recipe.map((x, i) => <li key={i}>{x}</li>)}
                        </ul>
                      </TabsContent>
                      <TabsContent value="method" className="pt-3">
                        <div className="text-sm space-y-2">
                          {r.method.map((s, i) => <p key={i}>{s}</p>)}
                        </div>
                      </TabsContent>
                      <TabsContent value="notes" className="pt-3">
                        <ul className="list-disc list-inside text-sm space-y-1">
                          {r.notes.map((n, i) => <li key={i}>{n}</li>)}
                        </ul>
                      </TabsContent>
                    </Tabs>
                    <Button
                      className="w-full mt-3"
                      disabled={loggingIdx !== null}
                      onClick={() => setFullScreenIdx(idx)}
                    >
                      Select this recipe
                    </Button>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {fullScreenIdx !== null && options[fullScreenIdx] && (() => {
        const r = options[fullScreenIdx];
        return (
          <div className="fixed inset-0 z-50 bg-background flex flex-col">
            <div className="flex items-center gap-3 p-4 border-b shrink-0">
              <Button variant="ghost" size="icon" onClick={() => setFullScreenIdx(null)} aria-label="Back">
                <ArrowLeft />
              </Button>
              <p className="font-semibold text-base truncate">{r.recipe_title}</p>
            </div>
            <div className="flex-1 overflow-y-auto p-4 pb-28">
              <Tabs defaultValue="recipe">
                <TabsList className="w-full">
                  <TabsTrigger value="recipe" className="flex-1">Recipe</TabsTrigger>
                  <TabsTrigger value="method" className="flex-1">Method</TabsTrigger>
                  <TabsTrigger value="notes" className="flex-1">Notes</TabsTrigger>
                </TabsList>
                <TabsContent value="recipe" className="pt-3">
                  <ul className="list-disc list-inside text-sm space-y-1">
                    {r.recipe.map((x, i) => <li key={i}>{x}</li>)}
                  </ul>
                </TabsContent>
                <TabsContent value="method" className="pt-3">
                  <div className="text-sm space-y-2">
                    {r.method.map((s, i) => <p key={i}>{s}</p>)}
                  </div>
                </TabsContent>
                <TabsContent value="notes" className="pt-3">
                  <ul className="list-disc list-inside text-sm space-y-1">
                    {r.notes.map((n, i) => <li key={i}>{n}</li>)}
                  </ul>
                </TabsContent>
              </Tabs>
            </div>
            <div className="fixed bottom-0 left-0 right-0 p-4 border-t bg-background">
              <Button
                className="w-full"
                disabled={loggingIdx !== null}
                onClick={() => logRecipe(fullScreenIdx, r)}
              >
                {loggingIdx === fullScreenIdx ? "Logging…" : "I Ate This"}
              </Button>
            </div>
          </div>
        );
      })()}
    </section>
  );
}
