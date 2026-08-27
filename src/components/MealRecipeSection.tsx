import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { MB_FOODS, type MealType, type OptionDef } from "@/lib/mb-foods";
import { oilAllowed as oilAllowedFn, type Phase } from "@/lib/phases";
import { capTallyFor, capBlocksMeal, describeMealBlock, type CapFold } from "@/lib/mb-food-list";

export type LockedRecipe = { recipe_title: string; recipe: string[]; method: string[]; notes: string[] };

interface Props {
  token: string;
  meal: MealType;
  variant: "primary" | "alt";
  optionDef: OptionDef;
  phase: Phase;
  foodLimits: Record<string, number>;
  /** MB weekly ledger fold for the current cap window (Phase 5: sole usage source). */
  capFold: CapFold | null;

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
  isEggMeal = false,
): string {
  if (meal !== "lunch") return qty;
  const isProtein = sources.some((s) => LUNCH_PROTEIN_SOURCES.has(s as string));
  const isCarb = sources.some((s) => LUNCH_CARB_SOURCES.has(s as string));
  // Egg-based lunch meals: skip protein bonus (carb bonus still applies).
  const effectiveProtein = isEggMeal ? 0 : proteinBonus;
  const add = isProtein ? effectiveProtein : isCarb ? carbBonus : 0;
  if (!add) return qty;
  const m = (qty || "").match(/^(\d+(?:\.\d+)?)\s*g\b(.*)$/i);
  if (m) return `${Math.round(parseFloat(m[1]) + add)}g${m[2] ?? ""} (base ${m[1]}g + ${add}g)`;
  return `${qty} + ${add}g`;
}

// Formats bread/starch item names with Phase 3 carb bonus breakdown.
// e.g. "100% Rye Crackers (10g)" → "100% Rye Crackers · 15g (base 10g + 5g)"
function bumpBreadName(name: string, add: number): string {
  const bonus = Number(add) || 0;
  if (!bonus) return name;
  const m = name.match(/^(.*)\s*\((\d+(?:\.\d+)?)\s*g\s*\)$/i);
  if (!m) return name;
  const baseName = m[1].trim();
  const baseGrams = parseFloat(m[2]);
  const total = Math.round(baseGrams + bonus);
  return `${baseName} · ${total}g (base ${Math.round(baseGrams)}g + ${bonus}g)`;
}

