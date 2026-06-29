import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Sparkles, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { customSlotLabel } from "@/lib/meal-slots";

type FoodCategoryKind = "Protein" | "Carbs" | "Veg" | "Fat" | "Other";
interface FoodItem { name: string; portion: string; category: FoodCategoryKind }
type SlotKey = "breakfast" | "morning_snack" | "lunch" | "afternoon_snack" | "dinner";
type FoodList = Record<SlotKey, FoodItem[]>;

interface MacroSet { calories: number; protein_g: number; carbs_g: number; fat_g: number }

const CATEGORIES: FoodCategoryKind[] = ["Protein", "Carbs", "Veg", "Fat", "Other"];

function emptyList(): FoodList {
  return { breakfast: [], morning_snack: [], lunch: [], afternoon_snack: [], dinner: [] };
}
function activeSlots(meals: number): SlotKey[] {
  if (meals === 5) return ["breakfast", "morning_snack", "lunch", "afternoon_snack", "dinner"];
  if (meals === 4) return ["breakfast", "lunch", "afternoon_snack", "dinner"];
  return ["breakfast", "lunch", "dinner"];
}
function normalizeList(raw: unknown): FoodList {
  const r = (raw ?? {}) as Partial<Record<SlotKey, unknown>>;
  const slot = (v: unknown): FoodItem[] =>
    Array.isArray(v)
      ? v.map((x) => {
          const o = (x ?? {}) as Record<string, unknown>;
          return {
            name: String(o.name ?? ""),
            portion: String(o.portion ?? ""),
            category: (CATEGORIES.includes(o.category as FoodCategoryKind) ? o.category : "Other") as FoodCategoryKind,
          };
        })
      : [];
  return {
    breakfast: slot(r.breakfast),
    morning_snack: slot(r.morning_snack),
    lunch: slot(r.lunch),
    afternoon_snack: slot(r.afternoon_snack),
    dinner: slot(r.dinner),
  };
}

export const GENERATE_MEAL_PLAN_SECTION_ID = "generate-meal-plan-section";

type MealKey = "meal_1" | "meal_2" | "meal_3" | "meal_4" | "meal_5";
type Allocation = Partial<Record<MealKey, { calories: number; protein_g: number; carbs_g: number; fat_g: number }>>;

interface Props {
  clientId: string;
  macros: MacroSet | null;
  mealsPerDay: number;
  foodExclusions: string[] | null;
  existingList: unknown;
  macroAllocation?: Allocation | null;
  onSaved?: () => void;
  onClientPatched?: (patch: { meals_per_day?: number; food_exclusions?: string[] }) => void;
}

