import { makeInstruction, mergeInstructions, parsePlanInstructions } from "@/lib/plan-instructions";
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
import { Loader2, UploadCloud, AlertTriangle, CheckCircle2 } from "lucide-react";
import { mbPlanFromParsedOptions } from "@/lib/mb-plan-parsed";
import { canonicaliseFoodLimits } from "@/lib/food-limits";
import { parseMbFoodLimits } from "@/lib/mb-plan";

type MealItem = { category: string; qty: number | null; unit: string };
type MealOption = {
  items?: MealItem[];
  protein_category: string | null;
  protein_grams: number | null;
  veg_grams: number | null;
  has_fruit: boolean;
  has_bread: boolean;
};
type MealKey = "breakfast" | "lunch" | "dinner";
type MealOptionsMap = Record<MealKey, MealOption[]>;
const EMPTY_OPTION = (): MealOption => ({ items: [], protein_category: null, protein_grams: null, veg_grams: null, has_fruit: false, has_bread: false });
const EMPTY_MEAL_OPTIONS = (): MealOptionsMap => ({
  breakfast: [EMPTY_OPTION(), EMPTY_OPTION(), EMPTY_OPTION()],
  lunch: [EMPTY_OPTION(), EMPTY_OPTION(), EMPTY_OPTION()],
  dinner: [EMPTY_OPTION(), EMPTY_OPTION(), EMPTY_OPTION()],
});

type FieldVal = { value: string | number | null; extracted: boolean };
type FieldsMap = Record<string, FieldVal>;
type FieldFlag = "ok" | "absent" | "parse_failed";


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

const LABELS: Record<string, string> = Object.fromEntries([
  ...PHASE2_PROTEIN, ...PHASE2_CARB, ...PHASE3,
  ["water_target_litres", "Water (litres/day)"],
  ["eggs_min_per_week", "Eggs min/week"],
  ["eggs", "Eggs"],
]);

const MEALS = [
  { key: "breakfast", label: "Breakfast" },
  { key: "lunch", label: "Lunch" },
  { key: "dinner", label: "Dinner" },
] as const;

interface Props {
  clientId: string;
  onSaved?: () => void;
  hasUpload?: boolean;
}

