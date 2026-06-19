import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { MB_FOODS, type MealType, type OptionDef } from "@/lib/mb-foods";
import { oilAllowed as oilAllowedFn, type Phase } from "@/lib/phases";

export type LockedRecipe = { recipe_title: string; recipe: string[]; method: string[]; notes: string[] };

interface Props {
  token: string;
  meal: MealType;
  variant: "primary" | "alt";
  optionDef: OptionDef;
  phase: Phase;
  foodLimits: Record<string, number>;
  foodLimitCounts: Record<string, number>;

  lockedRecipe: LockedRecipe | null;
  lockedSelections: Record<string, string>;
  sectionTitle?: string;
  extraComponents: { key: string; label: string; qty: string; sources: (keyof typeof MB_FOODS)[]; optional?: boolean }[];
  filteredSources: (sources: (keyof typeof MB_FOODS)[]) => string[];
  onLogged: () => Promise<void> | void;
  blockGeneration?: { reason: string } | null;
  fullScreenOnSelect?: boolean;
  lunchProteinBonus?: number;
  lunchCarbBonus?: number;
}

const LUNCH_PROTEIN_SOURCES = new Set(["poultry", "fish", "seafood", "meat", "cheese", "legumes"]);
const LUNCH_CARB_SOURCES = new Set(["bread", "starch"]);

function applyLunchBonus(
  qty: string,
  sources: (keyof typeof MB_FOODS)[],
  meal: MealType,
  proteinBonus: number,
  carbBonus: number,
): string {
  if (meal !== "lunch") return qty;
  const isProtein = sources.some((s) => LUNCH_PROTEIN_SOURCES.has(s as string));
  const isCarb = sources.some((s) => LUNCH_CARB_SOURCES.has(s as string));
  const add = isProtein ? proteinBonus : isCarb ? carbBonus : 0;
  if (!add) return qty;
  const m = (qty || "").match(/^(\d+(?:\.\d+)?)\s*g\b(.*)$/i);
  if (m) return `${Math.round(parseFloat(m[1]) + add)}g${m[2] ?? ""} (base ${m[1]}g + ${add}g)`;
  return `${qty} + ${add}g`;
}

const OIL_OPTIONS = [
  { value: "none", label: "None" },
  { value: "Cold-Pressed Olive Oil", label: "Cold-Pressed Olive Oil" },
  { value: "Cold-Pressed Flaxseed Oil", label: "Cold-Pressed Flaxseed Oil" },
  { value: "Cold-Pressed Coconut Oil", label: "Cold-Pressed Coconut Oil" },
  { value: "Avocado Oil", label: "Avocado Oil" },
  { value: "Ghee (clarified butter)", label: "Ghee (clarified butter)" },
];

