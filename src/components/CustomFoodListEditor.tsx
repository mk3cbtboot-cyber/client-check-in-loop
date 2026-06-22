import { useEffect, useRef, useState } from "react";
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
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Pencil, Trash2, Plus, X, Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";

export type FoodCategoryKind = "Protein" | "Carbs" | "Veg" | "Fat" | "Other";
export interface FoodItem {
  name: string;
  portion: string;
  category: FoodCategoryKind;
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
const SLOT_LABEL: Record<SlotKey, string> = {
  breakfast: "Breakfast",
  morning_snack: "Morning Snack",
  lunch: "Lunch",
  afternoon_snack: "Afternoon Snack",
  dinner: "Dinner",
};

function visibleSlotKeys(meals: number): SlotKey[] {
  if (meals === 5) return ["breakfast", "morning_snack", "lunch", "afternoon_snack", "dinner"];
  if (meals === 4) return ["breakfast", "lunch", "afternoon_snack", "dinner"];
  return ["breakfast", "lunch", "dinner"];
}

function emptyList(): FoodList {
  return { breakfast: [], morning_snack: [], lunch: [], afternoon_snack: [], dinner: [] };
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
}

export default function CustomFoodListEditor({ clientId, initialList, initialNotes, initialMealsPerDay }: Props) {
  const [list, setList] = useState<FoodList>(() => normalizeList(initialList));
  const [notes, setNotes] = useState<FoodListNotes>(() => normalizeNotes(initialNotes));
  const [mealsPerDay, setMealsPerDay] = useState<number>(() => {
    const v = Number(initialMealsPerDay ?? 3);
    return v === 4 || v === 5 ? v : 3;
  });
  const [pendingMeals, setPendingMeals] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewList, setReviewList] = useState<FoodList>(emptyList());
  const [confirmReplaceOpen, setConfirmReplaceOpen] = useState(false);

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

  async function saveMealsPerDay(next: number) {
    const prev = mealsPerDay;
    setMealsPerDay(next);
    const { error } = await supabase.from("clients").update({ meals_per_day: next } as never).eq("id", clientId);
    if (error) {
      setMealsPerDay(prev);
      toast.error("Failed to update meals per day");
    }
  }