export default function FoodListPlanGenerator({ clientId, macros, mealsPerDay, foodExclusions, existingList, macroAllocation, onSaved, onClientPatched }: Props) {
  const [generating, setGenerating] = useState(false);

  const defaultMeals = [3, 4, 5].includes(Number(mealsPerDay)) ? Number(mealsPerDay) : 3;
  const meals = defaultMeals;
  const [exclusionsText, setExclusionsText] = useState((foodExclusions ?? []).join(", "));
  const [preferences, setPreferences] = useState("");

  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewList, setReviewList] = useState<FoodList>(emptyList());
  const [confirmReplaceOpen, setConfirmReplaceOpen] = useState(false);

  useEffect(() => { setExclusionsText((foodExclusions ?? []).join(", ")); }, [foodExclusions]);

  const hasMacros = !!macros && Number(macros.calories) > 0;

  function parseExclusions(text: string): string[] {
    return text.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  }

  async function persistExclusions() {
    const arr = parseExclusions(exclusionsText);
    const { error } = await supabase.from("clients").update({ food_exclusions: arr } as never).eq("id", clientId);
    if (error) { toast.error("Failed to save exclusions"); return; }
    onClientPatched?.({ food_exclusions: arr });
  }

  async function handleGenerate() {
    if (!hasMacros || !macros) return;
    const exclusions = parseExclusions(exclusionsText);
    // Persist exclusion edits to the client record as well
    await persistExclusions();
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-foodlist-plan", {
        body: {
          macros: {
            calories: macros.calories,
            protein_g: macros.protein_g,
            carbs_g: macros.carbs_g,
            fat_g: macros.fat_g,
          },
          meals_per_day: meals,
          macro_allocation: macroAllocation ?? null,
          exclusions,
          preferences,
        },
      });
      if (error || !data?.ok || !data?.food_list) {
        toast.error(data?.error || "Failed to generate meal plan. Please try again.");
        return;
      }
      setReviewList(normalizeList(data.food_list));
      setReviewOpen(true);
    } catch (e) {
      console.error(e);
      toast.error("Failed to generate meal plan.");
    } finally {
      setGenerating(false);
    }
  }

  function reviewTotal(): number {
    return (Object.keys(reviewList) as SlotKey[]).reduce((n, k) => n + reviewList[k].length, 0);
  }
  function existingTotal(): number {
    const l = normalizeList(existingList);
    return (Object.keys(l) as SlotKey[]).reduce((n, k) => n + l[k].length, 0);
  }

  function onConfirmReview() {
    if (reviewTotal() === 0) { toast.error("Nothing to save."); return; }
    if (existingTotal() > 0) { setConfirmReplaceOpen(true); return; }
    void doSave();
  }

  async function doSave() {
    setConfirmReplaceOpen(false);
    const { error } = await supabase.from("clients").update({ food_list: reviewList } as never).eq("id", clientId);
    if (error) { toast.error("Failed to save meal plan"); return; }
    setReviewOpen(false);
    toast.success("Meal plan saved.");
    onSaved?.();
  }

  return (
    <>
      <Card id={GENERATE_MEAL_PLAN_SECTION_ID} className="p-4 space-y-4 scroll-mt-20">
        <div>
          <p className="font-medium">Generate Meal Plan</p>
          <p className="text-xs text-muted-foreground">
            Generate a full food list per meal slot using the client's macros, exclusions, and preferences.
          </p>
        </div>

        {!hasMacros && (
          <p className="text-xs text-destructive rounded-md border border-destructive/30 bg-destructive/5 p-2">
            No macro targets saved for this client. Calculate and save macros above first.
          </p>
        )}

        <div className="space-y-1">
          <Label>Food exclusions</Label>
          <Textarea
            value={exclusionsText}
            onChange={(e) => setExclusionsText(e.target.value)}
            onBlur={() => { void persistExclusions(); }}
            placeholder="Comma-separated (e.g. peanuts, shellfish, dairy)"
            className="min-h-[60px]"
          />
          <p className="text-xs text-muted-foreground">
            Edits here also update the client's saved exclusions.
          </p>
        </div>

        <div className="space-y-1">
          <Label>Additional preferences (optional)</Label>
          <Textarea
            value={preferences}
            onChange={(e) => setPreferences(e.target.value)}
            placeholder='e.g. "high fibre", "Mediterranean style", "easy to prepare"'
            className="min-h-[60px]"
          />
          <p className="text-xs text-muted-foreground">Not saved between sessions.</p>
        </div>

        <div>
          <Button onClick={handleGenerate} disabled={!hasMacros || generating}>
            {generating ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />}
            {generating ? "Generating…" : "Generate"}
          </Button>
        </div>
      </Card>

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review generated meal plan</DialogTitle>
            <DialogDescription>
              Remove or edit anything that doesn't look right, then save to the client's meal plan.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {activeSlots(meals).map((k) => (
              <ReviewSlot
                key={k}
                label={customSlotLabel(k, meals)}
                items={reviewList[k]}
                onChange={(items) => setReviewList((prev) => ({ ...prev, [k]: items }))}
              />
            ))}
            {reviewTotal() === 0 && (
              <p className="text-sm text-muted-foreground">No foods remaining. Cancel and try again.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewOpen(false)}>Cancel</Button>
            <Button onClick={onConfirmReview} disabled={reviewTotal() === 0}>Save to Meal Plan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmReplaceOpen} onOpenChange={setConfirmReplaceOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace existing meal plan?</AlertDialogTitle>
            <AlertDialogDescription>
              This will replace the existing food list for this client. Are you sure?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void doSave()}>Replace</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ReviewSlot({ label, items, onChange }: { label: string; items: FoodItem[]; onChange: (items: FoodItem[]) => void }) {
  const [adding, setAdding] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [dName, setDName] = useState("");
  const [dPortion, setDPortion] = useState("");
  const [dCat, setDCat] = useState<FoodCategoryKind>("Protein");

  function reset() { setAdding(false); setEditingIdx(null); setDName(""); setDPortion(""); setDCat("Protein"); }
  function startAdd() { reset(); setAdding(true); }
  function startEdit(i: number) {
    const it = items[i];
    setAdding(false); setEditingIdx(i); setDName(it.name); setDPortion(it.portion); setDCat(it.category);
  }
  function save() {
    const name = dName.trim(); const portion = dPortion.trim();
    if (!name) { toast.error("Food name is required"); return; }
    if (!portion) { toast.error("Portion is required"); return; }
    const next: FoodItem = { name, portion, category: dCat };
    const updated = editingIdx != null ? items.map((it, i) => (i === editingIdx ? next : it)) : [...items, next];
    onChange(updated);
    reset();
  }
  const showForm = adding || editingIdx != null;

  return (
    <div className="rounded-md border p-3">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold">{label}</h4>
        {!showForm && (
          <Button size="sm" variant="outline" className="h-7 px-2" onClick={startAdd}>
            <Plus className="h-3 w-3 mr-1" /> Add food
          </Button>
        )}
      </div>
      {items.length === 0 && !showForm && (
        <p className="text-xs text-muted-foreground">No foods for this slot.</p>
      )}
      {items.length > 0 && (
        <ul className="space-y-1.5">
          {items.map((it, idx) => (
            <li key={idx} className="flex items-start justify-between gap-2 rounded border p-2 text-xs">
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">{it.name}</p>
                <p className="text-muted-foreground">{it.portion} · <span className="uppercase tracking-wide">{it.category}</span></p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => startEdit(idx)} aria-label="Edit food"><Pencil className="h-3 w-3" /></Button>
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => onChange(items.filter((_, i) => i !== idx))} aria-label="Remove food"><Trash2 className="h-3 w-3" /></Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {showForm && (
        <div className="mt-2 space-y-2 rounded border bg-muted/30 p-2">
          <div className="space-y-1">
            <Label className="text-xs">Food name</Label>
            <Input value={dName} onChange={(e) => setDName(e.target.value)} className="h-8" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Portion</Label>
            <Input value={dPortion} onChange={(e) => setDPortion(e.target.value)} className="h-8" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Category</Label>
            <Select value={dCat} onValueChange={(v) => setDCat(v as FoodCategoryKind)}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" className="h-7" onClick={reset}><X className="h-3 w-3 mr-1" />Cancel</Button>
            <Button size="sm" className="h-7" onClick={save}>{editingIdx != null ? "Save" : "Add"}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
