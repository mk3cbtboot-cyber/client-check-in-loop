import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, UploadCloud, AlertTriangle } from "lucide-react";

type MealOption = {
  protein_category: string | null;
  protein_grams: number | null;
  veg_grams: number | null;
  has_fruit: boolean;
  has_bread: boolean;
};
type MealKey = "breakfast" | "lunch" | "dinner";
type MealOptionsMap = Record<MealKey, MealOption[]>;
const EMPTY_OPTION = (): MealOption => ({ protein_category: null, protein_grams: null, veg_grams: null, has_fruit: false, has_bread: false });
const EMPTY_MEAL_OPTIONS = (): MealOptionsMap => ({
  breakfast: [EMPTY_OPTION(), EMPTY_OPTION(), EMPTY_OPTION()],
  lunch: [EMPTY_OPTION(), EMPTY_OPTION(), EMPTY_OPTION()],
  dinner: [EMPTY_OPTION(), EMPTY_OPTION(), EMPTY_OPTION()],
});

type FieldVal = { value: string | number | null; extracted: boolean };
type FieldsMap = Record<string, FieldVal>;

const PHASE2_PROTEIN = [
  ["food_fish", "Fish"],
  ["food_seafood", "Seafood"],
  ["food_milk_products", "Milk Products"],
  ["food_yogurt", "Yogurt"],
  ["food_nuts", "Nuts"],
  ["food_meat", "Meat"],
  ["food_poultry", "Poultry"],
  ["food_cheese", "Cheese"],
  ["food_legumes", "Legumes"],
  ["food_pumpkin_seeds", "Pumpkin Seeds"],
  ["food_sunflower_seeds", "Sunflower Seeds"],
] as const;

const PHASE2_CARB = [
  ["food_vegetables", "Vegetables"],
  ["food_veg_lettuce", "Veg./Lettuce"],
  ["food_starch", "Starch"],
  ["food_bread", "Bread"],
  ["food_fruit", "Fruit"],
] as const;

const PHASE3 = [
  ["phase3_mb_fish", "Fish"],
  ["phase3_mb_seafood", "Seafood"],
  ["phase3_mb_meat", "Meat"],
  ["phase3_mb_cheese", "Cheese"],
  ["phase3_mb_legumes", "Legumes"],
  ["phase3_mb_vegetables", "Vegetables"],
  ["phase3_mb_veg_lettuce", "Veg./Lettuce"],
  ["phase3_mb_sprouts", "Sprouts"],
  ["phase3_mb_fat_oil", "Fat / Oil"],
] as const;

const MEALS = [
  { key: "breakfast", label: "Breakfast" },
  { key: "lunch", label: "Lunch" },
  { key: "dinner", label: "Dinner" },
] as const;

interface Props {
  clientId: string;
  onSaved?: () => void;
}