export default function MealRecipeSection({
  token, meal, variant, optionDef, phase, foodLimits, foodLimitCounts,
  lockedRecipe, lockedSelections, sectionTitle, extraComponents, filteredSources, onLogged, blockGeneration, fullScreenOnSelect,
}: Props) {

  const [picks, setPicks] = useState<Record<string, string>>({});
  const [oil, setOil] = useState<string>("none");
  const [generating, setGenerating] = useState(false);
  const [recipeOptions, setRecipeOptions] = useState<LockedRecipe[]>([]);
  const [lastIngredients, setLastIngredients] = useState<Array<{ label: string; qty: string }>>([]);
  const [regenCount, setRegenCount] = useState(0);
  const [loggingIdx, setLoggingIdx] = useState<number | null>(null);
  const [eggConfirm, setEggConfirm] = useState<{ idx: number; recipe: LockedRecipe; eggsInMeal: number; eggsUsed: number; eggsMax: number } | null>(null);
  const [loggingLocked, setLoggingLocked] = useState(false);
  const [eggConfirmLocked, setEggConfirmLocked] = useState<{ eggsInMeal: number; eggsUsed: number; eggsMax: number } | null>(null);
  const [fullScreenIdx, setFullScreenIdx] = useState<number | null>(null);
  const regenLimitReached = regenCount >= 1;
  const oilAllow = oilAllowedFn(phase);

  // Pre-apply locked selections from the weekly plan once
  useEffect(() => {
    if (!Object.keys(lockedSelections).length) return;
    setPicks((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(lockedSelections)) {
        if (!next[k]) next[k] = lockedSelections[k];
      }
      return next;
    });
  }, [lockedSelections]);

  const restrictedItems = (sources: (keyof typeof MB_FOODS)[], componentKey: string): string[] => {
    const base = filteredSources(sources);
    const lockedPick = lockedSelections[componentKey];
    if (lockedPick) return base.filter((i) => i === lockedPick);
    return base;
  };

  const buildIngredients = () => {
    const veg1 = optionDef.components.find((c) => c.key === "veg1");
    const veg2 = optionDef.components.find((c) => c.key === "veg2");
    const bothVeg = veg1 && veg2 && picks["veg1"] && picks["veg2"];
    let veg1Qty = veg1?.qty ?? "";
    let veg2Qty = veg2?.qty ?? "";
    if (bothVeg) {
      const m = (veg1!.qty || "").match(/(\d+(?:\.\d+)?)\s*g/i);
      if (m) {
        const half = Math.round(parseFloat(m[1]) / 2);
        veg1Qty = `${half}g`;
        veg2Qty = `${half}g`;
      }
    }
    return [
      ...(optionDef.fixed ?? []).map((f) => ({ label: f.label, qty: f.qty })),
      ...optionDef.components.filter((c) => picks[c.key]).map((c) => {
        let qty = c.qty || "see option";
        if (c.key === "veg1") qty = veg1Qty || qty;
        if (c.key === "veg2") qty = veg2Qty || "see option";
        return { label: `${c.label}: ${picks[c.key]}`, qty };
      }),
      ...(picks["starch_extra"] ? [{ label: `Starches: ${picks["starch_extra"]}`, qty: "as advised" }] : []),
      ...(picks["legumes_extra"] ? [{ label: `Legumes: ${picks["legumes_extra"]}`, qty: "as advised" }] : []),
    ];
  };

  const generate = async () => {
    if (blockGeneration) {
      toast.error(blockGeneration.reason);
      return;
    }
    for (const c of optionDef.components) {
      if (!c.optional && !picks[c.key]) return toast.error(`Choose: ${c.label}`);
    }
    const isRegen = recipeOptions.length > 0;
    if (isRegen && regenLimitReached) {
      toast.error("Regeneration limit reached for this meal option.");
      return;
    }
    const ingredients = buildIngredients();
    setGenerating(true);
    setRecipeOptions([]);
    try {
      const { data, error } = await supabase.functions.invoke("generate-mb-recipe", {
        body: { token, meal_type: meal, option_label: optionDef.label, ingredients, oil: oilAllow ? oil : "none" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const opts: LockedRecipe[] = Array.isArray(data?.options) ? data.options : [];
      if (opts.length === 0) throw new Error("No recipes returned");
      setRecipeOptions(opts);
      setLastIngredients(ingredients);
      if (isRegen) setRegenCount((n) => n + 1);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to generate");
    } finally {
      setGenerating(false);
    }
  };

  const logRecipe = async (
    recipe: LockedRecipe,
    ingredients: Array<{ label: string; qty: string }>,
    force = false,
  ) => {
    const { data, error } = await supabase.functions.invoke("log-mb-meal", {
      body: { token, meal_type: meal, option_label: optionDef.label, ingredients, recipe, variant, force },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
  };

  const handleLogFromOptions = async (idx: number, recipe: LockedRecipe, force = false) => {
    setLoggingIdx(idx);
    try {
      const data = await logRecipe(recipe, lastIngredients, force);
      if (data?.requires_confirmation && data.reason === "eggs_over_limit") {
        setEggConfirm({
          idx,
          recipe,
          eggsInMeal: Number(data.eggs_in_meal) || 0,
          eggsUsed: Number(data.eggs_used_this_week) || 0,
          eggsMax: Number(data.eggs_max_per_week) || 0,
        });
        return;
      }
      toast.success("Meal logged");
      await onLogged();
      setRecipeOptions([]);
      setFullScreenIdx(null);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to log meal");
    } finally {
      setLoggingIdx(null);
    }
  };

  const handleLogLocked = async (force = false) => {
    if (!lockedRecipe) return;
    setLoggingLocked(true);
    try {
      // Reconstruct ingredients from the locked picks; if missing, fall back to a single-line.
      const ingredients = (() => {
        try {
          const apply = lockedSelections;
          const tempPicks = { ...apply };
          const built = (() => {
            const arr: Array<{ label: string; qty: string }> = [];
            arr.push(...(optionDef.fixed ?? []).map((f) => ({ label: f.label, qty: f.qty })));
            for (const c of optionDef.components) {
              const pick = tempPicks[c.key];
              if (pick) arr.push({ label: `${c.label}: ${pick}`, qty: c.qty || "as advised" });
            }
            return arr;
          })();
          if (built.length > 0) return built;
          return [{ label: lockedRecipe.recipe_title, qty: "1 serving" }];
        } catch {
          return [{ label: lockedRecipe.recipe_title, qty: "1 serving" }];
        }
      })();
      const data = await logRecipe(lockedRecipe, ingredients, force);
      if (data?.requires_confirmation && data.reason === "eggs_over_limit") {
        setEggConfirmLocked({
          eggsInMeal: Number(data.eggs_in_meal) || 0,
          eggsUsed: Number(data.eggs_used_this_week) || 0,
          eggsMax: Number(data.eggs_max_per_week) || 0,
        });
        return;
      }
      toast.success("Meal logged");
      await onLogged();
    } catch (e: any) {
      toast.error(e.message ?? "Failed to log meal");
    } finally {
      setLoggingLocked(false);
    }
  };

  const title = sectionTitle ?? optionDef.label;

  // === Locked view ===
  if (lockedRecipe) {
    return (
      <>
        <Card className="p-4 border-primary space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase text-muted-foreground">{title}</p>
              <p className="font-medium">{lockedRecipe.recipe_title}</p>
            </div>
            <span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary font-medium">Locked for this week</span>
          </div>
          <Tabs defaultValue="recipe">
            <TabsList>
              <TabsTrigger value="recipe">Recipe</TabsTrigger>
              <TabsTrigger value="method">Method</TabsTrigger>
              <TabsTrigger value="notes">Notes</TabsTrigger>
            </TabsList>
            <TabsContent value="recipe" className="pt-3">
              <ul className="list-disc list-inside text-sm space-y-1">{lockedRecipe.recipe.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </TabsContent>
            <TabsContent value="method" className="pt-3">
              <div className="text-sm space-y-2">{lockedRecipe.method.map((s, i) => <p key={i}>{s}</p>)}</div>
            </TabsContent>
            <TabsContent value="notes" className="pt-3">
              <ul className="list-disc list-inside text-sm space-y-1">{lockedRecipe.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
            </TabsContent>
          </Tabs>
          <Button className="w-full" disabled={loggingLocked} onClick={() => handleLogLocked(false)}>
            {loggingLocked ? "Logging…" : "I Ate This"}
          </Button>
        </Card>

        <Dialog open={!!eggConfirmLocked} onOpenChange={(o) => !o && setEggConfirmLocked(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Egg limit reached</DialogTitle>
            </DialogHeader>
            {eggConfirmLocked && (
              <p className="text-sm">
                This meal contains {eggConfirmLocked.eggsInMeal} egg(s). You've already logged {eggConfirmLocked.eggsUsed} of {eggConfirmLocked.eggsMax} eggs this week.
                Log anyway?
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setEggConfirmLocked(null)}>Cancel</Button>
              <Button onClick={async () => { setEggConfirmLocked(null); await handleLogLocked(true); }}>Log anyway</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // === Builder view ===
  const allComponents = [...optionDef.components, ...extraComponents];

  // Generic food-limit lookup. Returns the matched limit key (lowercase) if the
  // ingredient label contains a key from foodLimits AND the client has hit it.
  const limitedKeyForLabel = (label: string): string | null => {
    const l = label.toLowerCase();
    for (const [key, max] of Object.entries(foodLimits)) {
      const m = Number(max);
      if (!m || m <= 0) continue;
      const used = Number(foodLimitCounts[key] ?? 0);
      if (used < m) continue;
      // Match by substring on the key (e.g. "avocado", "eggs"). Singular/plural tolerant.
      const k = key.toLowerCase();
      const stem = k.endsWith("s") ? k.slice(0, -1) : k;
      const re = new RegExp(`\\b${stem}s?\\b`, "i");
      if (re.test(l)) return key;
    }
    return null;
  };

  return (
    <>
      <Card className="p-4 space-y-4">
        <div>
          <p className="text-xs uppercase text-muted-foreground">{title}</p>
          <p className="font-medium">{optionDef.label}</p>
        </div>
        {optionDef.fixed?.map((f, i) => (
          <p key={i} className="text-sm text-muted-foreground">Fixed: <span className="font-medium text-foreground">{f.label} — {f.qty}</span></p>
        ))}
        {allComponents.map((comp) => {
          const items = restrictedItems(comp.sources, comp.key);
          const showOilBefore = oilAllow && comp.key === "fruit";
          return (
            <div key={comp.key} className="space-y-3">
              {showOilBefore && (
                <div className="space-y-1">
                  <Label>Oil (optional)</Label>
                  <Select value={oil} onValueChange={setOil}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {OIL_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Up to 1 tbsp (15ml) per meal · max 3 tbsp total per day.</p>
                </div>
              )}
              <div className="space-y-1">
                <Label>{comp.label}{comp.qty && <span className="text-muted-foreground font-normal"> · {comp.qty}</span>}</Label>
                <Select
                  value={picks[comp.key] ?? ""}
                  onValueChange={(v) => {
                    const limitedKey = limitedKeyForLabel(v);
                    if (limitedKey) {
                      toast.error(`You've reached your weekly limit for ${limitedKey}. Please choose a different option.`);
                      return;
                    }
                    setPicks((p) => ({ ...p, [comp.key]: v }));
                  }}
                >
                  <SelectTrigger><SelectValue placeholder={comp.optional ? "Optional" : "Select…"} /></SelectTrigger>
                  <SelectContent>
                    {items.map((i) => {
                      const limitedKey = limitedKeyForLabel(i);
                      const disabled = !!limitedKey;
                      return (
                        <SelectItem key={i} value={i} disabled={disabled} className={disabled ? "opacity-50" : undefined}>
                          {i}{disabled ? " (limit reached)" : ""}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            </div>
          );
        })}


        {oilAllow && !optionDef.components.some((c) => c.key === "fruit") && (
          <div className="space-y-1">
            <Label>Oil (optional)</Label>
            <Select value={oil} onValueChange={setOil}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {OIL_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Up to 1 tbsp (15ml) per meal · max 3 tbsp total per day.</p>
          </div>
        )}

        {blockGeneration && (
          <p className="text-xs text-destructive">{blockGeneration.reason}</p>
        )}
        <Button onClick={generate} disabled={generating || !!blockGeneration} className="w-full">
          {generating ? "Generating recipes…" : "Generate Recipes"}
        </Button>
      </Card>

      {recipeOptions.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{recipeOptions.length} recipe options — swipe to choose</p>
            <Button size="sm" variant="outline" onClick={generate} disabled={generating || regenLimitReached}>
              {regenLimitReached ? "No regenerations left" : "Generate new options"}
            </Button>
          </div>
          <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 -mx-4 px-4">
            {recipeOptions.map((r, idx) => (
              <Card key={idx} className="p-4 shrink-0 w-[85%] sm:w-[420px] snap-start">
                <p className="font-medium mb-3">Option {idx + 1}: {r.recipe_title}</p>
                <Tabs defaultValue="recipe">
                  <TabsList>
                    <TabsTrigger value="recipe">Recipe</TabsTrigger>
                    <TabsTrigger value="method">Method</TabsTrigger>
                    <TabsTrigger value="notes">Notes</TabsTrigger>
                  </TabsList>
                  <TabsContent value="recipe" className="pt-3">
                    <ul className="list-disc list-inside text-sm space-y-1">{r.recipe.map((x, i) => <li key={i}>{x}</li>)}</ul>
                  </TabsContent>
                  <TabsContent value="method" className="pt-3">
                    <div className="text-sm space-y-2">{r.method.map((s, i) => <p key={i}>{s}</p>)}</div>
                  </TabsContent>
                  <TabsContent value="notes" className="pt-3">
                    <ul className="list-disc list-inside text-sm space-y-1">{r.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
                  </TabsContent>
                </Tabs>
                <Button
                  className="w-full mt-3"
                  disabled={loggingIdx !== null}
                  onClick={() => {
                    if (fullScreenOnSelect) setFullScreenIdx(idx);
                    else handleLogFromOptions(idx, r, false);
                  }}
                >
                  {loggingIdx === idx ? "Selecting…" : "Select this recipe"}
                </Button>
              </Card>
            ))}
          </div>
        </div>
      )}

      <Dialog open={!!eggConfirm} onOpenChange={(o) => !o && setEggConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Egg limit reached</DialogTitle>
          </DialogHeader>
          {eggConfirm && (
            <p className="text-sm">
              This meal contains {eggConfirm.eggsInMeal} egg(s). You've already logged {eggConfirm.eggsUsed} of {eggConfirm.eggsMax} eggs this week. Log anyway?
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEggConfirm(null)}>Cancel</Button>
            <Button onClick={async () => {
              if (!eggConfirm) return;
              const { idx, recipe } = eggConfirm;
              setEggConfirm(null);
              await handleLogFromOptions(idx, recipe, true);
            }}>Log anyway</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {fullScreenIdx !== null && recipeOptions[fullScreenIdx] && (() => {
        const r = recipeOptions[fullScreenIdx];
        return (
          <div className="fixed inset-0 z-50 bg-background flex flex-col">
            <div className="flex items-center gap-3 p-4 border-b shrink-0">
              <Button variant="ghost" size="icon" onClick={() => setFullScreenIdx(null)} aria-label="Back">
                <ArrowLeft />
              </Button>
              <p className="font-semibold text-base truncate">{r.recipe_title}</p>
            </div>
            <div className="flex-1 overflow-y-auto p-4 pb-28">
              <Tabs defaultValue="recipe">
                <TabsList className="w-full">
                  <TabsTrigger value="recipe" className="flex-1">Recipe</TabsTrigger>
                  <TabsTrigger value="method" className="flex-1">Method</TabsTrigger>
                  <TabsTrigger value="notes" className="flex-1">Notes</TabsTrigger>
                </TabsList>
                <TabsContent value="recipe" className="pt-3">
                  <ul className="list-disc list-inside text-sm space-y-1">
                    {r.recipe.map((x, i) => <li key={i}>{x}</li>)}
                  </ul>
                </TabsContent>
                <TabsContent value="method" className="pt-3">
                  <div className="text-sm space-y-2">
                    {r.method.map((s, i) => <p key={i}>{s}</p>)}
                  </div>
                </TabsContent>
                <TabsContent value="notes" className="pt-3">
                  <ul className="list-disc list-inside text-sm space-y-1">
                    {r.notes.map((n, i) => <li key={i}>{n}</li>)}
                  </ul>
                </TabsContent>
              </Tabs>
            </div>
            <div className="fixed bottom-0 left-0 right-0 p-4 border-t bg-background">
              <Button
                className="w-full"
                disabled={loggingIdx !== null}
                onClick={() => handleLogFromOptions(fullScreenIdx, r, false)}
              >
                {loggingIdx === fullScreenIdx ? "Logging…" : "I Ate This"}
              </Button>
            </div>
          </div>
        );
      })()}
    </>
  );
}