  function requestMealsChange(nextStr: string) {
    const next = Number(nextStr);
    if (next === mealsPerDay) return;
    const currentVisible = new Set(visibleSlotKeys(mealsPerDay));
    const nextVisible = new Set(visibleSlotKeys(next));
    const willHide: SlotKey[] = [];
    for (const k of currentVisible) if (!nextVisible.has(k)) willHide.push(k);
    const hasHiddenContent = willHide.some((k) => list[k].length > 0 || notes[k].trim() !== "");
    if (next < mealsPerDay && hasHiddenContent) {
      setPendingMeals(next);
      return;
    }
    void saveMealsPerDay(next);
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".pdf") && !lower.endsWith(".docx")) {
      toast.error("Only .docx or .pdf files are supported.");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      toast.error("File too large (max 15MB).");
      return;
    }
    setImporting(true);
    try {
      const data_base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const r = reader.result;
          if (typeof r === "string") resolve(r.split(",")[1] ?? "");
          else reject(new Error("read failed"));
        };
        reader.onerror = () => reject(reader.error ?? new Error("read failed"));
        reader.readAsDataURL(file);
      });
      const { data, error } = await supabase.functions.invoke("parse-foodlist-document", {
        body: { filename: file.name, mime: file.type || (lower.endsWith(".pdf") ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), data_base64 },
      });
      if (error || !data?.ok || !data?.food_list) {
        toast.error("We couldn't extract a food list from this document. Check that the document contains a meal plan with foods listed by meal, then try again. You can also add foods manually using the Add food button.");
        return;
      }
      setReviewList(normalizeList(data.food_list));
      setReviewOpen(true);
    } catch (err) {
      console.error(err);
      toast.error("We couldn't extract a food list from this document. Check that the document contains a meal plan with foods listed by meal, then try again. You can also add foods manually using the Add food button.");
    } finally {
      setImporting(false);
    }
  }

  function reviewRemove(slot: SlotKey, idx: number) {
    setReviewList((prev) => ({ ...prev, [slot]: prev[slot].filter((_, i) => i !== idx) }));
  }

  function reviewTotal(): number {
    return (Object.keys(reviewList) as SlotKey[]).reduce((n, k) => n + reviewList[k].length, 0);
  }

  function existingTotal(): number {
    return (Object.keys(list) as SlotKey[]).reduce((n, k) => n + list[k].length, 0);
  }

  function onConfirmReview() {
    if (reviewTotal() === 0) {
      toast.error("Nothing to save.");
      return;
    }
    if (existingTotal() > 0) {
      setConfirmReplaceOpen(true);
      return;
    }
    void doSaveImport();
  }

  async function doSaveImport() {
    setConfirmReplaceOpen(false);
    await saveList(reviewList);
    setReviewOpen(false);
    toast.success("Food list imported.");
  }

  const visible = visibleSlotKeys(mealsPerDay);
  const slots = ALL_SLOTS.filter((s) => visible.includes(s.key));
  const gridCols = slots.length >= 5 ? "md:grid-cols-5" : slots.length === 4 ? "md:grid-cols-4" : "md:grid-cols-3";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Meal Plan</h3>
        <span className="text-xs text-muted-foreground">Food-List</span>
        <div className="ml-auto flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={handleFileSelected}
          />
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            disabled={importing}
            onClick={() => fileInputRef.current?.click()}
          >
            {importing ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Upload className="h-3 w-3 mr-1" />}
            {importing ? "Parsing…" : "Import from document"}
          </Button>
          <Label className="text-xs">Meals per day</Label>
          <Select value={String(mealsPerDay)} onValueChange={requestMealsChange}>
            <SelectTrigger className="h-8 w-20"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="3">3</SelectItem>
              <SelectItem value="4">4</SelectItem>
              <SelectItem value="5">5</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className={`grid grid-cols-1 ${gridCols} gap-3`}>
        {slots.map((s) => (
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

      <AlertDialog open={pendingMeals != null} onOpenChange={(o) => !o && setPendingMeals(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reduce meals per day?</AlertDialogTitle>
            <AlertDialogDescription>
              This will hide the Afternoon Snack and Morning Snack slots. Any foods added to those slots will be saved but not visible to the client. Are you sure?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingMeals != null) void saveMealsPerDay(pendingMeals);
                setPendingMeals(null);
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review imported foods</DialogTitle>
            <DialogDescription>
              Review the imported foods below. You can remove anything that doesn't look right and edit further after saving.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {(Object.keys(SLOT_LABEL) as SlotKey[]).map((k) => {
              const items = reviewList[k];
              if (!items || items.length === 0) return null;
              return (
                <div key={k} className="rounded-md border p-3">
                  <h4 className="text-sm font-semibold mb-2">{SLOT_LABEL[k]}</h4>
                  <ul className="space-y-1.5">
                    {items.map((it, idx) => (
                      <li key={idx} className="flex items-start justify-between gap-2 rounded border p-2 text-xs">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate">{it.name}</p>
                          <p className="text-muted-foreground">
                            {it.portion || "—"} · <span className="uppercase tracking-wide">{it.category}</span>
                          </p>
                        </div>
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => reviewRemove(k, idx)} aria-label="Remove food">
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            {reviewTotal() === 0 && (
              <p className="text-sm text-muted-foreground">No foods remaining. Cancel and try a different document.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewOpen(false)}>Cancel</Button>
            <Button onClick={onConfirmReview} disabled={reviewTotal() === 0}>Confirm and save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmReplaceOpen} onOpenChange={setConfirmReplaceOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace existing food list?</AlertDialogTitle>
            <AlertDialogDescription>
              This will replace the existing food list for this client. Are you sure?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void doSaveImport()}>Replace</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