export function MbPdfImport({ clientId, onSaved }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [fields, setFields] = useState<FieldsMap | null>(null);
  const [mealOptions, setMealOptions] = useState<MealOptionsMap>(EMPTY_MEAL_OPTIONS());
  const [storagePath, setStoragePath] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const reset = () => {
    setFields(null);
    setMealOptions(EMPTY_MEAL_OPTIONS());
    setStoragePath(null);
    setReviewError(null);
    setReviewOpen(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const startUpload = () => fileRef.current?.click();

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Please upload a PDF file");
      return;
    }
    setBusy(true);
    // Capture clientId at the moment of upload so a prop change mid-flight cannot
    // cause us to parse against a different client's path.
    const uploadClientId = clientId;
    // Always reset any previously stored path from earlier uploads before starting.
    setStoragePath(null);
    try {
      // Fresh, unique path for THIS upload only. Include a random suffix so two
      // uploads within the same millisecond cannot collide.
      const uniquePath = `clients/${uploadClientId}/${Date.now()}-${crypto.randomUUID()}.pdf`;
      setReviewError(null);
      const up = await supabase.storage.from("mb-pdfs").upload(uniquePath, file, {
        contentType: "application/pdf",
        upsert: false,
      });
      if (up.error) {
        const detail = [`Step: storage upload`, `Path: ${uniquePath}`, `Error: ${up.error.message}`].join("\n");
        setReviewError(detail);
        setReviewOpen(true);
        throw new Error(detail);
      }
      // Use the canonical path returned by storage, not the constructed string.
      // This guarantees the parse function downloads exactly the bytes we just uploaded.
      const path = up.data?.path ?? uniquePath;
      if (path !== uniquePath) {
        console.warn("[MbPdfImport] storage returned different path", { requested: uniquePath, returned: path });
      }
      const { data, error } = await supabase.functions.invoke("parse-mb-pdf", {
        body: { clientId: uploadClientId, storagePath: path },
      });
      if (error) {
        const detail = [`Step: edge function invocation`, `Function: parse-mb-pdf`, `Error: ${error.message}`].join("\n");
        setReviewError(detail);
        setReviewOpen(true);
        throw new Error(detail);
      }
      const response = data as { fields?: FieldsMap; mealOptions?: MealOptionsMap; error?: string; detail?: string; debug?: Record<string, unknown> };
      if (response.error || !response.fields) {
        const detail = [
          `Step: parse-mb-pdf`,
          `Error: ${response.error ?? "unknown parser error"}`,
          response.detail ? `Detail: ${response.detail}` : null,
          response.debug?.step ? `Failing step: ${String(response.debug.step)}` : null,
          response.debug?.storagePath ? `Path: ${String(response.debug.storagePath)}` : null,
        ].filter(Boolean).join("\n");
        setReviewError(detail);
        setReviewOpen(true);
        throw new Error(detail);
      }
      setFields(response.fields);
      const incoming = response.mealOptions;
      const normalize = (arr: MealOption[] | undefined): MealOption[] => {
        const base = [EMPTY_OPTION(), EMPTY_OPTION(), EMPTY_OPTION()];
        (arr ?? []).slice(0, 3).forEach((o, i) => { base[i] = { ...base[i], ...o }; });
        return base;
      };
      setMealOptions({
        breakfast: normalize(incoming?.breakfast),
        lunch: normalize(incoming?.lunch),
        dinner: normalize(incoming?.dinner),
      });
      setStoragePath(path);
      setReviewOpen(true);
    } catch (err) {
      toast.error("Could not parse PDF", { description: (err as Error).message });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const update = (key: string, value: string | number | null) => {
    setFields((f) => (f ? { ...f, [key]: { value, extracted: true } } : f));
  };

  const updateOption = (meal: MealKey, idx: number, patch: Partial<MealOption>) => {
    setMealOptions((m) => {
      const next = { ...m, [meal]: m[meal].map((o, i) => (i === idx ? { ...o, ...patch } : o)) };
      return next;
    });
  };


  const save = async () => {
    if (!fields || !storagePath) return;
    setBusy(true);
    try {
      const update: Record<string, unknown> = { mb_pdf_path: storagePath };
      for (const [k, v] of Object.entries(fields)) {
        const val = v.value;
        // Coerce numeric fields
        const numericKeys = new Set([
          "breakfast_protein_grams", "breakfast_veg_grams",
          "lunch_protein_grams", "lunch_veg_grams",
          "dinner_protein_grams", "dinner_veg_grams",
          "eggs_min_per_week", "eggs_max_per_week",
          "water_target_litres",
        ]);
        if (numericKeys.has(k)) {
          if (val === null || val === "" || val === undefined) update[k] = null;
          else {
            const n = typeof val === "number" ? val : parseFloat(String(val));
            update[k] = Number.isFinite(n) ? n : null;
          }
        } else {
          update[k] = val == null ? "" : String(val);
        }
      }
      // Persist 3 options per meal into the jsonb column.
      update.mb_meal_options = mealOptions;
      const { error } = await supabase.from("clients").update(update as never).eq("id", clientId);
      if (error) throw error;
      toast.success("MB data saved");
      onSaved?.();
      reset();
    } catch (err) {
      toast.error("Could not save", { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const FieldRow = ({ k, label, type = "text" }: { k: string; label: string; type?: "text" | "number" | "textarea" }) => {
    const f = fields?.[k];
    const extracted = !!f?.extracted;
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Label className="text-xs">{label}</Label>
          {!extracted && (
            <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3 w-3" /> Not extracted — please fill in
            </span>
          )}
        </div>
        {type === "textarea" ? (
          <Textarea
            value={(f?.value as string) ?? ""}
            onChange={(e) => update(k, e.target.value)}
            className={`min-h-[60px] text-sm ${!extracted ? "border-amber-400" : ""}`}
            placeholder="Comma-separated list"
          />
        ) : (
          <Input
            type={type}
            step={type === "number" ? "any" : undefined}
            value={f?.value == null ? "" : String(f.value)}
            onChange={(e) => update(k, type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value)}
            className={`h-8 ${!extracted ? "border-amber-400" : ""}`}
          />
        )}
      </div>
    );
  };

  return (
    <>
      <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={handleFile} />
      <Button type="button" size="sm" variant="outline" onClick={startUpload} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
        Upload MB PDF
      </Button>

      <Dialog open={reviewOpen} onOpenChange={(o) => { if (!o) reset(); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review extracted MB data</DialogTitle>
            <DialogDescription>Check extracted values before saving them to the client record.</DialogDescription>
          </DialogHeader>

          {reviewError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Parser error details</AlertTitle>
              <AlertDescription>
                <pre className="whitespace-pre-wrap break-words text-xs">{reviewError}</pre>
              </AlertDescription>
            </Alert>
          )}

          {fields && (
            <div className="space-y-6">
              <section>
                <h3 className="text-sm font-semibold mb-2">Meal plan — 3 options per meal</h3>
                <div className="space-y-4">
                  {MEALS.map((m) => (
                    <div key={m.key} className="rounded-md border p-3">
                      <p className="text-xs font-medium mb-2">{m.label}</p>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {mealOptions[m.key as MealKey].map((opt, idx) => {
                          const extracted = !!opt.protein_category;
                          return (
                            <div key={idx} className={`rounded-md border p-2 space-y-2 ${!extracted ? "border-amber-400" : ""}`}>
                              <div className="flex items-center justify-between">
                                <p className="text-[11px] font-medium">Option {idx + 1}</p>
                                {!extracted && (
                                  <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
                                    <AlertTriangle className="h-3 w-3" /> Not extracted
                                  </span>
                                )}
                              </div>
                              <div className="space-y-1">
                                <Label className="text-[10px]">Protein category</Label>
                                <Input
                                  className="h-8"
                                  value={opt.protein_category ?? ""}
                                  onChange={(e) => updateOption(m.key as MealKey, idx, { protein_category: e.target.value || null })}
                                />
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                  <Label className="text-[10px]">Protein (g)</Label>
                                  <Input
                                    type="number"
                                    step="any"
                                    className="h-8"
                                    value={opt.protein_grams ?? ""}
                                    onChange={(e) => updateOption(m.key as MealKey, idx, { protein_grams: e.target.value === "" ? null : Number(e.target.value) })}
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-[10px]">Veg (g)</Label>
                                  <Input
                                    type="number"
                                    step="any"
                                    className="h-8"
                                    value={opt.veg_grams ?? ""}
                                    onChange={(e) => updateOption(m.key as MealKey, idx, { veg_grams: e.target.value === "" ? null : Number(e.target.value) })}
                                  />
                                </div>
                              </div>
                              <div className="flex items-center gap-3 pt-1">
                                <label className="flex items-center gap-1 text-[11px]">
                                  <Checkbox
                                    checked={opt.has_fruit}
                                    onCheckedChange={(c) => updateOption(m.key as MealKey, idx, { has_fruit: !!c })}
                                  />
                                  Fruit
                                </label>
                                <label className="flex items-center gap-1 text-[11px]">
                                  <Checkbox
                                    checked={opt.has_bread}
                                    onCheckedChange={(c) => updateOption(m.key as MealKey, idx, { has_bread: !!c })}
                                  />
                                  Bread
                                </label>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </section>


              <section>
                <h3 className="text-sm font-semibold mb-2">Additional information</h3>
                <div className="grid grid-cols-3 gap-3">
                  <FieldRow k="eggs_min_per_week" label="Eggs min/week" type="number" />
                  <FieldRow k="eggs_max_per_week" label="Eggs max/week" type="number" />
                  <FieldRow k="water_target_litres" label="Water (litres/day)" type="number" />
                </div>
              </section>

              <section>
                <h3 className="text-sm font-semibold mb-2">Phase 2 — Proteins</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {PHASE2_PROTEIN.map(([k, l]) => <FieldRow key={k} k={k} label={l} type="textarea" />)}
                </div>
              </section>

              <section>
                <h3 className="text-sm font-semibold mb-2">Phase 2 — Carbohydrates</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {PHASE2_CARB.map(([k, l]) => <FieldRow key={k} k={k} label={l} type="textarea" />)}
                </div>
              </section>

              <section>
                <h3 className="text-sm font-semibold mb-2">Phase 3 — Extended Personal Food List</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {PHASE3.map(([k, l]) => <FieldRow key={k} k={k} label={l} type="textarea" />)}
                </div>
              </section>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => { reset(); setTimeout(startUpload, 50); }} disabled={busy}>
              Re-upload
            </Button>
            <Button type="button" onClick={save} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirm and Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
