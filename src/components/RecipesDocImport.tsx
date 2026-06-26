import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Trash2, Upload, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";

type Slot = "breakfast" | "morning_snack" | "lunch" | "afternoon_snack" | "dinner" | "any";

const SLOT_OPTIONS: { value: Slot; label: string }[] = [
  { value: "breakfast", label: "Meal 1" },
  { value: "morning_snack", label: "Meal 2" },
  { value: "lunch", label: "Meal 3" },
  { value: "afternoon_snack", label: "Meal 4" },
  { value: "dinner", label: "Meal 5" },
  { value: "any", label: "Any" },
];

type Ingredient = { food: string; amount: string };
type ParsedRecipe = {
  name: string;
  meal_slot: Slot;
  method: string;
  notes: string;
  ingredients: Ingredient[];
};

interface Props {
  clientId: string;
  mealsPerDay?: number;
  onSaved?: () => void;
}

export default function RecipesDocImport({ clientId, mealsPerDay, onSaved }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [recipes, setRecipes] = useState<ParsedRecipe[]>([]);
  const [exclusions, setExclusions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

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
      const { data, error } = await supabase.functions.invoke("parse-recipes-document", {
        body: {
          filename: file.name,
          mime: file.type || (lower.endsWith(".pdf") ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
          data_base64,
          meals_per_day: mealsPerDay,
        },
      });
      if (error || !data?.ok || !Array.isArray(data?.recipes) || data.recipes.length === 0) {
        toast.error("We couldn't extract any recipes from this document. Check that the document contains recipes with ingredients and method, then try again. You can also add recipes manually from the Recipe Library.");
        return;
      }
      const normalized = (data.recipes as Array<Partial<ParsedRecipe>>).map((r) => ({
        name: r.name ?? "",
        meal_slot: (r.meal_slot ?? "any") as Slot,
        method: r.method ?? "",
        notes: r.notes ?? "",
        ingredients: Array.isArray(r.ingredients) ? r.ingredients : [],
      })) as ParsedRecipe[];
      setRecipes(normalized);
      const exc = Array.isArray((data as { exclusions?: unknown }).exclusions)
        ? ((data as { exclusions: unknown[] }).exclusions).map((x) => String(x ?? "").trim()).filter((x) => x.length > 0)
        : [];
      setExclusions(exc);
      setReviewOpen(true);
    } catch (err) {
      console.error(err);
      toast.error("We couldn't extract any recipes from this document. Check that the document contains recipes with ingredients and method, then try again. You can also add recipes manually from the Recipe Library.");
    } finally {
      setImporting(false);
    }
  }

  function updateRecipe(idx: number, patch: Partial<ParsedRecipe>) {
    setRecipes((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  function removeRecipe(idx: number) {
    setRecipes((prev) => prev.filter((_, i) => i !== idx));
  }
  function updateIngredient(rIdx: number, iIdx: number, patch: Partial<Ingredient>) {
    setRecipes((prev) =>
      prev.map((r, i) =>
        i === rIdx ? { ...r, ingredients: r.ingredients.map((ing, j) => (j === iIdx ? { ...ing, ...patch } : ing)) } : r,
      ),
    );
  }
  function addIngredient(rIdx: number) {
    setRecipes((prev) =>
      prev.map((r, i) => (i === rIdx ? { ...r, ingredients: [...r.ingredients, { food: "", amount: "" }] } : r)),
    );
  }
  function removeIngredient(rIdx: number, iIdx: number) {
    setRecipes((prev) =>
      prev.map((r, i) => (i === rIdx ? { ...r, ingredients: r.ingredients.filter((_, j) => j !== iIdx) } : r)),
    );
  }

  async function doSave() {
    const cleaned = recipes
      .map((r) => ({
        ...r,
        name: r.name.trim(),
        method: r.method.trim(),
        notes: (r.notes ?? "").trim(),
        ingredients: r.ingredients
          .map((i) => ({ food: i.food.trim(), amount: i.amount.trim() }))
          .filter((i) => i.food),
      }))
      .filter((r) => r.name);
    if (cleaned.length === 0) {
      toast.error("Nothing to save.");
      return;
    }
    setSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) {
        toast.error("Not signed in");
        return;
      }
      const payload = cleaned.map((r) => ({
        practitioner_id: uid,
        name: r.name,
        ingredients: r.ingredients,
        method: r.method,
        notes: r.notes ? r.notes : null,
        default_slot: r.meal_slot,
      }));
      const { data: inserted, error: insertErr } = await supabase
        .from("practitioner_recipes" as never)
        .insert(payload as never)
        .select("id");
      if (insertErr || !inserted) {
        console.error(insertErr);
        toast.error("Failed to save recipes to library.");
        return;
      }
      const ids = (inserted as unknown as { id: string }[]).map((r) => r.id);
      const assignments = cleaned.map((r, i) => ({
        client_id: clientId,
        recipe_id: ids[i],
        meal_slot: r.meal_slot,
        portion_overrides: null,
      }));
      const { error: assignErr } = await supabase
        .from("client_recipe_assignments" as never)
        .insert(assignments as never);
      if (assignErr) {
        console.error(assignErr);
        toast.error("Recipes saved to library, but failed to assign to this client.");
        return;
      }
      if (exclusions.length > 0) {
        await supabase
          .from("clients")
          .update({ food_exclusions: exclusions } as never)
          .eq("id", clientId);
      }
      toast.success(`Imported ${cleaned.length} recipe${cleaned.length === 1 ? "" : "s"}.`);
      setReviewOpen(false);
      setRecipes([]);
      setExclusions([]);
      onSaved?.();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={handleFileSelected}
      />
      <Button size="sm" variant="outline" disabled={importing} onClick={() => fileInputRef.current?.click()}>
        {importing ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Upload className="h-3 w-3 mr-1" />}
        {importing ? "Parsing…" : "Upload PDF/Doc"}
      </Button>

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review imported recipes</DialogTitle>
            <DialogDescription>
              Review and edit the extracted recipes. On save they will be added to your Recipe Library and assigned to this client's matching meal slots.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {recipes.length === 0 && (
              <p className="text-sm text-muted-foreground">No recipes remaining. Cancel and try a different document.</p>
            )}
            {recipes.map((r, rIdx) => (
              <div key={rIdx} className="rounded-md border p-3 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 space-y-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Recipe name</Label>
                      <Input value={r.name} onChange={(e) => updateRecipe(rIdx, { name: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Meal slot</Label>
                      <Select value={r.meal_slot} onValueChange={(v) => updateRecipe(rIdx, { meal_slot: v as Slot })}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {SLOT_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeRecipe(rIdx)} aria-label="Remove recipe">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs">Ingredients</Label>
                  {r.ingredients.map((ing, iIdx) => (
                    <div key={iIdx} className="flex gap-2">
                      <Input
                        placeholder="Food"
                        value={ing.food}
                        onChange={(e) => updateIngredient(rIdx, iIdx, { food: e.target.value })}
                      />
                      <Input
                        placeholder="Amount"
                        value={ing.amount}
                        onChange={(e) => updateIngredient(rIdx, iIdx, { amount: e.target.value })}
                        className="max-w-[140px]"
                      />
                      <Button type="button" size="icon" variant="ghost" aria-label="Remove" onClick={() => removeIngredient(rIdx, iIdx)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  <Button type="button" variant="outline" size="sm" onClick={() => addIngredient(rIdx)}>
                    <Plus className="h-3 w-3 mr-1" /> Add ingredient
                  </Button>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Method</Label>
                  <Textarea rows={4} value={r.method} onChange={(e) => updateRecipe(rIdx, { method: e.target.value })} />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Notes</Label>
                  <Textarea
                    rows={2}
                    value={r.notes ?? ""}
                    onChange={(e) => updateRecipe(rIdx, { notes: e.target.value })}
                    placeholder={`Optional. e.g. "Works well for meal prep", "Substitute chicken with turkey if preferred."`}
                  />
                </div>
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewOpen(false)}>Cancel</Button>
            <Button onClick={doSave} disabled={saving || recipes.length === 0}>
              {saving ? "Saving…" : "Confirm and save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
