import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Pencil, Trash2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { customSlotLabel } from "@/lib/meal-slots";
import MacroTracker, { type MacroSet } from "@/components/MacroTracker";

export type FoodCategoryKind = "Protein" | "Carbs" | "Veg" | "Fat" | "Other";
export interface FoodItem {
  name: string;
  portion: string;
  category: FoodCategoryKind;
  est_calories?: number;
  est_protein_g?: number;
  est_carbs_g?: number;
  est_fat_g?: number;
}
export type SlotKey = "breakfast" | "morning_snack" | "lunch" | "afternoon_snack" | "dinner";
export type FoodList = Record<SlotKey, FoodItem[]>;
export type FoodListNotes = Record<SlotKey, string>;

const ALL_SLOTS: { key: SlotKey; label: string }[] = [
  { key: "breakfast", label: "Breakfast" },
  { key: "morning_snack", label: "Morning Snack" },
  { key: "lunch", label: "Lunch" },
  { key: "afternoon_snack", label: "Afternoon Snack" },
  { key: "dinner", label: "Dinner" },
];
const CATEGORIES: FoodCategoryKind[] = ["Protein", "Carbs", "Veg", "Fat", "Other"];
function visibleSlotKeys(meals: number): SlotKey[] {
  if (meals === 5) return ["breakfast", "morning_snack", "lunch", "afternoon_snack", "dinner"];
  if (meals === 4) return ["breakfast", "lunch", "afternoon_snack", "dinner"];
  return ["breakfast", "lunch", "dinner"];
}