export function MbPdfImport({ clientId, onSaved, hasUpload = false }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [fields, setFields] = useState<FieldsMap | null>(null);
  const [mealOptions, setMealOptions] = useState<MealOptionsMap>(EMPTY_MEAL_OPTIONS());
  const [storagePath, setStoragePath] = useState<string | null>(null);
  const [foodExclusions, setFoodExclusions] = useState<string[] | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [fieldFlags, setFieldFlags] = useState<Record<string, FieldFlag>>({});
  const [parseFailures, setParseFailures] = useState<string[]>([]);
  const [validation, setValidation] = useState<string[]>([]);
  const [foodNotes, setFoodNotes] = useState<Record<string, string>>({});
  const [mealSwapNote, setMealSwapNote] = useState<string | null>(null);
  const [treatMealNote, setTreatMealNote] = useState<string | null>(null);
  const [combinationRules, setCombinationRules] = useState<string[]>([]);
  const [instructions, setInstructions] = useState<PlanInstruction[]>([]);


  const [confirmedFlags, setConfirmedFlags] = useState(false);
  const [confirmedRules, setConfirmedRules] = useState(false);


  const reset = () => {
    setFields(null);
    setMealOptions(EMPTY_MEAL_OPTIONS());
    setStoragePath(null);
    setFoodExclusions(null);
    setReviewError(null);
    setFieldFlags({});
    setParseFailures([]);
    setValidation([]);
    setFoodNotes({});
    setMealSwapNote(null);
    setTreatMealNote(null);
    setCombinationRules([]);
    setConfirmedFlags(false);
    setConfirmedRules(false);
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
      const response = data as {
        fields?: FieldsMap; mealOptions?: MealOptionsMap; foodExclusions?: string[] | null;
        error?: string; detail?: string; format?: string; clientName?: string | null; coachName?: string | null;
        needsReview?: boolean; validation?: string[]; debug?: Record<string, unknown>;
        fieldFlags?: Record<string, FieldFlag>; parseFailures?: string[];
        foodNotes?: Record<string, string>; mealSwapNote?: string | null; treatMealNote?: string | null;
        combinationRules?: string[];

      };
      if (response.error || !response.fields) {
        const detail = [
          `Step: parse-mb-pdf`,
          response.detail ?? `Error: ${response.error ?? "unknown parser error"}`,
          response.debug?.step ? `Failing step: ${String(response.debug.step)}` : null,
          response.debug?.storagePath ? `Path: ${String(response.debug.storagePath)}` : null,
        ].filter(Boolean).join("\n");
        setReviewError(detail);
        setReviewOpen(true);
        throw new Error(detail);
      }
      const flags = response.fieldFlags ?? {};
      const failures = response.parseFailures ?? Object.entries(flags).filter(([, v]) => v === "parse_failed").map(([k]) => k);
      setFieldFlags(flags);
      setParseFailures(failures);
      setValidation(response.validation ?? []);
      setFoodNotes(response.foodNotes ?? {});
      setMealSwapNote(response.mealSwapNote ?? null);
      setTreatMealNote(response.treatMealNote ?? null);
      setCombinationRules(response.combinationRules ?? []);
      if (response.needsReview) {
        // Log low-confidence extractions so patterns across documents are visible.
        console.warn("[MbPdfImport] low-confidence extraction", {
          clientId: uploadClientId,
          format: response.format ?? "unknown",
          validation: response.validation ?? [],
          parseFailures: failures,
          absent: Object.entries(flags).filter(([, v]) => v === "absent").map(([k]) => k),
        });
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
      setFoodExclusions(response.foodExclusions ?? null);


      // Persist mb_pdf_path immediately so the uploaded file is never orphaned
      // if the practitioner closes the review dialog without clicking Confirm & Save.
      // Confirm & Save will overwrite this with the same path + parsed fields.
      try {
        const { error: pathErr } = await supabase
          .from("clients")
          .update({ mb_pdf_path: path } as never)
          .eq("id", uploadClientId);
        if (pathErr) console.warn("[MbPdfImport] could not persist mb_pdf_path immediately", pathErr);
        else onSaved?.();
      } catch (e) {
        console.warn("[MbPdfImport] mb_pdf_path immediate save threw", e);
      }

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
    // A practitioner correction clears the flag for that field.
    const hasValue = value !== null && String(value).trim() !== "";
    if (hasValue) {
      setFieldFlags((fl) => (fl[key] === "parse_failed" ? { ...fl, [key]: "ok" } : fl));
      setParseFailures((p) => p.filter((k) => k !== key));
    }
  };


  // Review-dialog edits touch the flat legacy fields; mirror them back into the
  // parsed item list so Starch / ml portions parsed from the PDF are preserved.
  const reconcileItems = (opt: MealOption): MealOption => {
    const items = [...(opt.items ?? [])];
    const isVeg = (c: string) => /^(veg|vegetable)/i.test(c);
    const isProtein = (c: string) => !isVeg(c) && !/^(starch|bread|fruit|fat)/i.test(c);

    const pi = items.findIndex((it) => isProtein(it.category));
    if (opt.protein_category) {
      const unit = opt.protein_grams == null
        ? "as_listed"
        : /egg/i.test(opt.protein_category)
          ? "count"
          : (pi >= 0 && items[pi].unit === "ml" ? "ml" : "g");
      const next = { category: opt.protein_category, qty: opt.protein_grams, unit };
      if (pi >= 0) items[pi] = next; else items.unshift(next);
    } else if (pi >= 0) items.splice(pi, 1);

    const vi = items.findIndex((it) => isVeg(it.category));
    if (opt.veg_grams != null) {
      const next = { category: vi >= 0 ? items[vi].category : "Vegetables", qty: opt.veg_grams, unit: "g" };
      if (vi >= 0) items[vi] = next; else items.push(next);
    } else if (vi >= 0) items.splice(vi, 1);

    for (const [flag, category] of [[opt.has_fruit, "Fruit"], [opt.has_bread, "Bread"]] as const) {
      const i = items.findIndex((it) => it.category.toLowerCase() === category.toLowerCase());
      if (flag && i < 0) items.push({ category, qty: null, unit: "as_listed" });
      if (!flag && i >= 0) items.splice(i, 1);
    }

    return { ...opt, items };
  };

  const updateOption = (meal: MealKey, idx: number, patch: Partial<MealOption>) => {
    setMealOptions((m) => ({
      ...m,
      [meal]: m[meal].map((o, i) => (i === idx ? reconcileItems({ ...o, ...patch }) : o)),
    }));
  };


  const save = async () => {
    if (!fields || !storagePath) return;
    setBusy(true);
    try {
      const update: Record<string, unknown> = { mb_pdf_path: storagePath };
      // Fetch existing food_limits so the parser-extracted values merge into them
      // instead of clobbering practitioner-edited limits.
      let existingLimits: Record<string, number> = {};
      try {
        const { data: existing } = await supabase
          .from("clients")
          .select("food_limits")
          .eq("id", clientId)
          .maybeSingle();
        const fl = (existing as { food_limits?: unknown } | null)?.food_limits;
        if (fl && typeof fl === "object") {
          existingLimits = fl as Record<string, number>;
        }
      } catch { /* ignore */ }

      for (const [k, v] of Object.entries(fields)) {
        const val = v.value;
        if (k === "food_limits") {
          const parsed = (val && typeof val === "object") ? val as Record<string, number> : {};
          const merged = canonicaliseFoodLimits({ ...existingLimits, ...parsed });
          update.food_limits = merged;
          // Food caps (mb_food_limits) are the MB source of truth — mirror the
          // parsed weekly limits there too, preserving any non-weekly caps.
          const { data: existingCaps } = await supabase
            .from("clients")
            .select("mb_food_limits")
            .eq("id", clientId)
            .maybeSingle();
          const prevCaps = parseMbFoodLimits((existingCaps as { mb_food_limits?: unknown } | null)?.mb_food_limits);
          const weekly = Object.entries(merged).map(([food, max]) => {
            const prior = prevCaps.find((r) => r.food.trim().toLowerCase() === food.toLowerCase());
            return {
              id: prior?.id ?? (globalThis.crypto?.randomUUID?.() ?? `${food}-${Date.now()}`),
              food,
              type: "weekly" as const,
              max: Number(max),
              unit: prior?.unit ?? "count",
              ...(prior?.note ? { note: prior.note } : {}),
            };
          });
          update.mb_food_limits = weekly;
          continue;

        }
        // Coerce numeric fields
        const numericKeys = new Set([
          "breakfast_protein_grams", "breakfast_veg_grams",
          "lunch_protein_grams", "lunch_veg_grams",
          "dinner_protein_grams", "dinner_veg_grams",
          "eggs_min_per_week",
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
      // Seed the colour plan straight from the parsed items (draft, unconfirmed)
      // so Starch / ml portions are not lost through the legacy flat fields.
      update.mb_plan = mbPlanFromParsedOptions(mealOptions);
      update.food_exclusions = foodExclusions && foodExclusions.length ? foodExclusions : null;

      // Free-text guidance from the document → client-visible plan instructions.
      // Merged into whatever is already stored so practitioner-authored entries
      // and previously imported ones survive a re-import.
      const incoming = [
        ...Object.entries(foodNotes)
          .filter(([, v]) => v && v.trim().length > 0)
          .map(([k, v]) => makeInstruction(v, "parsed", FIELD_LABELS[k] ?? k)),
        ...(mealSwapNote ? [makeInstruction(mealSwapNote, "parsed", "Meal swaps")] : []),
        ...(treatMealNote ? [makeInstruction(treatMealNote, "parsed", "Treat meal")] : []),
        ...combinationRules.map((t) => makeInstruction(t, "parsed", "Food combinations")),
      ];
      if (incoming.length) {
        const { data: existingPi } = await supabase
          .from("clients")
          .select("plan_instructions")
          .eq("id", clientId)
          .maybeSingle();
        const prior = parsePlanInstructions(
          (existingPi as { plan_instructions?: unknown } | null)?.plan_instructions,
        );
        update.plan_instructions = mergeInstructions(prior, incoming);
      }

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
    // "absent" = the category is not part of this client's plan (optional, no action).
    // "parse_failed" = printed in the document but nothing came out (needs attention).
    const flag: FieldFlag = extracted ? "ok" : (fieldFlags[k] ?? "parse_failed");
    const failed = flag === "parse_failed";
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Label className="text-xs">{label}</Label>
          {failed && (
            <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3 w-3" /> In the plan but not parsed — please check
            </span>
          )}
          {flag === "absent" && (
            <span className="text-[10px] text-muted-foreground">Not in this client's plan</span>
          )}
        </div>
        {type === "textarea" ? (
          <Textarea
            value={(f?.value as string) ?? ""}
            onChange={(e) => update(k, e.target.value)}
            className={`min-h-[60px] text-sm ${failed ? "border-amber-400" : ""}`}
            placeholder={flag === "absent" ? "Not allocated — leave empty" : "Comma-separated list"}
          />
        ) : (
          <Input
            type={type}
            step={type === "number" ? "any" : undefined}
            value={f?.value == null ? "" : String(f.value)}
            onChange={(e) => update(k, type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value)}
            className={`h-8 ${failed ? "border-amber-400" : ""}`}
          />
        )}
      </div>
    );
  };

  const VALIDATION_LABELS: Record<string, string> = {
    meal_options: "Meal suggestions",
    food_categories: "Food list categories",
    water_target: "Water target",
    client_name: "Client name (footer)",
    coach_name: "Coach name (footer)",
  };
  const FIELD_LABELS: Record<string, string> = LABELS;
  const openFlags = parseFailures.filter((k) => !fields?.[k]?.extracted);
  const needsConfirm = openFlags.length > 0 || validation.length > 0;
  const rawLimits: unknown = fields?.food_limits?.value ?? null;
  const foodLimits = (rawLimits && typeof rawLimits === "object" ? rawLimits : null) as Record<string, number> | null;

  const hasExtras = !!(foodLimits && Object.keys(foodLimits).length) || instructions.length > 0;


  return (
    <>
      <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={handleFile} />
      <Button type="button" size="sm" variant="outline" onClick={startUpload} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
        {hasUpload ? "Re-upload MB PDF" : "Upload MB PDF"}
        {hasUpload && !busy && (
          <span className="inline-flex items-center gap-1 ml-1 text-emerald-600 dark:text-emerald-400" aria-label="MB PDF on file">
            <CheckCircle2 className="h-3.5 w-3.5" fill="currentColor" stroke="white" />
          </span>
        )}
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

          {fields && needsConfirm && (
            <Alert className="border-amber-400">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertTitle>Low-confidence extraction — check before saving</AlertTitle>
              <AlertDescription className="text-xs space-y-1">
                {validation.length > 0 && (
                  <p>Could not confidently extract: {validation.map((v) => VALIDATION_LABELS[v] ?? v).join(", ")}.</p>
                )}
                {openFlags.length > 0 && (
                  <p>
                    These categories appear in the document but failed to parse:{" "}
                    {openFlags.map((k) => FIELD_LABELS[k] ?? k).join(", ")}.
                  </p>
                )}
                <p className="text-muted-foreground">
                  Categories marked "Not in this client's plan" are simply not allocated — you can leave those empty.
                </p>
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

              {hasExtras && (
                <section className="rounded-md border p-3 space-y-3">
                  <h3 className="text-sm font-semibold">Per-client rules extracted from the plan</h3>
                  <p className="text-xs text-muted-foreground">Read-only. Confirm these look right before saving.</p>

                  {foodLimits && Object.keys(foodLimits).length > 0 && (
                    <div>
                      <p className="text-xs font-medium mb-1">Weekly limits</p>
                      <ul className="text-xs text-muted-foreground space-y-0.5">
                        {Object.entries(foodLimits).map(([k, v]) => (
                          <li key={k}><span className="capitalize text-foreground">{k}</span>: max {v} × / week</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <PlanInstructionsEditor
                    value={instructions}
                    onChange={setInstructions}
                    className="border-0 p-0"
                    title="Plan instructions"
                    description="Correct anything mis-parsed or add your own. These are shown to the client on their My Plan tab."
                  />


                  <label className="flex items-start gap-2 text-xs pt-1">
                    <Checkbox checked={confirmedRules} onCheckedChange={(c) => setConfirmedRules(!!c)} />
                    <span>I've reviewed these per-client rules.</span>
                  </label>
                </section>
              )}
            </div>
          )}

          {fields && needsConfirm && (
            <label className="flex items-start gap-2 text-xs rounded-md border border-amber-400 p-3">
              <Checkbox checked={confirmedFlags} onCheckedChange={(c) => setConfirmedFlags(!!c)} />
              <span>I've checked the flagged fields above and corrected anything that was mis-parsed.</span>
            </label>
          )}

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => { reset(); setTimeout(startUpload, 50); }} disabled={busy}>
              Re-upload
            </Button>
            <Button
              type="button"
              onClick={save}
              disabled={busy || (needsConfirm && !confirmedFlags) || (hasExtras && !confirmedRules)}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirm and Save
            </Button>
          </DialogFooter>

        </DialogContent>
      </Dialog>
    </>
  );
}
