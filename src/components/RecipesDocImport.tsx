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
  const [keys, setKeys] = useState<string | null>(null);
  const [digestion, setDigestion] = useState<string | null>(null);
  const [supplements, setSupplements] = useState<string | null>(null);
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
      const strOrNull = (v: unknown): string | null => {
        const s = typeof v === "string" ? v.trim() : "";
        return s.length > 0 ? s : null;
      };
      setKeys(strOrNull((data as { keys_to_success?: unknown }).keys_to_success));
      setDigestion(strOrNull((data as { digestion_protocol?: unknown }).digestion_protocol));
      setSupplements(strOrNull((data as { recommended_supplements?: unknown }).recommended_supplements));
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
      // Fetch existing library rows for this practitioner to dedupe by
      // name (case-insensitive) + normalized ingredient food-set (order-independent).
      const normalizeFoodSet = (ings: Ingredient[]) =>
        Array.from(new Set(ings.map((i) => i.food.trim().toLowerCase()).filter(Boolean)))
          .sort()
          .join("|");
      const cleanedNames = Array.from(new Set(cleaned.map((r) => r.name.toLowerCase())));
      const { data: existingRows } = await supabase
        .from("practitioner_recipes" as never)
        .select("id,name,ingredients,created_at")
        .eq("practitioner_id", uid)
        .in("name", cleaned.map((r) => r.name));
      type ExistingRow = { id: string; name: string; ingredients: Ingredient[] | null; created_at: string };
      const existing = ((existingRows as unknown as ExistingRow[]) ?? [])
        .filter((row) => cleanedNames.includes((row.name ?? "").toLowerCase()))
        .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
      const findExistingId = (r: (typeof cleaned)[number]): string | null => {
        const key = normalizeFoodSet(r.ingredients);
        const nameLower = r.name.toLowerCase();
        for (const row of existing) {
          if ((row.name ?? "").toLowerCase() !== nameLower) continue;
          if (normalizeFoodSet(Array.isArray(row.ingredients) ? row.ingredients : []) === key) {
            return row.id;
          }
        }
        return null;
      };

      const ids: string[] = [];
      const toInsertIndexes: number[] = [];
      const toInsertPayload: Array<Record<string, unknown>> = [];
      cleaned.forEach((r, i) => {
        const existingId = findExistingId(r);
        if (existingId) {
          ids[i] = existingId;
        } else {
          toInsertIndexes.push(i);
          toInsertPayload.push({
            practitioner_id: uid,
            name: r.name,
            ingredients: r.ingredients,
            method: r.method,
            notes: r.notes ? r.notes : null,
            default_slot: r.meal_slot,
          });
        }
      });

      if (toInsertPayload.length > 0) {
        const { data: inserted, error: insertErr } = await supabase
          .from("practitioner_recipes" as never)
          .insert(toInsertPayload as never)
          .select("id");
        if (insertErr || !inserted) {
          console.error(insertErr);
          toast.error("Failed to save recipes to library.");
          return;
        }
        const insertedIds = (inserted as unknown as { id: string }[]).map((r) => r.id);
        toInsertIndexes.forEach((idx, k) => {
          ids[idx] = insertedIds[k];
        });
      }

      const { error: clearErr } = await supabase
        .from("client_recipe_assignments" as never)
        .delete()
        .eq("client_id", clientId);
      if (clearErr) {
        console.error(clearErr);
        toast.error("Recipes saved to library, but failed to clear existing assignments.");
        return;
      }

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
      const clientUpdate: Record<string, unknown> = {};
      if (exclusions.length > 0) clientUpdate.food_exclusions = exclusions;
      clientUpdate.keys_to_success = keys;
      clientUpdate.digestion_protocol = digestion;
      clientUpdate.recommended_supplements = supplements;
      if (Object.keys(clientUpdate).length > 0) {
        await supabase
          .from("clients")
          .update(clientUpdate as never)
          .eq("id", clientId);
      }
      toast.success(`Imported ${cleaned.length} recipe${cleaned.length === 1 ? "" : "s"}.`);
      setReviewOpen(false);
      setRecipes([]);
      setExclusions([]);
      setKeys(null);
      setDigestion(null);
      setSupplements(null);
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
            {keys && (
              <div className="rounded-md border p-3">
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-xs">Keys to success</Label>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setKeys(null)} aria-label="Remove"><X className="h-3 w-3" /></Button>
                </div>
                <p className="text-xs whitespace-pre-wrap text-muted-foreground">{keys}</p>
              </div>
            )}
            {digestion && (
              <div className="rounded-md border p-3">
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-xs">Digestion protocol</Label>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setDigestion(null)} aria-label="Remove"><X className="h-3 w-3" /></Button>
                </div>
                <p className="text-xs whitespace-pre-wrap text-muted-foreground">{digestion}</p>
              </div>
            )}
            {supplements && (
              <div className="rounded-md border p-3">
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-xs">Recommended supplements</Label>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setSupplements(null)} aria-label="Remove"><X className="h-3 w-3" /></Button>
                </div>
                <p className="text-xs whitespace-pre-wrap text-muted-foreground">{supplements}</p>
              </div>
            )}
            {exclusions.length > 0 && (
              <div className="rounded-md border p-3">
                <Label className="text-xs">Foods to avoid (saved on this client)</Label>
                <ul className="mt-2 text-xs space-y-1 list-disc list-inside text-muted-foreground">
                  {exclusions.map((it, idx) => (
                    <li key={idx} className="flex items-start justify-between gap-2">
                      <span className="text-foreground">{it}</span>
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setExclusions((prev) => prev.filter((_, i) => i !== idx))} aria-label="Remove exclusion">
                        <X className="h-3 w-3" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
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
