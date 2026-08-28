import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import PlanInstructionsEditor from "@/components/PlanInstructionsEditor";
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
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Pencil, Trash2, Plus, X, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { customSlotLabel } from "@/lib/meal-slots";
import MacroTracker, { type MacroSet } from "@/components/MacroTracker";
import { portionToGrams, formatPortionDisplay, normalizeUnit } from "@/lib/portion";
import { sumMacros, withDensityModel, type DensityFoodItem } from "@/lib/macros";

export type FoodCategoryKind = "Protein" | "Carbs" | "Veg" | "Fat" | "Other";
export interface FoodItem extends DensityFoodItem {
  name: string;
  portion: string;
  category: FoodCategoryKind;
  grams?: number;
  est_calories?: number;
  est_protein_g?: number;
  est_carbs_g?: number;
  est_fat_g?: number;
  density_protein_per_100g?: number;
  density_carbs_per_100g?: number;
  density_fat_per_100g?: number;
  density_source?: string;
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
  const numOpt = (v: unknown): number | undefined => {
    if (v === undefined || v === null || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };
  const slot = (v: unknown): FoodItem[] =>
    Array.isArray(v)
      ? v.map((x) => {
          const o = (x ?? {}) as Record<string, unknown>;
          const base: FoodItem = {
            name: String(o.name ?? ""),
            portion: String(o.portion ?? ""),
            category: (CATEGORIES.includes(o.category as FoodCategoryKind) ? o.category : "Other") as FoodCategoryKind,
            est_calories: num(o.est_calories),
            est_protein_g: num(o.est_protein_g),
            est_carbs_g: num(o.est_carbs_g),
            est_fat_g: num(o.est_fat_g),
            grams: numOpt(o.grams),
            density_protein_per_100g: numOpt(o.density_protein_per_100g),
            density_carbs_per_100g: numOpt(o.density_carbs_per_100g),
            density_fat_per_100g: numOpt(o.density_fat_per_100g),
            ...(typeof o.density_source === "string" ? { density_source: o.density_source } : {}),
          };
          // Lazy repair for items saved before the density model existed.
          return withDensityModel(base);
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

function normalizeStale(raw: unknown): Record<string, boolean> {
  const r = (raw ?? {}) as Record<string, unknown>;
  const out: Record<string, boolean> = {};
  for (const k of Object.keys(r)) out[k] = r[k] === true;
  return out;
}

type MealKey = "meal_1" | "meal_2" | "meal_3" | "meal_4" | "meal_5";
type MacroAllocation = Partial<Record<MealKey, { calories: number; protein_g: number; carbs_g: number; fat_g: number }>>;

interface Props {
  clientId: string;
  initialList: unknown;
  initialNotes: unknown;
  initialNotesStale?: unknown;
  initialMealsPerDay?: number;
  planFormat?: "food_list" | "food_list_generated";
  /** Raw clients.plan_instructions jsonb. */
  initialPlanInstructions?: unknown;
  macros?: MacroSet | null;
  macroAllocation?: MacroAllocation | null;
  onGoToMacros?: () => void;
  onClientPatched?: (patch: { food_list?: unknown; food_list_notes?: unknown; food_list_notes_stale?: unknown }) => void;
}

export async function estimateFoodMacros(name: string, portion: string, category?: FoodCategoryKind): Promise<{ est_calories: number; est_protein_g: number; est_carbs_g: number; est_fat_g: number }> {
  try {
    const { data, error } = await supabase.functions.invoke("estimate-macros", {
      body: { items: [{ name, portion, ...(category ? { category } : {}) }] },
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

export default function CustomFoodListEditor({ clientId, initialList, initialNotes, initialNotesStale, initialMealsPerDay, planFormat, initialPlanInstructions, macros, macroAllocation, onGoToMacros, onClientPatched }: Props) {
  const [list, setList] = useState<FoodList>(() => normalizeList(initialList));
  const [notes, setNotes] = useState<FoodListNotes>(() => normalizeNotes(initialNotes));
  const [notesStale, setNotesStale] = useState<Record<string, boolean>>(() => normalizeStale(initialNotesStale));
  const [mealsPerDay, setMealsPerDay] = useState<number>(() => {
    const v = Number(initialMealsPerDay ?? 3);
    return v === 4 || v === 5 ? v : 3;
  });

  // Re-sync from parent only when the client itself changes. Parent re-renders
  // (unrelated setClients calls with a new object ref) would otherwise clobber
  // locally-saved list/notes with stale server-side data before parent refetches.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setList(normalizeList(initialList)); }, [clientId]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setNotes(normalizeNotes(initialNotes)); }, [clientId]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setNotesStale(normalizeStale(initialNotesStale)); }, [clientId]);
  useEffect(() => {
    const v = Number(initialMealsPerDay ?? 3);
    setMealsPerDay(v === 4 || v === 5 ? v : 3);
  }, [initialMealsPerDay]);

  async function saveList(next: FoodList): Promise<boolean> {
    const prev = list;
    setList(next);
    const { data, error } = await supabase
      .from("clients")
      .update({ food_list: next } as never)
      .eq("id", clientId)
      .select("food_list, food_list_notes_stale");
    if (error || !data || data.length === 0) {
      setList(prev);
      console.error("[CustomFoodListEditor] food_list save failed; rolled back local state", {
        clientId,
        error,
        returnedRows: data?.length ?? 0,
      });
      toast.error(error ? "Failed to save food list" : "Save was not confirmed. Please try again.");
      return false;
    }
    // Reflect the committed server value so a later save cannot overwrite it
    // with a stale local copy, and push it into the parent's cached client row.
    const row = data[0] as { food_list?: unknown; food_list_notes_stale?: unknown };
    setList(normalizeList(row.food_list));
    setNotesStale(normalizeStale(row.food_list_notes_stale));
    onClientPatched?.({ food_list: row.food_list, food_list_notes_stale: row.food_list_notes_stale });
    return true;
  }


  async function saveNotes(next: FoodListNotes) {
    const prev = notes;
    setNotes(next);
    const { data, error } = await supabase
      .from("clients")
      .update({ food_list_notes: next } as never)
      .eq("id", clientId)
      .select("food_list_notes, food_list_notes_stale");
    if (error || !data || data.length === 0) {
      setNotes(prev);
      toast.error(error ? "Failed to save notes" : "Save was not confirmed. Please try again.");
      return;
    }
    const row = data[0] as { food_list_notes?: unknown; food_list_notes_stale?: unknown };
    setNotes(normalizeNotes(row.food_list_notes));
    setNotesStale(normalizeStale(row.food_list_notes_stale));
    onClientPatched?.({ food_list_notes: row.food_list_notes, food_list_notes_stale: row.food_list_notes_stale });
  }

  async function dismissStale(slot: SlotKey) {
    const next = { ...notesStale, [slot]: false };
    setNotesStale(next);
    const { data, error } = await supabase
      .from("clients")
      .update({ food_list_notes_stale: next } as never)
      .eq("id", clientId)
      .select("food_list_notes_stale");
    if (error || !data || data.length === 0) {
      setNotesStale(notesStale);
      toast.error("Failed to dismiss the note warning");
      return;
    }
    const committed = (data[0] as { food_list_notes_stale?: unknown }).food_list_notes_stale;
    setNotesStale(normalizeStale(committed));
    onClientPatched?.({ food_list_notes_stale: committed });
  }

  const visible = visibleSlotKeys(mealsPerDay);
  const slots = ALL_SLOTS.filter((s) => visible.includes(s.key));
  const gridCols = slots.length >= 5 ? "md:grid-cols-5" : slots.length === 4 ? "md:grid-cols-4" : "md:grid-cols-3";

  // Derived from grams x density so portion edits scale the tracker.
  const used: MacroSet = visible.reduce(
    (acc, key) => {
      const m = sumMacros(list[key]);
      acc.protein_g += m.protein_g;
      acc.carbs_g += m.carbs_g;
      acc.fat_g += m.fat_g;
      return acc;
    },
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 } as MacroSet,
  );
  used.calories = used.protein_g * 4 + used.carbs_g * 4 + used.fat_g * 9;


  const isEmpty = visible.every((k) => list[k].length === 0);
  const showGenPrompt = planFormat === "food_list_generated" && isEmpty;

  if (showGenPrompt) {
    return (
      <div className="rounded-md border p-6 bg-card text-center space-y-3">
        <p className="text-sm text-muted-foreground">
          Your meal plan will appear here once it's been generated. Go to the Macros / MPG tab to calculate your client's macros and generate their meal plan.
        </p>
        {onGoToMacros && (
          <Button size="sm" onClick={onGoToMacros}>Generate Meal Plan</Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {planFormat === "food_list_generated" ? (
        macros ? (
          <MacroTracker target={macros} used={used} />
        ) : (
          <p className="text-xs text-muted-foreground rounded-md border p-3">
            Add macro targets on the Macros / MPG tab to track progress here.
          </p>
        )
      ) : null}
      {planFormat === "food_list_generated" && !isEmpty && macroAllocation && (
        <PerMealBreakdown
          visible={visible}
          list={list}
          mealsPerDay={mealsPerDay}
          allocation={macroAllocation}
        />
      )}
      <PlanInstructionsEditor clientId={clientId} value={initialPlanInstructions} />
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
            noteStale={notesStale[s.key] === true && (notes[s.key] ?? "").trim().length > 0}
            onDismissStale={() => { void dismissStale(s.key); }}
            emptyMessage="No foods added yet. Use Add food to build this meal slot."
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
  noteStale?: boolean;
  onDismissStale?: () => void;
  emptyMessage?: string;
  onItemsChange: (items: FoodItem[]) => void | Promise<boolean>;
  onNoteBlur: (value: string) => void;
}

function parsePortion(portion: string): { num: string; unit: string } {
  const m = String(portion ?? "").match(/^\s*(\d+(?:\.\d+)?)\s*(.*)$/);
  if (!m) return { num: "", unit: "" };
  return { num: m[1], unit: m[2].trim() };
}
function isEggItem(name: string, category: FoodCategoryKind): boolean {
  return category === "Protein" && /\begg/i.test(name);
}

function SlotPanel({ label, items, note, noteStale, onDismissStale, emptyMessage, onItemsChange, onNoteBlur }: SlotPanelProps) {
  const [adding, setAdding] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftPortionNum, setDraftPortionNum] = useState("");
  const [draftPortionUnit, setDraftPortionUnit] = useState("g");
  const [draftCategory, setDraftCategory] = useState<FoodCategoryKind>("Protein");
  const [draftProtein, setDraftProtein] = useState("0");
  const [draftCarbs, setDraftCarbs] = useState("0");
  const [draftFat, setDraftFat] = useState("0");
  const [macrosDirty, setMacrosDirty] = useState(false);
  const [densities, setDensities] = useState<{ p?: number; c?: number; f?: number }>({});
  const [originalName, setOriginalName] = useState("");
  const [estimatedCategory, setEstimatedCategory] = useState<FoodCategoryKind | null>(null);

  const [confirmRemoveIdx, setConfirmRemoveIdx] = useState<number | null>(null);
  const [removing, setRemoving] = useState(false);
  const [localNote, setLocalNote] = useState(note);

  useEffect(() => { setLocalNote(note); }, [note]);

  function resetDraft() {
    setAdding(false);
    setEditingIndex(null);
    setDraftName("");
    setDraftPortionNum("");
    setDraftPortionUnit("g");
    setDraftCategory("Protein");
    setDraftProtein("0");
    setDraftCarbs("0");
    setDraftFat("0");
    setMacrosDirty(false);
    setDensities({});
    setOriginalName("");
    setEstimatedCategory(null);

  }

  function startAdd() {
    resetDraft();
    setDraftPortionUnit("g");
    setAdding(true);
  }

  function startEdit(idx: number) {
    const it = items[idx];
    const { num, unit } = parsePortion(it.portion);
    setAdding(false);
    setEditingIndex(idx);
    setDraftName(it.name);
    setDraftPortionNum(num);
    setDraftPortionUnit(unit || (isEggItem(it.name, it.category) ? "eggs" : "g"));
    setDraftCategory(it.category);
    setDraftProtein(String(Number(it.est_protein_g ?? 0)));
    setDraftCarbs(String(Number(it.est_carbs_g ?? 0)));
    setDraftFat(String(Number(it.est_fat_g ?? 0)));
    setMacrosDirty(false);
    setDensities({
      p: it.density_protein_per_100g,
      c: it.density_carbs_per_100g,
      f: it.density_fat_per_100g,
    });
    setOriginalName(it.name);
    setEstimatedCategory(it.category);

  }

  /**
   * Estimate macros for the draft once it is complete (name + resolvable grams +
   * category) and the practitioner has not typed macros of their own. Called from
   * the name blur, the portion blur and the category change so the first complete
   * manual entry auto-populates regardless of field order.
   */
  async function maybeEstimate(overrides?: { category?: FoodCategoryKind; portionNum?: string }) {
    const name = draftName.trim();
    const category = overrides?.category ?? draftCategory;
    if (!name) return;
    if (macrosDirty) return;
    // Same-name guard: skip a redundant refetch unless the category changed.
    if (name === originalName.trim() && category === estimatedCategory) return;
    const grams = draftGrams(overrides?.portionNum ?? draftPortionNum, category);
    if (grams === null) {
      // Can't derive densities without a resolvable gram weight; clear stale ones
      // so the old food's numbers don't leak onto the new name.
      if (name !== originalName.trim()) setDensities({});
      return;
    }
    const portion = `${Math.round(grams)}g`;
    setEstimating(true);
    const e = await estimateFoodMacros(name, portion, category);
    setEstimating(false);
    if (macrosDirty) return; // practitioner edited during fetch
    setDraftProtein(String(round1(e.est_protein_g)));
    setDraftCarbs(String(round1(e.est_carbs_g)));
    setDraftFat(String(round1(e.est_fat_g)));
    setDensities({
      p: (e.est_protein_g / grams) * 100,
      c: (e.est_carbs_g / grams) * 100,
      f: (e.est_fat_g / grams) * 100,
    });
    setOriginalName(name);
    setEstimatedCategory(category);
  }

  async function onNameBlur() {
    await maybeEstimate();
  }


  const [estimating, setEstimating] = useState(false);

  const round1 = (n: number) => Math.round(n * 10) / 10;

  /** Grams for the current draft, using the shared unit conversion. */
  function draftGrams(numStr = draftPortionNum, category: FoodCategoryKind = draftCategory): number | null {
    const qty = Number(numStr);
    if (!Number.isFinite(qty) || qty <= 0) return null;
    const unit = draftPortionUnit.trim() || (isEggItem(draftName, category) ? "eggs" : "g");
    return portionToGrams(`${qty} ${unit}`, draftName);
  }


  function onPortionChange(v: string) {
    setDraftPortionNum(v);
    if (macrosDirty) return;
    const grams = draftGrams(v);
    if (grams === null) return;
    if (densities.p !== undefined) setDraftProtein(String(round1((densities.p / 100) * grams)));
    if (densities.c !== undefined) setDraftCarbs(String(round1((densities.c / 100) * grams)));
    if (densities.f !== undefined) setDraftFat(String(round1((densities.f / 100) * grams)));
  }

  const draftCalories =
    (Number(draftProtein) || 0) * 4 +
    (Number(draftCarbs) || 0) * 4 +
    (Number(draftFat) || 0) * 9;

  async function saveDraft() {
    const name = draftName.trim();
    const portionNum = draftPortionNum.trim();
    if (!name) { toast.error("Food name is required"); return; }
    if (!portionNum) { toast.error("Portion is required"); return; }
    const unit = draftPortionUnit.trim() || (isEggItem(name, draftCategory) ? "eggs" : "g");
    const portion = `${portionNum}${unit === "eggs" ? " eggs" : unit === "g" ? "g" : ` ${unit}`}`;

    const existing = editingIndex != null ? items[editingIndex] : null;
    const macrosProvided =
      Number(draftProtein) > 0 || Number(draftCarbs) > 0 || Number(draftFat) > 0 || macrosDirty;

    let est = {
      est_protein_g: Number(draftProtein) || 0,
      est_carbs_g: Number(draftCarbs) || 0,
      est_fat_g: Number(draftFat) || 0,
    };
    let dens = densities;

    // If the food name changed and the practitioner hasn't manually edited macros,
    // re-estimate synchronously here. This avoids a race where a fast Save click
    // beats the async onNameBlur fetch and persists the old food's macros with
    // the new food's name.
    const nameChanged = existing != null && name !== originalName.trim();
    const grams = draftGrams();
    if (nameChanged && !macrosDirty && grams !== null) {
      setEstimating(true);
      const e = await estimateFoodMacros(name, `${Math.round(grams)}g`, draftCategory);
      setEstimating(false);
      est = { est_protein_g: e.est_protein_g, est_carbs_g: e.est_carbs_g, est_fat_g: e.est_fat_g };
      dens = {
        p: (e.est_protein_g / grams) * 100,
        c: (e.est_carbs_g / grams) * 100,
        f: (e.est_fat_g / grams) * 100,
      };
    } else if (!existing && !macrosProvided) {
      // Legacy add flow: if no macros entered and it's a new item, estimate via AI.
      setEstimating(true);
      const e = await estimateFoodMacros(name, portion, draftCategory);
      setEstimating(false);
      est = { est_protein_g: e.est_protein_g, est_carbs_g: e.est_carbs_g, est_fat_g: e.est_fat_g };
    }
    // Manually-typed macros define a new density at the current gram weight, so
    // later portion edits keep scaling instead of freezing.
    if (grams !== null && (macrosDirty || dens.p === undefined || dens.c === undefined || dens.f === undefined)) {
      dens = {
        p: (est.est_protein_g / grams) * 100,
        c: (est.est_carbs_g / grams) * 100,
        f: (est.est_fat_g / grams) * 100,
      };
    }
    const est_calories = est.est_protein_g * 4 + est.est_carbs_g * 4 + est.est_fat_g * 9;
    const next: FoodItem = {
      name,
      portion,
      category: draftCategory,
      est_calories,
      ...est,
      ...(grams !== null ? { grams } : {}),
      density_protein_per_100g: dens.p,
      density_carbs_per_100g: dens.c,
      density_fat_per_100g: dens.f,
      ...(grams !== null && dens.p !== undefined ? { density_source: macrosDirty ? "manual" : "estimated" } : {}),
    };
    const updated = editingIndex != null
      ? items.map((it, i) => (i === editingIndex ? next : it))
      : [...items, next];
    onItemsChange(updated);
    resetDraft();
  }


  async function removeAt(idx: number) {
    if (removing) return;
    setRemoving(true);
    try {
      const result = await onItemsChange(items.filter((_, i) => i !== idx));
      // Only close the dialog once the write is confirmed; keep it open on failure.
      if (result !== false) setConfirmRemoveIdx(null);
    } catch (err) {
      console.error("[CustomFoodListEditor] remove food failed", err);
    } finally {
      setRemoving(false);
    }
  }

  const showForm = adding || editingIndex != null;
  const eggMode = isEggItem(draftName, draftCategory);
  // Spoon-measured foods (oils/fats) keep their real unit in the label.
  const normalizedDraftUnit = normalizeUnit(draftPortionUnit);
  const spoonUnit = normalizedDraftUnit === "tsp" || normalizedDraftUnit === "tbsp" ? normalizedDraftUnit : null;
  const spoonGrams = spoonUnit ? draftGrams() : null;

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
          {items.map((it, idx) => {
            return (
            <li key={idx} className="flex items-start justify-between gap-2 rounded border p-2 text-xs">
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">{it.name}</p>
                <p className="text-muted-foreground">
                  {formatPortionDisplay(it.portion, it.name)} · <span className="uppercase tracking-wide">{it.category}</span>
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
            );
          })}
        </ul>
      )}

      <Dialog
        open={showForm}
        onOpenChange={(o) => { if (!o) resetDraft(); }}
      >
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingIndex != null ? "Edit food" : "Add food"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <div className="space-y-1">
              <Label className="text-xs">Food name</Label>
              <Input value={draftName} onChange={(e) => setDraftName(e.target.value)} onBlur={onNameBlur} placeholder="e.g. Chicken breast" className="h-8" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">
                Portion ({eggMode ? "egg count" : spoonUnit ? spoonUnit : "grams"})
              </Label>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                step={eggMode || spoonUnit ? 1 : 1}
                value={draftPortionNum}
                onChange={(e) => onPortionChange(e.target.value)}
                onBlur={(e) => { void maybeEstimate({ portionNum: e.target.value }); }}

                placeholder={eggMode ? "e.g. 2" : spoonUnit ? "e.g. 3" : "e.g. 150"}
                className="h-8"
              />
              {spoonUnit && spoonGrams !== null && (
                <p className="text-[11px] text-muted-foreground">≈ {Math.round(spoonGrams)}g</p>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Category</Label>
              <Select
                value={draftCategory}
                onValueChange={(v) => {
                  const cat = v as FoodCategoryKind;
                  setDraftCategory(cat);
                  void maybeEstimate({ category: cat });
                }}
              >
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Protein (g)</Label>
                <div className="relative">
                  <Input
                    type="number" inputMode="decimal" min={0} step={0.1}
                    value={estimating ? "" : draftProtein}
                    onChange={(e) => { setDraftProtein(e.target.value); setMacrosDirty(true); }}
                    className="h-8"
                    disabled={estimating}
                  />
                  {estimating && <Loader2 className="h-3 w-3 animate-spin absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />}
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Carbs (g)</Label>
                <div className="relative">
                  <Input
                    type="number" inputMode="decimal" min={0} step={0.1}
                    value={estimating ? "" : draftCarbs}
                    onChange={(e) => { setDraftCarbs(e.target.value); setMacrosDirty(true); }}
                    className="h-8"
                    disabled={estimating}
                  />
                  {estimating && <Loader2 className="h-3 w-3 animate-spin absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />}
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Fat (g)</Label>
                <div className="relative">
                  <Input
                    type="number" inputMode="decimal" min={0} step={0.1}
                    value={estimating ? "" : draftFat}
                    onChange={(e) => { setDraftFat(e.target.value); setMacrosDirty(true); }}
                    className="h-8"
                    disabled={estimating}
                  />
                  {estimating && <Loader2 className="h-3 w-3 animate-spin absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />}
                </div>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Calories</Label>
              <div className="relative">
                <Input value={estimating ? "" : Math.round(draftCalories)} readOnly disabled className="h-8" />
                {estimating && <Loader2 className="h-3 w-3 animate-spin absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={resetDraft} className="h-8">
              <X className="h-3 w-3 mr-1" /> Cancel
            </Button>
            <Button size="sm" onClick={saveDraft} className="h-8" disabled={estimating}>
              {estimating ? (<><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Estimating…</>) : editingIndex != null ? "Save" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      <div className="space-y-1">
        <Label className="text-xs">Notes (optional)</Label>
        {noteStale && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
            <span className="flex-1">This note may be out of date, review it.</span>
            {onDismissStale && (
              <button type="button" className="underline underline-offset-2 shrink-0" onClick={onDismissStale}>
                Dismiss
              </button>
            )}
          </div>
        )}
        <Textarea
          value={localNote}
          onChange={(e) => setLocalNote(e.target.value)}
          onBlur={() => onNoteBlur(localNote)}
          placeholder="Notes for this meal slot"
          className="min-h-[60px] text-xs"
        />
      </div>

      <AlertDialog open={confirmRemoveIdx != null} onOpenChange={(o) => { if (!o && !removing) setConfirmRemoveIdx(null); }}>
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
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={removing}
              onClick={(e) => {
                e.preventDefault();
                if (confirmRemoveIdx != null) void removeAt(confirmRemoveIdx);
              }}
            >
              {removing ? "Removing..." : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function varianceColor(diff: number): string {
  const abs = Math.abs(diff);
  if (abs <= 3) return "text-green-600 dark:text-green-400";
  if (abs <= 6) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function slotToMealKey(slot: SlotKey, mealsPerDay: number): MealKey {
  const orders: Record<number, SlotKey[]> = {
    3: ["breakfast", "lunch", "dinner"],
    4: ["breakfast", "lunch", "afternoon_snack", "dinner"],
    5: ["breakfast", "morning_snack", "lunch", "afternoon_snack", "dinner"],
  };
  const order = orders[mealsPerDay] ?? orders[3];
  const idx = order.indexOf(slot);
  return (`meal_${(idx >= 0 ? idx : 0) + 1}` as MealKey);
}

function PerMealBreakdown({
  visible,
  list,
  mealsPerDay,
  allocation,
}: {
  visible: SlotKey[];
  list: FoodList;
  mealsPerDay: number;
  allocation: MacroAllocation;
}) {
  const rows = visible.map((slot) => {
    const actual = sumMacros(list[slot]);
    const target = allocation[slotToMealKey(slot, mealsPerDay)] ?? { protein_g: 0, carbs_g: 0, fat_g: 0, calories: 0 };
    return {
      slot,
      label: customSlotLabel(slot, mealsPerDay),
      actual,
      target,
    };
  });

  return (
    <div className="rounded-md border bg-card">
      <div className="px-3 py-2 border-b">
        <h3 className="text-sm font-semibold">Per-meal breakdown</h3>
        <p className="text-[11px] text-muted-foreground">Actual vs target for each meal slot</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/40">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">Meal</th>
              <th className="px-2 py-2 font-medium">Protein (g)</th>
              <th className="px-2 py-2 font-medium">Carbs (g)</th>
              <th className="px-2 py-2 font-medium">Fat (g)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const cells: Array<{ key: "protein_g" | "carbs_g" | "fat_g" }> = [
                { key: "protein_g" },
                { key: "carbs_g" },
                { key: "fat_g" },
              ];
              return (
                <tr key={r.slot} className="border-t">
                  <td className="px-3 py-2 font-medium whitespace-nowrap">{r.label}</td>
                  {cells.map(({ key }) => {
                    const a = Math.round(r.actual[key]);
                    const t = Math.round(Number(r.target[key]) || 0);
                    const diff = a - t;
                    const sign = diff > 0 ? "+" : "";
                    return (
                      <td key={key} className="px-2 py-2 whitespace-nowrap">
                        <span className="font-medium">{a}</span>
                        <span className="text-muted-foreground"> / {t}</span>
                        <span className={`ml-1 font-medium ${varianceColor(diff)}`}>({sign}{diff})</span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
