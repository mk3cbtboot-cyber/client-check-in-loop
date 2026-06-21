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

export type FoodCategoryKind = "Protein" | "Carbs" | "Veg" | "Fat" | "Other";
export interface FoodItem {
  name: string;
  portion: string;
  category: FoodCategoryKind;
}
export type SlotKey = "breakfast" | "lunch" | "dinner";
export interface FoodList {
  breakfast: FoodItem[];
  lunch: FoodItem[];
  dinner: FoodItem[];
}
export interface FoodListNotes {
  breakfast: string;
  lunch: string;
  dinner: string;
}

const SLOTS: { key: SlotKey; label: string }[] = [
  { key: "breakfast", label: "Breakfast" },
  { key: "lunch", label: "Lunch" },
  { key: "dinner", label: "Dinner" },
];
const CATEGORIES: FoodCategoryKind[] = ["Protein", "Carbs", "Veg", "Fat", "Other"];

const EMPTY_LIST: FoodList = { breakfast: [], lunch: [], dinner: [] };
const EMPTY_NOTES: FoodListNotes = { breakfast: "", lunch: "", dinner: "" };

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
  return { breakfast: slot(r.breakfast), lunch: slot(r.lunch), dinner: slot(r.dinner) };
}
function normalizeNotes(raw: unknown): FoodListNotes {
  const r = (raw ?? {}) as Partial<Record<SlotKey, unknown>>;
  return {
    breakfast: typeof r.breakfast === "string" ? r.breakfast : "",
    lunch: typeof r.lunch === "string" ? r.lunch : "",
    dinner: typeof r.dinner === "string" ? r.dinner : "",
  };
}

interface Props {
  clientId: string;
  initialList: unknown;
  initialNotes: unknown;
}

export default function CustomFoodListEditor({ clientId, initialList, initialNotes }: Props) {
  const [list, setList] = useState<FoodList>(() => normalizeList(initialList));
  const [notes, setNotes] = useState<FoodListNotes>(() => normalizeNotes(initialNotes));

  useEffect(() => { setList(normalizeList(initialList)); }, [initialList]);
  useEffect(() => { setNotes(normalizeNotes(initialNotes)); }, [initialNotes]);

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

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">Meal Plan</h3>
        <span className="text-xs text-muted-foreground">Food-List</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {SLOTS.map((s) => (
          <SlotPanel
            key={s.key}
            label={s.label}
            items={list[s.key]}
            note={notes[s.key]}
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
  onItemsChange: (items: FoodItem[]) => void;
  onNoteBlur: (value: string) => void;
}

function SlotPanel({ label, items, note, onItemsChange, onNoteBlur }: SlotPanelProps) {
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

  function saveDraft() {
    const name = draftName.trim();
    const portion = draftPortion.trim();
    if (!name) { toast.error("Food name is required"); return; }
    if (!portion) { toast.error("Portion is required"); return; }
    const next: FoodItem = { name, portion, category: draftCategory };
    let updated: FoodItem[];
    if (editingIndex != null) {
      updated = items.map((it, i) => (i === editingIndex ? next : it));
    } else {
      updated = [...items, next];
    }
    onItemsChange(updated);
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
          No foods added yet. Use Add food to build this meal slot.
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
            <Button size="sm" onClick={saveDraft} className="h-7">
              {editingIndex != null ? "Save" : "Add"}
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
