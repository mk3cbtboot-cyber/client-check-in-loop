import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";
import { Home, ClipboardCheck, BookOpen, CalendarDays } from "lucide-react";
import { MB_FOODS, MB_OPTIONS, MB_RULES, type MealType, type OptionDef } from "@/lib/mb-foods";
import { resolvePhase2Categories } from "@/lib/phase2-food-list";
import { phaseShort, oilAllowed, recipeBuilderEnabled, type Phase } from "@/lib/phases";
import { getPhaseProgress } from "@/lib/progress";
import MealPlanner, { type WeeklyPlan } from "@/components/MealPlanner";

interface ClientState {
  id: string;
  name: string;
  phase: Phase;
  avocado_count_week: number;
  egg_count_week: number;
  water_today_litres: number;
  meal_streak: number;
  phase3_additional_foods: string;
  phase3_meat: string;
  phase3_fish: string;
  phase3_vegetables: string;
  phase3_fruit: string;
  phase3_starches: string;
  phase3_bread: string;
  phase3_dairy: string;
  phase3_other: string;
  phase3_mode: "mb_standard" | "practitioner_custom";
  phase3_mb_fish: string;
  phase3_mb_seafood: string;
  phase3_mb_cheese: string;
  phase3_mb_legumes: string;
  phase3_mb_vegetables: string;
  phase3_mb_fat_oil: string;
  show_rules: boolean;
  weight_unit: "kg" | "lbs";
  length_unit: "cm" | "in";
  height_cm: number | null;
  phase2_strict_started_at: string | null;
  phase2_strict_extra_days: number;
  phase2_food_list: unknown;
  weekly_food_limits: Record<string, number>;
}

type TabKey = "home" | "checkin" | "plan" | "planner";

