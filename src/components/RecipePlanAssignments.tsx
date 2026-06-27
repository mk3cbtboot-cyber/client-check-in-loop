import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BookOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import RecipeLibrary from "./RecipeLibrary";
import { customSlotLabel } from "@/lib/meal-slots";
import MacroTracker, { type MacroSet } from "@/components/MacroTracker";


type SlotKey = "breakfast" | "morning_snack" | "lunch" | "afternoon_snack" | "dinner";
type RecipeSlot = SlotKey | "any";
type Ingredient = { food: string; amount: string };

type Recipe = {
  id: string;
  name: string;
  ingredients: Ingredient[];
  method: string;
  default_slot: RecipeSlot;
};

type Assignment = {
  id: string;
  client_id: string;
  recipe_id: string;
  meal_slot: SlotKey;
  portion_overrides: Ingredient[] | null;
  est_macros: MacroSet | null;
};

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

export default function RecipePlanAssignments({
  clientId,
  mealsPerDay,
  macros,
}: {
  clientId: string;
  mealsPerDay: number;
  macros?: MacroSet | null;
}) {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(false);

  const [pickerSlot, setPickerSlot] = useState<SlotKey | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [portionStage, setPortionStage] = useState<{
    slot: SlotKey;
    recipe: Recipe;
    overrides: Ingredient[];
    existingId?: string;
  } | null>(null);


  const load = async () => {
    setLoading(true);
    const [{ data: rData, error: rErr }, { data: aData, error: aErr }] = await Promise.all([
      supabase.from("practitioner_recipes" as never).select("*").order("name"),
      supabase
        .from("client_recipe_assignments" as never)
        .select("*")
        .eq("client_id", clientId),
    ]);
    setLoading(false);
    if (rErr) toast.error(rErr.message);
    if (aErr) toast.error(aErr.message);
    setRecipes(((rData as unknown) as Recipe[]) ?? []);
    setAssignments(((aData as unknown) as Assignment[]) ?? []);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const slots = useMemo(
    () => ALL_SLOTS.filter((s) => visibleSlotKeys(mealsPerDay).includes(s.key)),
    [mealsPerDay],
  );

  const recipesById = useMemo(() => {
    const m = new Map<string, Recipe>();
    recipes.forEach((r) => m.set(r.id, r));
    return m;
  }, [recipes]);

  const assignmentsBySlot = useMemo(() => {
    const m = new Map<SlotKey, Assignment[]>();
    assignments.forEach((a) => {
      const arr = m.get(a.meal_slot) ?? [];
      arr.push(a);
      m.set(a.meal_slot, arr);
    });
    return m;
  }, [assignments]);

  const openPicker = (slot: SlotKey) => setPickerSlot(slot);

  const pickRecipe = (recipe: Recipe) => {
    if (!pickerSlot) return;
    setPortionStage({
      slot: pickerSlot,
      recipe,
      overrides: recipe.ingredients.map((i) => ({ ...i })),
    });
    setPickerSlot(null);
  };

  const openEdit = (a: Assignment) => {
    const recipe = recipesById.get(a.recipe_id);
    if (!recipe) return toast.error("Recipe not found");
    const base = recipe.ingredients.map((i) => {
      const ov = a.portion_overrides?.find((o) => o.food === i.food);
      return { food: i.food, amount: ov?.amount ?? i.amount };
    });
    setPortionStage({ slot: a.meal_slot, recipe, overrides: base, existingId: a.id });
  };

  const savePortions = async (useDefaults: boolean) => {
    if (!portionStage) return;
    const { slot, recipe, overrides, existingId } = portionStage;

    let portion_overrides: Ingredient[] | null = null;
    if (!useDefaults) {
      const changed = overrides.filter((ov) => {
        const def = recipe.ingredients.find((i) => i.food === ov.food);
        return def && def.amount !== ov.amount;
      });
      portion_overrides = changed.length > 0 ? changed : null;
    }

    if (existingId) {
      const { error } = await supabase
        .from("client_recipe_assignments" as never)
        .update({ portion_overrides } as never)
        .eq("id", existingId);
      if (error) return toast.error(error.message);
      toast.success("Portions updated");
    } else {
      const { error } = await supabase.from("client_recipe_assignments" as never).insert({
        client_id: clientId,
        recipe_id: recipe.id,
        meal_slot: slot,
        portion_overrides,
      } as never);
      if (error) return toast.error(error.message);
      toast.success("Recipe assigned");
    }
    setPortionStage(null);
    void load();
  };

  const unassign = async (a: Assignment) => {
    const { error } = await supabase
      .from("client_recipe_assignments" as never)
      .delete()
      .eq("id", a.id);
    if (error) return toast.error(error.message);
    toast.success("Recipe removed");
    void load();
  };

  const eligibleRecipes = (slot: SlotKey) =>
    recipes.filter((r) => r.default_slot === slot || r.default_slot === "any");

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Assigned Recipes</p>
          <p className="text-xs text-muted-foreground">
            Assign recipes from your library to each meal slot. Override portions per client as needed.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setLibraryOpen(true)}>
          <BookOpen className="h-4 w-4" /> Recipe Library
        </Button>
      </div>

      <RecipeLibrary
        open={libraryOpen}
        onOpenChange={(v) => {
          setLibraryOpen(v);
          if (!v) void load();
        }}
      />


      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-3">
          {slots.map((s) => {
            const list = assignmentsBySlot.get(s.key) ?? [];
            return (
              <Card key={s.key} className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-sm">{customSlotLabel(s.key, mealsPerDay)}</p>
                  <Button size="sm" variant="outline" onClick={() => openPicker(s.key)}>
                    <Plus className="h-4 w-4" /> Assign recipe
                  </Button>
                </div>
                {list.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No recipes assigned to this slot yet. Use Assign recipe to add one.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {list.map((a) => {
                      const r = recipesById.get(a.recipe_id);
                      return (
                        <div
                          key={a.id}
                          className="flex items-center gap-2 rounded-md border p-2"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">
                              {r?.name ?? "Unknown recipe"}
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              {customSlotLabel(s.key, mealsPerDay)}
                              {a.portion_overrides && a.portion_overrides.length > 0
                                ? ` · ${a.portion_overrides.length} portion override${a.portion_overrides.length === 1 ? "" : "s"}`
                                : ""}
                            </p>
                          </div>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label="Edit portions"
                            onClick={() => openEdit(a)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label="Remove"
                            onClick={() => unassign(a)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Recipe picker */}
      <Dialog open={!!pickerSlot} onOpenChange={(v) => !v && setPickerSlot(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Assign recipe — {pickerSlot ? customSlotLabel(pickerSlot, mealsPerDay) : ""}
            </DialogTitle>
          </DialogHeader>
          {pickerSlot && (() => {
            const list = eligibleRecipes(pickerSlot);
            if (list.length === 0) {
              return (
                <p className="text-sm text-muted-foreground">
                  No recipes in your library match this slot. Add one in Recipe Library.
                </p>
              );
            }
            return (
              <div className="space-y-2">
                {list.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => pickRecipe(r)}
                    className="w-full text-left rounded-md border p-3 hover:bg-accent transition-colors"
                  >
                    <p className="font-medium text-sm">{r.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Default: {r.default_slot === "any" ? "Any" : customSlotLabel(r.default_slot as SlotKey)} ·{" "}
                      {r.ingredients.length} ingredient{r.ingredients.length === 1 ? "" : "s"}
                    </p>
                  </button>
                ))}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Portion review */}
      <Dialog open={!!portionStage} onOpenChange={(v) => !v && setPortionStage(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {portionStage?.existingId ? "Edit portions" : "Review portions"} —{" "}
              {portionStage?.recipe.name}
            </DialogTitle>
          </DialogHeader>
          {portionStage && (
            <div className="space-y-2">
              {portionStage.recipe.ingredients.length === 0 ? (
                <p className="text-sm text-muted-foreground">This recipe has no ingredients.</p>
              ) : (
                portionStage.recipe.ingredients.map((ing, i) => (
                  <div key={i} className="grid grid-cols-[1fr_auto_140px] items-center gap-2">
                    <p className="text-sm truncate">{ing.food}</p>
                    <span className="text-xs text-muted-foreground">
                      default {ing.amount || "—"}
                    </span>
                    <Input
                      value={portionStage.overrides[i]?.amount ?? ""}
                      onChange={(e) =>
                        setPortionStage((s) =>
                          s
                            ? {
                                ...s,
                                overrides: s.overrides.map((o, idx) =>
                                  idx === i ? { ...o, amount: e.target.value } : o,
                                ),
                              }
                            : s,
                        )
                      }
                    />
                  </div>
                ))
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            {!portionStage?.existingId && (
              <Button variant="outline" onClick={() => savePortions(true)}>
                Skip — use default amounts
              </Button>
            )}
            <Button onClick={() => savePortions(false)}>
              {portionStage?.existingId ? "Save changes" : "Save assignment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