function isLunchCarb(sources: (keyof typeof MB_FOODS)[], meal: MealType): boolean {
  if (meal !== "lunch") return false;
  return sources.some((s) => LUNCH_CARB_SOURCES.has(s as string));
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
  token, meal, variant, optionDef, phase, foodLimits, capFold,
  lockedRecipe, lockedSelections, sectionTitle, extraComponents, filteredSources, onLogged, blockGeneration, fullScreenOnSelect,
  lunchProteinBonus = 0, lunchCarbBonus = 0,
}: Props) {

  const [picks, setPicks] = useState<Record<string, string>>({});
  const [oil, setOil] = useState<string>("none");
  const [generating, setGenerating] = useState(false);
  const [recipeOptions, setRecipeOptions] = useState<LockedRecipe[]>([]);
  const [lastIngredients, setLastIngredients] = useState<Array<{ label: string; qty: string }>>([]);
  const [regenCount, setRegenCount] = useState(0);
  const [loggingIdx, setLoggingIdx] = useState<number | null>(null);
  const [loggingLocked, setLoggingLocked] = useState(false);
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

  const restrictedItems = (sources: (keyof typeof MB_FOODS)[], componentKey: string, explicit?: string[]): string[] => {
    const base = explicit && explicit.length ? explicit : filteredSources(sources);
    const lockedPick = lockedSelections[componentKey];
    if (lockedPick) return base.filter((i) => i === lockedPick);
    return base;
  };

  const buildIngredients = () => {
    // A second vegetable splits the single combined allowance 50/50; with one
    // vegetable picked, that one keeps the full amount. Portions never double.
    const vegSplit = vegQtyOverrides(optionDef.components, picks);
    return [
      ...(optionDef.fixed ?? []).map((f) => ({ label: f.label, qty: f.qty })),
      ...optionDef.components.filter((c) => picks[c.key]).map((c) => {
        let qty = vegSplit[c.key] ?? c.qty ?? "";
        if (!qty) qty = "see option";
        // For bread/starch the gram amount lives inside the picked item name, e.g.
        // "100% Rye Crackers (10g)". Extract it so the recipe generator receives a
        // real gram qty and the carb bonus can be applied server-side.
        if (isLunchCarb(c.sources, meal)) {
          const gm = (picks[c.key] || "").match(/\((\d+(?:\.\d+)?)\s*g\)/i);
          if (gm) qty = `${gm[1]}g`;
        }
        return { label: `${c.label}: ${picks[c.key]}`, qty };
      }),
      ...(picks["starch_extra"] ? [{ label: `Starches: ${picks["starch_extra"]}`, qty: "as advised" }] : []),
      ...(picks["legumes_extra"] ? [{ label: `Legumes: ${picks["legumes_extra"]}`, qty: "as advised" }] : []),
    ];
  };

  const generate = async () => {
    if (effectiveBlock) {
      toast.error(effectiveBlock.reason);
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
  ) => {
    const { data, error } = await supabase.functions.invoke("log-mb-meal", {
      body: { token, meal_type: meal, option_label: optionDef.label, ingredients, recipe, variant },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
  };

  const handleLogFromOptions = async (idx: number, recipe: LockedRecipe) => {
    setLoggingIdx(idx);
    try {
      await logRecipe(recipe, lastIngredients);
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

  const handleLogLocked = async () => {
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
      await logRecipe(lockedRecipe, ingredients);
      toast.success("Meal logged");
      await onLogged();
    } catch (e: any) {
      toast.error(e.message ?? "Failed to log meal");
    } finally {
      setLoggingLocked(false);
    }
  };

  const title = sectionTitle ?? optionDef.label;

  // ---- Hard weekly caps, enforced at SELECTION (all foods, eggs included) ----
  const capIngredients = (selections: Record<string, string>) => [
    ...(optionDef.fixed ?? []).map((f) => ({ label: f.label, qty: f.qty })),
    ...optionDef.components
      .filter((c) => selections[c.key])
      .map((c) => ({ label: selections[c.key], qty: c.qty || "" })),
  ];
  // Planned rows for this meal were already cap-validated at run confirm, so
  // the client's own commitment must never block them from eating it.
  const plannedAllowance: CapFold | null = capFold
    ? { eaten: {}, planned: {}, committed: capFold.planned ?? {} }
    : null;
  const lockedBlock = lockedRecipe
    ? capBlocksMeal(capIngredients(lockedSelections), foodLimits, capFold, plannedAllowance)
    : null;
  const builderBlock = capBlocksMeal(capIngredients(picks), foodLimits, capFold, plannedAllowance);
  const capBlockReason = (b: ReturnType<typeof capBlocksMeal>) => (b ? describeMealBlock(b) : null);
  const effectiveBlock =
    blockGeneration ?? (builderBlock ? { reason: capBlockReason(builderBlock)! } : null);

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
          {lockedBlock && (
            <p className="text-xs text-destructive">{capBlockReason(lockedBlock)}</p>
          )}
          <Button className="w-full" disabled={loggingLocked || !!lockedBlock} onClick={() => handleLogLocked()}>
            {loggingLocked ? "Logging…" : "I Ate This"}
          </Button>
        </Card>

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
      const used = capTallyFor(key, capFold).committed;
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
          const items = restrictedItems(comp.sources, comp.key, (comp as { items?: string[] }).items);
          const showOilBefore = oilAllow && comp.key === "fruit";
          const eggMeal = !!optionDef.fixed?.some((f) => /egg/i.test(f.label));
          const carbAdd = isLunchCarb(comp.sources, meal) ? lunchCarbBonus : 0;
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
                <Label>{comp.label}{comp.qty && <span className="text-muted-foreground font-normal"> · {applyLunchBonus(comp.qty, comp.sources, meal, lunchProteinBonus, lunchCarbBonus, eggMeal)}</span>}</Label>
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
                  <SelectTrigger>
                    <SelectValue placeholder={comp.optional ? "Optional" : "Select…"}>
                      {picks[comp.key] ? bumpBreadName(picks[comp.key], carbAdd) : null}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {items.map((i) => {
                      const limitedKey = limitedKeyForLabel(i);
                      const disabled = !!limitedKey;
                      const displayLabel = bumpBreadName(i, carbAdd);
                      return (
                        <SelectItem key={`${i}-${displayLabel}`} value={i} textValue={displayLabel} disabled={disabled} className={disabled ? "opacity-50" : undefined}>
                          {displayLabel}{disabled ? " (limit reached)" : ""}
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

        {effectiveBlock && (
          <p className="text-xs text-destructive">{effectiveBlock.reason}</p>
        )}
        <Button onClick={generate} disabled={generating || !!effectiveBlock} className="w-full">
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
                    else handleLogFromOptions(idx, r);
                  }}
                >
                  {loggingIdx === idx ? "Selecting…" : "Select this recipe"}
                </Button>
              </Card>
            ))}
          </div>
        </div>
      )}

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
                onClick={() => handleLogFromOptions(fullScreenIdx, r)}
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