export default function ClientPortal() {
  const { token } = useParams<{ token: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = (searchParams.get("tab") as TabKey) || "home";
  const [tab, setTab] = useState<TabKey>(["home", "checkin", "plan", "planner"].includes(initialTab) ? initialTab : "home");
  const [weeklyPlan, setWeeklyPlan] = useState<WeeklyPlan | null>(null);

  const [loading, setLoading] = useState(true);
  const [client, setClient] = useState<ClientState | null>(null);

  // Home/recipe builder state
  const [rulesOpen, setRulesOpen] = useState(false);
  const [meal, setMeal] = useState<MealType | null>(null);
  const [option, setOption] = useState<OptionDef | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [oil, setOil] = useState<string>("none");
  
  const [generating, setGenerating] = useState(false);
  const [recipe, setRecipe] = useState<{ recipe_title: string; recipe: string[]; method: string[]; notes: string[] } | null>(null);

  // Check-in state
  const [feeling, setFeeling] = useState<number>(3);
  const [waterLitres, setWaterLitres] = useState<number>(0);
  const [notes, setNotes] = useState("");
  const [submittingCheckin, setSubmittingCheckin] = useState(false);
  const [checkinDone, setCheckinDone] = useState(false);


  // Phase 2 Strict daily progress
  const [weightInput, setWeightInput] = useState<string>("");
  const [weightUnit, setWeightUnit] = useState<"kg" | "lbs">("kg");
  const [lengthUnit, setLengthUnit] = useState<"cm" | "in">("cm");
  const [latestWeightKg, setLatestWeightKg] = useState<number | null>(null);
  const initialRatings = {
    general_wellbeing: 3, fatigue: 3, sleep: 3, headache: 3, pain: 3,
    joint_pain: 3, acid_reflux: 3, digestion: 3, allergy_skin: 3,
  };
  const [ratings, setRatings] = useState<Record<string, number>>(initialRatings);
  const setRating = (k: string, v: number) => setRatings((r) => ({ ...r, [k]: v }));

  // Weekly Phase 2 Strict measurements (stored in cm internally)
  
  const [waistInput, setWaistInput] = useState<string>("");
  const [hipInput, setHipInput] = useState<string>("");
  const [thighInput, setThighInput] = useState<string>("");

  const toCm = (v: string) => {
    if (!v) return undefined;
    const n = Number(v);
    if (!isFinite(n)) return undefined;
    return lengthUnit === "in" ? Math.round(n * 2.54 * 100) / 100 : n;
  };

  const refresh = async () => {
    if (!token) return;
    const { data } = await supabase.functions.invoke("client-portal-data", { body: { token } });
    if (data?.valid) {
      setClient(data.client);
      setWaterLitres(Number(data.client.water_today_litres) || 0);
      setWeightUnit(data.client.weight_unit || "kg");
      setLengthUnit(data.client.length_unit || "cm");
      setLatestWeightKg(data.client.latest_weight_kg ?? null);
    }
  };

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [token]);

  // Load this week's treat meal for Phase 2 Extended / Phase 3 clients
  useEffect(() => {
    if (!token || !client) return;
    if (client.phase !== "phase2_extended" && client.phase !== "phase3") {
      setTreatMeal(null);
      return;
    }
    (async () => {
      const { data } = await supabase.functions.invoke("treat-meal", { body: { token, action: "get" } });
      setTreatMeal(data?.treat_meal ?? null);
    })();
  }, [token, client?.phase]);

  const logTreatMeal = async () => {
    if (!token) return;
    setSubmittingTreat(true);
    const { data, error } = await supabase.functions.invoke("treat-meal", {
      body: { token, action: "log", description: treatDesc, eaten_on: treatDate },
    });
    setSubmittingTreat(false);
    if (error || data?.error) {
      toast.error(data?.error === "date_outside_week" ? "Pick a date within this week" : "Could not log treat meal");
      return;
    }
    setTreatMeal(data.treat_meal);
    setTreatFormOpen(false);
    setTreatDesc("");
    toast.success("Treat meal logged");
  };

  // Load this week's confirmed meal plan (used to restrict the recipe builder)
  useEffect(() => {
    if (!token) return;
    (async () => {
      const { data } = await supabase.functions.invoke("weekly-meal-plan", { body: { token, action: "get" } });
      setWeeklyPlan(data?.plan ?? null);
    })();
  }, [token]);

  const changeTab = (t: TabKey) => {
    setTab(t);
    const next = new URLSearchParams(searchParams);
    if (t === "home") next.delete("tab");
    else next.set("tab", t);
    setSearchParams(next, { replace: true });
    // Re-fetch latest client state (incl. phase3_mode + MB fields) when opening My Plan
    if (t === "plan") void refresh();
  };

  const addWater = async () => {
    const { data, error } = await supabase.functions.invoke("client-portal-water", { body: { token } });
    if (error || data?.error) return toast.error("Could not log water");
    setClient((c) => (c ? { ...c, water_today_litres: data.water_today_litres } : c));
    setWaterLitres(Number(data.water_today_litres) || 0);
  };

  const setWaterAmount = async (litres: number) => {
    const safe = Math.max(0, Math.min(20, Number(litres) || 0));
    setWaterLitres(safe);
    const { data } = await supabase.functions.invoke("client-portal-water", { body: { token, set_litres: safe } });
    if (data?.water_today_litres !== undefined) {
      setClient((c) => (c ? { ...c, water_today_litres: data.water_today_litres } : c));
    }
  };

  const updateWeightUnit = async (unit: "kg" | "lbs") => {
    setWeightUnit(unit);
    setClient((c) => (c ? { ...c, weight_unit: unit } : c));
    await supabase.functions.invoke("update-client-prefs", { body: { token, weight_unit: unit } });
  };

  const updateLengthUnit = async (unit: "cm" | "in") => {
    setLengthUnit(unit);
    setClient((c) => (c ? { ...c, length_unit: unit } : c));
    await supabase.functions.invoke("update-client-prefs", { body: { token, length_unit: unit } });
  };

  const pickOption = (m: MealType, o: OptionDef) => {
    setOption(o);
    setMeal(m);
    setPicks({});
    setOil("none");
    setRecipe(null);
  };

  const OIL_OPTIONS = [
    { value: "none", label: "None" },
    { value: "Cold-Pressed Olive Oil", label: "Cold-Pressed Olive Oil" },
    { value: "Cold-Pressed Flaxseed Oil", label: "Cold-Pressed Flaxseed Oil" },
    { value: "Cold-Pressed Coconut Oil", label: "Cold-Pressed Coconut Oil" },
    { value: "Avocado Oil", label: "Avocado Oil" },
    { value: "Ghee (clarified butter)", label: "Ghee (clarified butter)" },
  ];

  // Phase 3 additional foods, grouped per MB_FOODS category.
  // Each user-facing category maps to one or more recipe-builder source keys.
  // Practitioner Custom mapping: each user-facing category maps to one or more recipe-builder source keys.
  const phase3CustomMap: Record<string, (keyof typeof MB_FOODS)[]> = {
    phase3_meat: ["meat", "poultry"],
    phase3_fish: ["fish", "seafood"],
    phase3_vegetables: ["vegetables", "vegLettuce"],
    phase3_fruit: ["fruit"],
    phase3_starches: ["starch"],
    phase3_bread: ["bread"],
    phase3_dairy: ["cheese", "yogurt", "milkProducts"],
    phase3_other: ["fish","seafood","poultry","meat","cheese","yogurt","milkProducts","vegetables","vegLettuce","fruit","bread","starch","legumes"],
  };

  // MB Standard mapping (Fat/Oil has no recipe-builder source — surfaces only in My Plan)
  const phase3MbMap: Record<string, (keyof typeof MB_FOODS)[]> = {
    phase3_mb_fish: ["fish"],
    phase3_mb_seafood: ["seafood"],
    phase3_mb_cheese: ["cheese"],
    phase3_mb_legumes: ["legumes"],
    phase3_mb_vegetables: ["vegetables", "vegLettuce"],
    phase3_mb_fat_oil: [],
  };

  const parseList = (s: string | undefined | null) =>
    (s ?? "").split(",").map((x) => x.trim()).filter((x) => x.length > 0);

  const phase3ExtrasForSources = (sources: (keyof typeof MB_FOODS)[]): string[] => {
    if (!client) return [];
    if (client.phase !== "phase3" && client.phase !== "phase4") return [];
    const map = client.phase3_mode === "mb_standard" ? phase3MbMap : phase3CustomMap;
    const sourceSet = new Set(sources);
    const out: string[] = [];
    for (const [field, cats] of Object.entries(map)) {
      if (!cats.some((c) => sourceSet.has(c))) continue;
      const value = (client as unknown as Record<string, string>)[field];
      out.push(...parseList(value));
    }
    return out;
  };

  const filteredSources = (sources: (keyof typeof MB_FOODS)[]) => {
    const items = [...sources.flatMap((s) => MB_FOODS[s]), ...phase3ExtrasForSources(sources)];
    const seen = new Set<string>();
    return items.filter((i) => {
      if (seen.has(i)) return false;
      seen.add(i);
      if (/^Avocado/i.test(i) && (client?.avocado_count_week ?? 0) >= 3) return false;
      return true;
    });
  };

  // Weekly-plan lock: if the client has confirmed a weekly plan, restrict recipe
  // builder picks to the foods they actually selected for that meal+component.
  const weekConfirmed = !!weeklyPlan?.confirmed_at;
  const lockedSelectionsForMeal = (m: MealType | null): Record<string, string> => {
    if (!m || !weeklyPlan) return {};
    return ((weeklyPlan as any)[`${m}_selections`] as Record<string, string>) ?? {};
  };
  const lockedMealIdFor = (m: MealType | null): number | null => {
    if (!m || !weeklyPlan) return null;
    return ((weeklyPlan as any)[`${m}_meal_id`] as number | null) ?? null;
  };
  const restrictedItems = (sources: (keyof typeof MB_FOODS)[], componentKey: string): string[] => {
    const base = filteredSources(sources);
    if (!weekConfirmed) return base;
    const lockedPrimary = lockedSelectionsForMeal(meal)[componentKey];
    const lockedAlt = meal && weeklyPlan
      ? ((weeklyPlan as any)[`${meal}_selections_alt`] as Record<string, string> | undefined)?.[componentKey]
      : undefined;
    const allowed = [lockedPrimary, lockedAlt].filter(Boolean) as string[];
    if (!allowed.length) return base;
    return base.filter((i) => allowed.includes(i));
  };
  const optionsForMeal = (m: MealType): OptionDef[] => {
    if (!weekConfirmed) return MB_OPTIONS[m];
    const lockedId = lockedMealIdFor(m);
    const altId = weeklyPlan ? ((weeklyPlan as any)[`${m}_meal_id_alt`] as number | null) : null;
    const ids = [lockedId, altId].filter((v): v is number => typeof v === "number");
    if (!ids.length) return MB_OPTIONS[m];
    return MB_OPTIONS[m].filter((o) => ids.includes(o.id));
  };

  // Auto-apply locked picks when the user enters the recipe builder after confirming the week
  useEffect(() => {
    if (!weekConfirmed || !meal || !option) return;
    const locked = lockedSelectionsForMeal(meal);
    if (!Object.keys(locked).length) return;
    setPicks((prev) => {
      const next = { ...prev };
      for (const c of option.components) {
        if (locked[c.key] && !next[c.key]) next[c.key] = locked[c.key];
      }
      return next;
    });
  }, [weekConfirmed, meal, option, weeklyPlan]);


  const generate = async () => {
    if (!option || !meal) return;
    for (const c of option.components) {
      if (!c.optional && !picks[c.key]) return toast.error(`Choose: ${c.label}`);
    }
    const veg1 = option.components.find((c) => c.key === "veg1");
    const veg2 = option.components.find((c) => c.key === "veg2");
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
    const ingredients = [
      ...(option.fixed ?? []).map((f) => ({ label: f.label, qty: f.qty })),
      ...option.components.filter((c) => picks[c.key]).map((c) => {
        let qty = c.qty || "see option";
        if (c.key === "veg1") qty = veg1Qty || qty;
        if (c.key === "veg2") qty = veg2Qty || "see option";
        return { label: `${c.label}: ${picks[c.key]}`, qty };
      }),
      ...(picks["starch_extra"] ? [{ label: `Starches: ${picks["starch_extra"]}`, qty: "as advised" }] : []),
      ...(picks["legumes_extra"] ? [{ label: `Legumes: ${picks["legumes_extra"]}`, qty: "as advised" }] : []),
    ];
    setGenerating(true);
    setRecipe(null);
    try {
      const { data, error } = await supabase.functions.invoke("generate-mb-recipe", {
        body: { token, meal_type: meal, option_label: option.label, ingredients, oil: oilAllowed(client!.phase) ? oil : "none" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setRecipe(data);
      await refresh();
    } catch (e: any) {
      toast.error(e.message ?? "Failed to generate");
    } finally {
      setGenerating(false);
    }
  };

  const isP2Strict = client?.phase === "phase2_strict";
  const isRatingsMode = !!client && client.phase !== "phase1";
  const daysSinceP2Start = (() => {
    if (!isP2Strict || !client?.phase2_strict_started_at) return 0;
    const start = new Date(client.phase2_strict_started_at).getTime();
    return Math.floor((Date.now() - start) / (1000 * 60 * 60 * 24));
  })();
  const strictTotalDays = 14 + Math.max(0, client?.phase2_strict_extra_days ?? 0);
  const isAlwaysWeeklyPhase = client?.phase === "phase2_extended" || client?.phase === "phase3" || client?.phase === "phase4";
  const isWeeklyMode = (isP2Strict && daysSinceP2Start >= strictTotalDays) || isAlwaysWeeklyPhase;
  const ratingsTitle = isP2Strict
    ? (isWeeklyMode ? "Weekly Progress — Phase 2" : "Daily Progress — Phase 2")
    : `Weekly Progress — ${phaseShort(client?.phase ?? "")}`;
  const ratingsSubtitle = isWeeklyMode
    ? (isP2Strict
        ? `You're past Day ${strictTotalDays} — please complete this once per week. Rate each area from 1 (best) to 5 (worst).`
        : "Please complete this once per week. Rate each area from 1 (best) to 5 (worst).")
    : "Rate each area from 1 (best) to 5 (worst).";
  const phaseProgress = getPhaseProgress(client?.phase, client?.phase2_strict_started_at, client?.phase2_strict_extra_days ?? 0);

  const submitCheckin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingCheckin(true);
    try {
      const body: Record<string, unknown> = { token, notes, water_litres: waterLitres };
      if (isRatingsMode) {
        if (weightInput) {
          const w = Number(weightInput);
          const kg = weightUnit === "lbs" ? Math.round(w * 0.45359237 * 100) / 100 : w;
          body.weight_kg = kg;
        }
        Object.assign(body, ratings);
        if (isWeeklyMode) {
          body.is_weekly = true;
          
          const waist = toCm(waistInput); if (waist !== undefined) body.waist_cm = waist;
          const hip = toCm(hipInput); if (hip !== undefined) body.hip_cm = hip;
          const thigh = toCm(thighInput); if (thigh !== undefined) body.upper_thigh_cm = thigh;
        }
      } else {
        body.feeling = feeling;
      }
      const { data, error } = await supabase.functions.invoke("submit-checkin", { body });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setClient((c) => (c ? { ...c, water_today_litres: waterLitres } : c));
      setCheckinDone(true);
    } catch (err: any) {
      toast.error(err.message ?? "Failed to submit");
    } finally {
      setSubmittingCheckin(false);
    }
  };

  if (loading) return <main className="min-h-screen flex items-center justify-center">Loading…</main>;
  if (!client) return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <Card className="p-6 text-center max-w-md"><p>Invalid link.</p></Card>
    </main>
  );

  const avocadoLeft = Math.max(0, 3 - client.avocado_count_week);
  const eggsLeft = Math.max(0, 5 - client.egg_count_week);
  const waterTarget = 2.5;

  // My Plan categories — uses practitioner-customised list when set, otherwise defaults.
  const planCategories = resolvePhase2Categories(client.phase2_food_list);

  return (
    <main className="min-h-screen bg-background pb-24">
      <header className="border-b">
        <div className="max-w-5xl mx-auto p-4">
          <h1 className="text-xl font-semibold">Hi {client.name}</h1>
          <p className="text-xs text-muted-foreground">Metabolic Balance · {phaseShort(client.phase)}</p>
        </div>
      </header>

      {tab === "home" && (
        <section className="max-w-5xl mx-auto p-4 space-y-6">
          {/* Trackers */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Card className="p-4">
              <p className="text-xs uppercase text-muted-foreground">Avocado</p>
              <p className="text-2xl font-semibold">{client.avocado_count_week}/3</p>
              <p className="text-xs text-muted-foreground">{avocadoLeft} remaining this week</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs uppercase text-muted-foreground">Eggs</p>
              <p className="text-2xl font-semibold">{client.egg_count_week}/5</p>
              <p className="text-xs text-muted-foreground">{eggsLeft} remaining this week</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs uppercase text-muted-foreground">Water Today</p>
              <p className="text-2xl font-semibold">{client.water_today_litres.toFixed(2)}L<span className="text-sm text-muted-foreground"> / {waterTarget}L</span></p>
              <Button size="sm" variant="outline" className="mt-2 w-full" onClick={addWater}>+ Glass (250ml)</Button>
            </Card>
            <Card className="p-4">
              <p className="text-xs uppercase text-muted-foreground">Meal Streak</p>
              <p className="text-2xl font-semibold">{client.meal_streak}</p>
              <p className="text-xs text-muted-foreground">consecutive meals logged</p>
            </Card>
          </div>

          {(client.phase === "phase2_extended" || client.phase === "phase3") && (
            <Card className={`p-4 border-primary/40 ${treatMeal ? "opacity-70 bg-muted/30" : "bg-primary/5"}`}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="space-y-1">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Treat Meal</p>
                  <p className="text-lg font-semibold">
                    {treatMeal
                      ? "1 / 1 this week — treat meal used"
                      : "0 / 1 this week"}
                  </p>
                  {treatMeal && (
                    <p className="text-sm text-muted-foreground">
                      Logged for {new Date(treatMeal.eaten_on + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                      {treatMeal.description ? ` — ${treatMeal.description}` : ""}
                    </p>
                  )}
                </div>
                {!treatMeal && !treatFormOpen && (
                  <Button size="sm" onClick={() => setTreatFormOpen(true)}>Log treat meal</Button>
                )}
              </div>

              {!treatMeal && treatFormOpen && (
                <div className="mt-4 space-y-3">
                  <div className="space-y-1">
                    <Label htmlFor="treat-desc" className="text-xs">What did you eat?</Label>
                    <Input
                      id="treat-desc"
                      value={treatDesc}
                      onChange={(e) => setTreatDesc(e.target.value)}
                      placeholder="e.g. pizza with friends"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="treat-date" className="text-xs">When?</Label>
                    <Input
                      id="treat-date"
                      type="date"
                      value={treatDate}
                      onChange={(e) => setTreatDate(e.target.value)}
                      max={new Date().toISOString().slice(0, 10)}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={logTreatMeal} disabled={submittingTreat}>
                      {submittingTreat ? "Saving…" : "Submit"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setTreatFormOpen(false)}>Cancel</Button>
                  </div>
                </div>
              )}
            </Card>
          )}


          {client.phase === "phase1" ? (
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Tap 'My Plan' to view your Phase 1 instructions.</p>
            </Card>
          ) : client.show_rules ? (
            <Collapsible open={rulesOpen} onOpenChange={setRulesOpen}>
              <Card className="p-4">
                <CollapsibleTrigger className="w-full text-left flex items-center justify-between">
                  <span className="font-medium">The 8 Metabolic Balance Rules</span>
                  <span className="text-sm text-muted-foreground">{rulesOpen ? "Hide" : "Show"}</span>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-3">
                  <ol className="list-decimal list-inside space-y-1 text-sm">
                    {MB_RULES.map((r, i) => <li key={i}>{r}</li>)}
                  </ol>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          ) : null}

          {!recipeBuilderEnabled(client.phase) ? (
            <Card className="p-6 text-center">
              <p className="text-sm text-muted-foreground">
                The recipe builder is not available during Phase 1. Focus on the meal structure in your My Plan tab.
              </p>
            </Card>
          ) : !weekConfirmed ? (
            <Card className="p-6 text-center space-y-4">
              <p className="text-sm text-muted-foreground">
                Before generating recipes, please head to Meal Planner to select your meals for the week and build your shopping list. Your recipe generator will then be loaded with your chosen foods for the week.
              </p>
              <Button onClick={() => changeTab("planner")}>Go to Meal Planner</Button>
            </Card>
          ) : (
            <>
              {weekConfirmed && (
                <Card className="p-3 border-primary/40 bg-primary/5">
                  <p className="text-xs text-primary">
                    Your weekly meal plan is set — recipe options are limited to the foods you selected for this week.
                  </p>
                </Card>
              )}
              <div className="grid grid-cols-3 gap-2">
                {(["breakfast","lunch","dinner"] as MealType[]).map((m) => (
                  <Button key={m} variant={meal === m ? "default" : "outline"} onClick={() => { setMeal(m); setOption(null); setRecipe(null); }}>
                    {m[0].toUpperCase() + m.slice(1)}
                  </Button>
                ))}
              </div>

              {meal && (
                <Card className="p-4 space-y-3">
                  <p className="text-sm font-medium">Choose a {meal} option</p>
                  <div className="grid gap-2 md:grid-cols-3">
                    {optionsForMeal(meal).map((o) => (
                      <Button key={o.id} variant={option?.id === o.id ? "default" : "outline"} className="h-auto py-3 text-left whitespace-normal" onClick={() => pickOption(meal, o)}>
                        <span className="text-xs">Option {o.id} — {o.label}</span>
                      </Button>
                    ))}
                  </div>
                </Card>
              )}

              {option && meal && (() => {
                const isP3Plus = client.phase === "phase3" || client.phase === "phase4";
                const isCustomMode = client.phase3_mode !== "mb_standard";
                const starchExtras = (isP3Plus && isCustomMode) ? parseList(client.phase3_starches) : [];
                const hasStarchAlready = option.components.some((c) => c.sources.includes("starch"));
                const legumesExtras = isP3Plus ? parseList(isCustomMode ? "" : client.phase3_mb_legumes) : [];
                const hasLegumesAlready = option.components.some((c) => c.sources.includes("legumes"));
                const extraComponents = [
                  ...((starchExtras.length > 0 && !hasStarchAlready)
                    ? [{ key: "starch_extra", label: "Starches (optional)", qty: "as advised", sources: ["starch"] as (keyof typeof MB_FOODS)[], optional: true }]
                    : []),
                  ...((legumesExtras.length > 0 && !hasLegumesAlready)
                    ? [{ key: "legumes_extra", label: "Legumes (optional)", qty: "as advised", sources: ["legumes"] as (keyof typeof MB_FOODS)[], optional: true }]
                    : []),
                ];
                const allComponents = [...option.components, ...extraComponents];
                return (
                <Card className="p-4 space-y-4">
                  <p className="font-medium">{option.label}</p>
                  {option.fixed?.map((f, i) => (
                    <p key={i} className="text-sm text-muted-foreground">Fixed: <span className="font-medium text-foreground">{f.label} — {f.qty}</span></p>
                  ))}
                  {allComponents.map((comp) => {
                    const items = restrictedItems(comp.sources, comp.key);
                    const showAvocadoNote = comp.sources.includes("vegetables") && (client.avocado_count_week >= 3);
                    const showOilBefore = oilAllowed(client.phase) && comp.key === "fruit";
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
                          <Select value={picks[comp.key] ?? ""} onValueChange={(v) => setPicks((p) => ({ ...p, [comp.key]: v }))}>
                            <SelectTrigger><SelectValue placeholder={comp.optional ? "Optional" : "Select…"} /></SelectTrigger>
                            <SelectContent>
                              {items.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          {showAvocadoNote && <p className="text-xs text-muted-foreground">Avocado limit reached this week.</p>}
                        </div>
                      </div>
                    );
                  })}

                  {oilAllowed(client.phase) && !option.components.some((c) => c.key === "fruit") && (
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

                  <Button onClick={generate} disabled={generating} className="w-full">
                    {generating ? "Generating recipe…" : "Generate Recipe"}
                  </Button>
                </Card>
                );
              })()}
            </>
          )}

          {recipe && (
            <Card className="p-4">
              <p className="font-medium mb-3">{recipe.recipe_title}</p>
              <Tabs defaultValue="recipe">
                <TabsList>
                  <TabsTrigger value="recipe">Recipe</TabsTrigger>
                  <TabsTrigger value="method">Method</TabsTrigger>
                  <TabsTrigger value="notes">Notes</TabsTrigger>
                </TabsList>
                <TabsContent value="recipe" className="pt-3">
                  <ul className="list-disc list-inside text-sm space-y-1">{recipe.recipe.map((r, i) => <li key={i}>{r}</li>)}</ul>
                </TabsContent>
                <TabsContent value="method" className="pt-3">
                  <div className="text-sm space-y-2">{recipe.method.map((s, i) => <p key={i}>{s}</p>)}</div>
                </TabsContent>
                <TabsContent value="notes" className="pt-3">
                  <ul className="list-disc list-inside text-sm space-y-1">{recipe.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
                </TabsContent>
              </Tabs>
            </Card>
          )}
        </section>
      )}

      {tab === "checkin" && (
        <section className="max-w-md mx-auto p-4">
          {checkinDone ? (
            <Card className="p-6 text-center space-y-3">
              <h2 className="text-lg font-semibold">Thanks!</h2>
              <p className="text-sm text-muted-foreground">Your nutritionist has been notified.</p>
              <Button variant="outline" onClick={() => { setCheckinDone(false); setFeeling(3); setNotes(""); setWeightInput(""); setRatings(initialRatings); setWaistInput(""); setHipInput(""); setThighInput(""); }}>
                Submit another
              </Button>
            </Card>
          ) : isRatingsMode ? (
            <Card className="p-6 space-y-6">
              <div>
                {phaseProgress.label && (
                  <div className="inline-block mb-2 px-2 py-0.5 rounded bg-primary/10 text-primary text-xs font-medium uppercase tracking-wide">
                    {phaseProgress.label}
                  </div>
                )}
                <h2 className="text-lg font-semibold">{ratingsTitle}</h2>
                <p className="text-sm text-muted-foreground">{ratingsSubtitle}</p>
              </div>
              <form onSubmit={submitCheckin} className="space-y-5">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="weight">Weight ({weightUnit})</Label>
                    <div className="flex gap-1">
                      <Button type="button" size="sm" variant={weightUnit === "kg" ? "default" : "outline"} onClick={() => updateWeightUnit("kg")}>kg</Button>
                      <Button type="button" size="sm" variant={weightUnit === "lbs" ? "default" : "outline"} onClick={() => updateWeightUnit("lbs")}>lbs</Button>
                    </div>
                  </div>
                  <Input id="weight" type="number" step="0.1" min={0} value={weightInput} onChange={(e) => setWeightInput(e.target.value)} placeholder={weightUnit === "kg" ? "e.g. 72.4" : "e.g. 159.6"} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="water">Water intake (litres)</Label>
                  <Input id="water" type="number" step="0.25" min={0} max={20} value={waterLitres} onChange={(e) => setWaterAmount(Number(e.target.value))} />
                  <p className="text-xs text-muted-foreground">Synced with your home screen water tracker.</p>
                </div>
                {([
                  ["general_wellbeing", "General Well-Being"],
                  ["fatigue", "Fatigue"],
                  ["sleep", "Sleep"],
                  ["headache", "Headache"],
                  ["pain", "Pain"],
                  ["joint_pain", "Joint Pain"],
                  ["acid_reflux", "Acid Reflux"],
                  ["digestion", "Digestion"],
                  ["allergy_skin", "Allergy / Skin"],
                ] as [string, string][]).map(([key, label]) => (
                  <div key={key} className="space-y-2">
                    <Label>{label} ({ratings[key]}/5)</Label>
                    <div className="grid grid-cols-5 gap-2">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Button
                          key={n}
                          type="button"
                          variant={ratings[key] === n ? "default" : "outline"}
                          size="sm"
                          onClick={() => setRating(key, n)}
                        >
                          {n}
                        </Button>
                      ))}
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>1 Best</span><span>5 Worst</span>
                    </div>
                  </div>
                ))}
                {isWeeklyMode && (
                  <div className="space-y-4 border-t pt-4">
                    <p className="text-sm font-medium">Body measurements</p>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="waist-main">Waist Circumference ({lengthUnit})</Label>
                        <div className="flex gap-1">
                          <Button type="button" size="sm" variant={lengthUnit === "cm" ? "default" : "outline"} onClick={() => updateLengthUnit("cm")}>cm</Button>
                          <Button type="button" size="sm" variant={lengthUnit === "in" ? "default" : "outline"} onClick={() => updateLengthUnit("in")}>inches</Button>
                        </div>
                      </div>
                      <Input id="waist-main" type="number" step="0.1" min={0} value={waistInput} onChange={(e) => setWaistInput(e.target.value)} placeholder={lengthUnit === "cm" ? "e.g. 82" : "e.g. 32.3"} />
                      <p className="text-xs text-muted-foreground">Measured at navel height.</p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="hip">Hip Circumference ({lengthUnit})</Label>
                      <Input id="hip" type="number" step="0.1" min={0} value={hipInput} onChange={(e) => setHipInput(e.target.value)} placeholder={lengthUnit === "cm" ? "e.g. 96" : "e.g. 37.8"} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="thigh">Upper Thigh Circumference ({lengthUnit})</Label>
                      <Input id="thigh" type="number" step="0.1" min={0} value={thighInput} onChange={(e) => setThighInput(e.target.value)} placeholder={lengthUnit === "cm" ? "e.g. 56" : "e.g. 22"} />
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="notes">Any notes for your nutritionist?</Label>
                  <Textarea id="notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
                <Button type="submit" className="w-full" disabled={submittingCheckin}>
                  {submittingCheckin ? "Submitting…" : "Submit check-in"}
                </Button>
              </form>
            </Card>
          ) : (
            <Card className="p-6 space-y-6">
              <div>
                <h2 className="text-lg font-semibold">Daily check-in</h2>
                <p className="text-sm text-muted-foreground">Let your nutritionist know how you're doing today.</p>
              </div>
              <form onSubmit={submitCheckin} className="space-y-5">
                <div className="space-y-2">
                  <Label>How are you feeling today? ({feeling}/5)</Label>
                  <input
                    type="range" min={1} max={5} value={feeling}
                    onChange={(e) => setFeeling(Number(e.target.value))}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>1 Bad</span><span>5 Great</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="water">How much water did you drink? (litres)</Label>
                  <Input id="water" type="number" step="0.25" min={0} max={20} value={waterLitres} onChange={(e) => setWaterAmount(Number(e.target.value))} />
                  <p className="text-xs text-muted-foreground">Synced with your home screen water tracker.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="notes">Any notes for your nutritionist?</Label>
                  <Textarea id="notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
                <Button type="submit" className="w-full" disabled={submittingCheckin}>
                  {submittingCheckin ? "Submitting…" : "Submit check-in"}
                </Button>
              </form>
            </Card>
          )}
        </section>
      )}

      {tab === "plan" && (
        <section className="max-w-3xl mx-auto p-4 space-y-4">
          <Card className="p-4">
            <p className="text-xs uppercase text-muted-foreground">Client</p>
            <p className="text-lg font-semibold">{client.name}</p>
            <p className="text-sm text-muted-foreground">Current phase: <span className="font-medium text-foreground">{phaseShort(client.phase)}</span></p>
          </Card>
          {client.phase === "phase1" ? (
            <div className="space-y-4">
              <Card className="p-6 space-y-2">
                <p className="font-medium">Phase 1 — Preparation Phase</p>
                <p className="text-sm text-muted-foreground">
                  During the two-day Preparation Phase, your body is gently prepared for the journey ahead. This phase focuses on cleansing the intestinal tract, which helps reduce hunger and cravings later in the program.
                </p>
              </Card>

              <Card className="p-6 space-y-2 border-destructive/40">
                <p className="font-medium">⚠️ Important Notice</p>
                <p className="text-sm text-muted-foreground">
                  On the first day of Phase 1, complete a thorough intestinal cleanse to support your body's reset process. Speak with your coach or physician about the most suitable method for you. Options may include magnesium citrate oral solution, Epsom salt, or gentler alternatives such as an enema or colonic hydrotherapy. Do not attempt this without guidance.
                </p>
              </Card>

              <Card className="p-6 space-y-3">
                <p className="font-medium">Daily structure</p>
                <div className="text-sm space-y-3 text-muted-foreground">
                  <p><span className="font-medium text-foreground">In the morning:</span> Enjoy half the portion of your usual breakfast. For example, a one-egg vegetable omelette (without cheese) instead of your typical two-egg omelette.</p>
                  <p><span className="font-medium text-foreground">At lunchtime:</span> Homemade vegetable soup with up to 500g (1.1 lb) of fresh or frozen vegetables, served puréed or chunky. Use sugar-free vegetable broth with no additives. No chicken or beef broth. One apple on the side.</p>

                  <Collapsible>
                    <CollapsibleTrigger className="w-full text-left flex items-center justify-between rounded-md border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted/50">
                      <span>How to make your soup</span>
                      <span className="text-xs text-muted-foreground">Show / hide</span>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-3 space-y-3 text-sm text-muted-foreground">
                      <p className="font-medium text-foreground">How to make your vegetable soup</p>
                      <p><span className="font-medium text-foreground">What you need:</span> A large pot, a chopping board, a sharp knife, a digital kitchen scale, a wooden spoon, and a blender or hand/immersion blender (optional, for puréed soup).</p>
                      <p><span className="font-medium text-foreground">Ingredients:</span> Up to 500g of fresh or frozen vegetables from any combination you like — for example carrots, zucchini, spinach, cauliflower, leek, or celery. Use your scale to weigh them raw before cooking. Sugar-free vegetable broth with no additives (check the label — ingredients should be only vegetables, water, and salt). No chicken or beef broth. One apple on the side.</p>
                      <p><span className="font-medium text-foreground">Step 1 — Prepare your vegetables.</span> Wash all vegetables thoroughly under cold running water. Peel any that need peeling (like carrots). Place your pot on the counter with your chopping board beside it. Cut vegetables into rough chunks about 3–4cm (1.5 inches) — they don't need to be perfect, they're going to cook down. Weigh as you go so you don't exceed 500g total.</p>
                      <p><span className="font-medium text-foreground">Step 2 — Heat your pot.</span> Place your pot on the stove over medium heat. Pour in enough vegetable broth to cover the vegetables — roughly 750ml to 1 litre. Turn the heat to medium-high. You'll know it's ready when you see small bubbles forming and steam rising from the surface. This takes about 3–4 minutes.</p>
                      <p><span className="font-medium text-foreground">Step 3 — Add the vegetables.</span> Carefully add your chopped vegetables to the hot broth. Stir gently with your wooden spoon. The broth should cover the vegetables — if not, add a little more broth or water.</p>
                      <p><span className="font-medium text-foreground">Step 4 — Cook the soup.</span> Bring to a boil (you'll see vigorous bubbling), then immediately turn the heat down to low-medium. You want a gentle simmer — small bubbles breaking the surface, not a rolling boil. Put the lid on slightly ajar. Cook for 20–25 minutes. Check at 20 minutes by pressing a carrot piece with your spoon — if it squashes easily, the vegetables are done. If it's still firm, cook for another 5 minutes.</p>
                      <p><span className="font-medium text-foreground">Step 5 — Choose your texture.</span></p>
                      <p><span className="font-medium text-foreground">Chunky:</span> Your soup is ready. Season with a pinch of sea salt and a herb from your plan (thyme, parsley, or dill work well). Serve in a bowl.</p>
                      <p><span className="font-medium text-foreground">Puréed:</span> Remove the pot from the heat. If using a hand/immersion blender, insert it into the pot and blend until smooth — keep it below the surface to avoid splashing. If using a regular blender, let the soup cool for 5 minutes first, then pour in batches and blend. Be careful — hot liquid expands in a blender. Season and serve.</p>
                      <p><span className="font-medium text-foreground">Step 6 — Serve.</span> Ladle into a bowl and eat while warm. Have your apple on the side as part of this meal — not as a separate snack later.</p>
                      <div>
                        <p className="font-medium text-foreground">Important reminders:</p>
                        <ul className="list-disc list-inside space-y-1 mt-1">
                          <li>No oil, no butter, no cream</li>
                          <li>No chicken or beef broth — vegetable broth only, check the label for additives</li>
                          <li>All measurements are raw weight before cooking</li>
                          <li>Frozen vegetables work just as well as fresh — use the same weight</li>
                        </ul>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>

                  <p><span className="font-medium text-foreground">In the evening:</span> Up to 500g (1.1 lb) raw weight of cooked, steamed, or raw vegetables or salad, seasoned with herbs only. No processed or store bought herb and spice blends — use only individual dry or fresh herbs and spices mixed together by you. Also remember no oil, vinegar, or other dressings.</p>
                </div>
              </Card>

              <Card className="p-6 space-y-3">
                <p className="font-medium">Alternative option — eat just one type of food for the entire day</p>
                <p className="text-sm text-muted-foreground">You may choose one of the following instead:</p>
                <ul className="text-sm space-y-1 list-disc list-inside text-muted-foreground">
                  <li><span className="text-foreground font-medium">Fruit Day</span> — up to 1kg (2.2 lbs) of fruit, divided into 3 meals</li>
                  <li><span className="text-foreground font-medium">Vegetable Day</span> — up to 1.5kg (3.3 lbs) of vegetables, divided into 3 meals</li>
                  <li><span className="text-foreground font-medium">Potato Day</span> — up to 1.5kg (3.3 lbs) of potatoes, divided into 3 meals</li>
                  <li><span className="text-foreground font-medium">Rice Day</span> — up to 200g (½ lb) whole-grain brown rice, divided into 3 meals</li>
                </ul>
                <p className="text-sm text-muted-foreground">
                  You can enjoy vegetables raw, steamed, cooked, or puréed. Cook rice and potatoes in plain water only. You may use spices but no butter or oil.
                </p>
              </Card>

              <p className="text-xs text-muted-foreground text-center">
                Your full personal food list will be available when you move to Phase 2.
              </p>
            </div>
          ) : client.phase === "phase4" ? (
            <Card className="p-6 space-y-2">
              <p className="font-medium">Phase 4 — Maintenance</p>
              <p className="text-sm text-muted-foreground">
                You are in the Maintenance Phase. The 8 Rules are now your lifestyle. Continue making mindful food choices and stay in touch with your practitioner.
              </p>
              <div className="pt-3">
                <p className="font-medium text-foreground text-sm mb-2">The 8 Metabolic Balance Rules</p>
                <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                  {MB_RULES.map((r, i) => <li key={i}>{r}</li>)}
                </ol>
              </div>
            </Card>
          ) : (
            <>
              <Card className="p-6 space-y-3">
                <p className="font-medium">The 8 Metabolic Balance Rules</p>
                <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                  {MB_RULES.map((r, i) => <li key={i}>{r}</li>)}
                </ol>
              </Card>

              <Card className="p-6">
                <p className="text-sm text-muted-foreground">
                  {client.phase === "phase2_strict" && "You are in the Strict Conversion Phase. Follow your personal food list exactly. No oil for the first 14 days. No substitutions."}
                  {client.phase === "phase2_extended" && "You are in the Extended Phase. Add 3 tablespoons of cold-pressed oil daily — ideally 1 tablespoon per meal. You may enjoy one treat meal per week. Continue following your personal food list."}
                  {client.phase === "phase3" && (client.phase3_mode === "mb_standard"
                    ? "You are in the Relaxed Conversion Phase. Your personal food list has been expanded as part of your Metabolic Balance plan. You may test new foods gradually using the test and assess method. Treat meals are allowed once per week."
                    : "You are in the Relaxed Conversion Phase. Your food list has been expanded by your practitioner. You may test new foods gradually using the test and assess method. Treat meals are allowed once per week.")}
                </p>
              </Card>

              <div className="grid gap-4 md:grid-cols-2">
                {planCategories.map((cat) => (
                  <Card key={cat.title} className="p-4">
                    <p className="font-medium mb-2">{cat.title}</p>
                    <ul className="text-sm space-y-1 list-disc list-inside text-muted-foreground">
                      {cat.items.map((it) => <li key={it}><span className="text-foreground">{it}</span></li>)}
                    </ul>
                  </Card>
                ))}
              </div>
              {client.phase === "phase3" && (() => {
                const isMb = client.phase3_mode === "mb_standard";
                const groups: { label: string; field: keyof ClientState }[] = isMb ? [
                  { label: "Fish", field: "phase3_mb_fish" },
                  { label: "Seafood", field: "phase3_mb_seafood" },
                  { label: "Cheese", field: "phase3_mb_cheese" },
                  { label: "Legumes", field: "phase3_mb_legumes" },
                  { label: "Vegetables", field: "phase3_mb_vegetables" },
                  { label: "Fat / Oil", field: "phase3_mb_fat_oil" },
                ] : [
                  { label: "Meat", field: "phase3_meat" },
                  { label: "Fish", field: "phase3_fish" },
                  { label: "Vegetables", field: "phase3_vegetables" },
                  { label: "Fruit", field: "phase3_fruit" },
                  { label: "Starches", field: "phase3_starches" },
                  { label: "Bread", field: "phase3_bread" },
                  { label: "Dairy", field: "phase3_dairy" },
                  { label: "Other", field: "phase3_other" },
                ];
                const title = isMb ? "Your Extended Personal Food List" : "Your Additional Foods";
                const populated = groups
                  .map((g) => ({ ...g, items: parseList(client[g.field] as string) }))
                  .filter((g) => g.items.length > 0);
                return (
                  <Card className="p-6 space-y-3">
                    <p className="font-medium">{title}</p>
                    {populated.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Your practitioner will add your {isMb ? "Extended Personal Food List" : "additional foods"} here once your Phase 3 consultation is complete.</p>
                    ) : (
                      <>
                        <p className="text-sm text-muted-foreground">{isMb ? "Your MB Standard Phase 3 foods, by category." : "The additional foods Cheryl has added for you, by category."}</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {populated.map((g) => (
                            <div key={g.field} className="space-y-1">
                              <p className="text-xs uppercase tracking-wide text-muted-foreground">{g.label}</p>
                              <p className="text-sm text-foreground">{g.items.join(", ")}</p>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </Card>
                );
              })()}
              <p className="text-xs text-muted-foreground text-center pt-2">
                Quantities and exact selections are managed by your nutritionist. Use the Home tab to build today's meal.
              </p>
            </>
          )}
        </section>
      )}

      {tab === "planner" && (
        <section className="max-w-5xl mx-auto p-4">
          {client.phase === "phase1" ? (
            <Card className="p-6 text-sm text-muted-foreground">
              The Meal Planner unlocks once you begin Phase 2.
            </Card>
          ) : (
            <MealPlanner
              token={token!}
              filteredSources={filteredSources}
              weeklyFoodLimits={client.weekly_food_limits ?? {}}
              onPlanChanged={(p) => setWeeklyPlan(p)}
            />
          )}
        </section>
      )}

      {/* Bottom navigation */}
      <nav className="fixed bottom-0 inset-x-0 border-t bg-background">
        <div className="max-w-5xl mx-auto grid grid-cols-4">
          {([
            { key: "home", label: "Home", Icon: Home },
            { key: "planner", label: "Meal Planner", Icon: CalendarDays },
            { key: "checkin", label: "Check-in", Icon: ClipboardCheck },
            { key: "plan", label: "My Plan", Icon: BookOpen },
          ] as { key: TabKey; label: string; Icon: typeof Home }[]).map(({ key, label, Icon }) => {
            const active = tab === key;
            return (
              <button
                key={key}
                onClick={() => changeTab(key)}
                className={`flex flex-col items-center justify-center py-3 text-xs gap-1 transition-colors ${active ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Icon className="h-5 w-5" />
                {label}
              </button>
            );
          })}
        </div>
      </nav>

    </main>
  );
}