function normalizeList(raw: unknown): FoodList {
  const r = (raw ?? {}) as Partial<Record<SlotKey, unknown>>;
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  const slot = (v: unknown): FoodItem[] =>
    Array.isArray(v)
      ? v.map((x) => {
          const o = (x ?? {}) as Record<string, unknown>;
          return {
            name: String(o.name ?? ""),
            portion: String(o.portion ?? ""),
            category: (CATEGORIES.includes(o.category as FoodCategoryKind) ? o.category : "Other") as FoodCategoryKind,
            est_calories: num(o.est_calories),
            est_protein_g: num(o.est_protein_g),
            est_carbs_g: num(o.est_carbs_g),
            est_fat_g: num(o.est_fat_g),
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
function normalizeNotes(raw: unknown): FoodListNotes {
  const r = (raw ?? {}) as Partial<Record<SlotKey, unknown>>;
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    breakfast: s(r.breakfast),
    morning_snack: s(r.morning_snack),
    lunch: s(r.lunch),
    afternoon_snack: s(r.afternoon_snack),
    dinner: s(r.dinner),
  };
}

interface Props {
  clientId: string;
  initialList: unknown;
  initialNotes: unknown;
  initialMealsPerDay?: number;
  planFormat?: "food_list" | "food_list_generated";
  macros?: MacroSet | null;
  onGoToMacros?: () => void;
}

export async function estimateFoodMacros(name: string, portion: string): Promise<{ est_calories: number; est_protein_g: number; est_carbs_g: number; est_fat_g: number }> {
  try {
    const { data, error } = await supabase.functions.invoke("estimate-macros", {
      body: { items: [{ name, portion }] },
    });
    if (error) throw error;
    const m = (data as { items?: Array<{ calories?: number; protein_g?: number; carbs_g?: number; fat_g?: number }> })?.items?.[0];
    return {
      est_calories: Number(m?.calories) || 0,
      est_protein_g: Number(m?.protein_g) || 0,
      est_carbs_g: Number(m?.carbs_g) || 0,
      est_fat_g: Number(m?.fat_g) || 0,
    };
  } catch (e) {
    console.error("estimate-macros failed", e);
    return { est_calories: 0, est_protein_g: 0, est_carbs_g: 0, est_fat_g: 0 };
  }
}

export default function CustomFoodListEditor({ clientId, initialList, initialNotes, initialMealsPerDay, planFormat, macros }: Props) {
  const [list, setList] = useState<FoodList>(() => normalizeList(initialList));
  const [notes, setNotes] = useState<FoodListNotes>(() => normalizeNotes(initialNotes));
  const [mealsPerDay, setMealsPerDay] = useState<number>(() => {
    const v = Number(initialMealsPerDay ?? 3);
    return v === 4 || v === 5 ? v : 3;
  });

  useEffect(() => { setList(normalizeList(initialList)); }, [initialList]);
  useEffect(() => { setNotes(normalizeNotes(initialNotes)); }, [initialNotes]);
  useEffect(() => {
    const v = Number(initialMealsPerDay ?? 3);
    setMealsPerDay(v === 4 || v === 5 ? v : 3);
  }, [initialMealsPerDay]);

  async function saveList(next: FoodList) {
    const prev = list;
    setList(next);
    const { error } = await supabase.from("clients").update({ food_list: next } as never).eq("id", clientId);
    if (error) {
      setList(prev);
      toast.error("Failed to save food list");
    }
  }

  async function saveNotes(next: FoodListNotes) {
    const prev = notes;
    setNotes(next);
    const { error } = await supabase.from("clients").update({ food_list_notes: next } as never).eq("id", clientId);
    if (error) {
      setNotes(prev);
      toast.error("Failed to save notes");
    }
  }

  const visible = visibleSlotKeys(mealsPerDay);
  const slots = ALL_SLOTS.filter((s) => visible.includes(s.key));
  const gridCols = slots.length >= 5 ? "md:grid-cols-5" : slots.length === 4 ? "md:grid-cols-4" : "md:grid-cols-3";

  const used: MacroSet = visible.reduce(
    (acc, key) => {
      for (const it of list[key]) {
        acc.calories += Number(it.est_calories) || 0;
        acc.protein_g += Number(it.est_protein_g) || 0;
        acc.carbs_g += Number(it.est_carbs_g) || 0;
        acc.fat_g += Number(it.est_fat_g) || 0;
      }
      return acc;
    },
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 } as MacroSet,
  );

  return (
    <div className="space-y-3">
      {macros ? (
        <MacroTracker target={macros} used={used} />
      ) : (
        <p className="text-xs text-muted-foreground rounded-md border p-3">
          Add macro targets on the Macros / MPG tab to track progress here.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Meal Plan</h3>
        <span className="text-xs text-muted-foreground">Meal Plan</span>
      </div>
      <div className={`grid grid-cols-1 ${gridCols} gap-3`}>
        {slots.map((s) => (
          <SlotPanel
            key={s.key}
            label={customSlotLabel(s.key, mealsPerDay)}
            items={list[s.key]}
            note={notes[s.key]}
            emptyMessage={
              planFormat === "food_list_generated"
                ? "No foods added yet. Use Generate Meal Plan on the Macros / MPG tab to get started."
                : "No foods added yet. Use Add food to build this meal slot."
            }
            onItemsChange={(items) => saveList({ ...list, [s.key]: items })}
            onNoteBlur={(value) => {
              if (value === notes[s.key]) return;
              saveNotes({ ...notes, [s.key]: value });
            }}
          />
        ))}
      </div>


    </div>
  );
}

interface SlotPanelProps {
  label: string;
  items: FoodItem[];
  note: string;
  emptyMessage?: string;
  onItemsChange: (items: FoodItem[]) => void;
  onNoteBlur: (value: string) => void;
}

function SlotPanel({ label, items, note, emptyMessage, onItemsChange, onNoteBlur }: SlotPanelProps) {
  const [adding, setAdding] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftPortion, setDraftPortion] = useState("");
  const [draftCategory, setDraftCategory] = useState<FoodCategoryKind>("Protein");
  const [confirmRemoveIdx, setConfirmRemoveIdx] = useState<number | null>(null);
  const [localNote, setLocalNote] = useState(note);

  useEffect(() => { setLocalNote(note); }, [note]);

  function resetDraft() {
    setAdding(false);
    setEditingIndex(null);
    setDraftName("");
    setDraftPortion("");
    setDraftCategory("Protein");
  }

  function startAdd() {
    setEditingIndex(null);
    setDraftName("");
    setDraftPortion("");
    setDraftCategory("Protein");
    setAdding(true);
  }

  function startEdit(idx: number) {
    const it = items[idx];
    setAdding(false);
    setEditingIndex(idx);
    setDraftName(it.name);
    setDraftPortion(it.portion);
    setDraftCategory(it.category);
  }

  const [estimating, setEstimating] = useState(false);

  async function saveDraft() {
    const name = draftName.trim();
    const portion = draftPortion.trim();
    if (!name) { toast.error("Food name is required"); return; }
    if (!portion) { toast.error("Portion is required"); return; }
    setEstimating(true);
    const existing = editingIndex != null ? items[editingIndex] : null;
    const nameOrPortionChanged = !existing || existing.name !== name || existing.portion !== portion;
    let est = {
      est_calories: existing?.est_calories ?? 0,
      est_protein_g: existing?.est_protein_g ?? 0,
      est_carbs_g: existing?.est_carbs_g ?? 0,
      est_fat_g: existing?.est_fat_g ?? 0,
    };
    if (nameOrPortionChanged) {
      est = await estimateFoodMacros(name, portion);
    }
    const next: FoodItem = { name, portion, category: draftCategory, ...est };
    let updated: FoodItem[];
    if (editingIndex != null) {
      updated = items.map((it, i) => (i === editingIndex ? next : it));
    } else {
      updated = [...items, next];
    }
    onItemsChange(updated);
    setEstimating(false);
    resetDraft();
  }


  function removeAt(idx: number) {
    onItemsChange(items.filter((_, i) => i !== idx));
    setConfirmRemoveIdx(null);
  }

  const showForm = adding || editingIndex != null;

  return (
    <div className="rounded-md border p-3 space-y-3 bg-card">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">{label}</h4>
        {!showForm && (
          <Button size="sm" variant="outline" onClick={startAdd} className="h-7 px-2">
            <Plus className="h-3 w-3 mr-1" /> Add food
          </Button>
        )}
      </div>

      {items.length === 0 && !showForm && (
        <p className="text-xs text-muted-foreground">
          {emptyMessage ?? "No foods added yet. Use Add food to build this meal slot."}
        </p>
      )}

      {items.length > 0 && (
        <ul className="space-y-1.5">
          {items.map((it, idx) => (
            <li key={idx} className="flex items-start justify-between gap-2 rounded border p-2 text-xs">
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">{it.name}</p>
                <p className="text-muted-foreground">
                  {it.portion} · <span className="uppercase tracking-wide">{it.category}</span>
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => startEdit(idx)} aria-label="Edit food">
                  <Pencil className="h-3 w-3" />
                </Button>
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setConfirmRemoveIdx(idx)} aria-label="Remove food">
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {showForm && (
        <div className="space-y-2 rounded border bg-muted/30 p-2">
          <div className="space-y-1">
            <Label className="text-xs">Food name</Label>
            <Input value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="e.g. Chicken breast" className="h-8" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Portion</Label>
            <Input value={draftPortion} onChange={(e) => setDraftPortion(e.target.value)} placeholder="e.g. 150g, 1 cup, palm-sized" className="h-8" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Category</Label>
            <Select value={draftCategory} onValueChange={(v) => setDraftCategory(v as FoodCategoryKind)}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button size="sm" variant="ghost" onClick={resetDraft} className="h-7">
              <X className="h-3 w-3 mr-1" /> Cancel
            </Button>
            <Button size="sm" onClick={saveDraft} className="h-7" disabled={estimating}>
              {estimating ? "Estimating…" : editingIndex != null ? "Save" : "Add"}
            </Button>

          </div>
        </div>
      )}

      <div className="space-y-1">
        <Label className="text-xs">Notes (optional)</Label>
        <Textarea
          value={localNote}
          onChange={(e) => setLocalNote(e.target.value)}
          onBlur={() => onNoteBlur(localNote)}
          placeholder="Notes for this meal slot"
          className="min-h-[60px] text-xs"
        />
      </div>

      <AlertDialog open={confirmRemoveIdx != null} onOpenChange={(o) => !o && setConfirmRemoveIdx(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove food?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmRemoveIdx != null && items[confirmRemoveIdx]
                ? `Remove "${items[confirmRemoveIdx].name}" from ${label}? This cannot be undone.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmRemoveIdx != null && removeAt(confirmRemoveIdx)}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
