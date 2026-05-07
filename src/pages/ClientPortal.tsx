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
import { Home, ClipboardCheck, BookOpen } from "lucide-react";
import { MB_FOODS, MB_OPTIONS, MB_RULES, type MealType, type OptionDef } from "@/lib/mb-foods";
import { phaseShort, oilAllowed, recipeBuilderEnabled, type Phase } from "@/lib/phases";

interface ClientState {
  id: string;
  name: string;
  phase: Phase;
  avocado_count_week: number;
  egg_count_week: number;
  water_today_litres: number;
  meal_streak: number;
  phase3_additional_foods: string;
  show_rules: boolean;
  weight_unit: "kg" | "lbs";
}

type TabKey = "home" | "checkin" | "plan";

export default function ClientPortal() {
  const { token } = useParams<{ token: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = (searchParams.get("tab") as TabKey) || "home";
  const [tab, setTab] = useState<TabKey>(["home", "checkin", "plan"].includes(initialTab) ? initialTab : "home");

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
  const initialRatings = {
    general_wellbeing: 3, fatigue: 3, sleep: 3, headache: 3, pain: 3,
    joint_pain: 3, acid_reflux: 3, digestion: 3, allergy_skin: 3,
  };
  const [ratings, setRatings] = useState<Record<string, number>>(initialRatings);
  const setRating = (k: string, v: number) => setRatings((r) => ({ ...r, [k]: v }));

  const refresh = async () => {
    if (!token) return;
    const { data } = await supabase.functions.invoke("client-portal-data", { body: { token } });
    if (data?.valid) {
      setClient(data.client);
      setWaterLitres(Number(data.client.water_today_litres) || 0);
      setWeightUnit(data.client.weight_unit || "kg");
    }
  };

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [token]);

  const changeTab = (t: TabKey) => {
    setTab(t);
    const next = new URLSearchParams(searchParams);
    if (t === "home") next.delete("tab");
    else next.set("tab", t);
    setSearchParams(next, { replace: true });
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

  const filteredSources = (sources: (keyof typeof MB_FOODS)[]) => {
    const items = sources.flatMap((s) => MB_FOODS[s]);
    const seen = new Set<string>();
    return items.filter((i) => {
      if (seen.has(i)) return false;
      seen.add(i);
      if (/^Avocado/i.test(i) && (client?.avocado_count_week ?? 0) >= 3) return false;
      return true;
    });
  };

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

  const submitCheckin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingCheckin(true);
    try {
      const isP2Strict = client?.phase === "phase2_strict";
      const body: Record<string, unknown> = { token, notes, water_litres: waterLitres };
      if (isP2Strict) {
        if (weightInput) {
          const w = Number(weightInput);
          const kg = weightUnit === "lbs" ? Math.round(w * 0.45359237 * 100) / 100 : w;
          body.weight_kg = kg;
        }
        Object.assign(body, ratings);
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

  // My Plan categories
  const planCategories: { title: string; items: string[] }[] = [
    { title: "Proteins — Fish & Seafood", items: [...MB_FOODS.fish, ...MB_FOODS.seafood] },
    { title: "Proteins — Poultry & Meat", items: [...MB_FOODS.poultry, ...MB_FOODS.meat] },
    { title: "Proteins — Cheese, Yogurt & Milk", items: [...MB_FOODS.cheese, ...MB_FOODS.yogurt, ...MB_FOODS.milkProducts] },
    { title: "Proteins — Legumes", items: MB_FOODS.legumes },
    { title: "Vegetables", items: [...MB_FOODS.vegetables, ...MB_FOODS.vegLettuce] },
    { title: "Fruit", items: MB_FOODS.fruit },
    { title: "Bread", items: MB_FOODS.bread },
    { title: "Starch", items: MB_FOODS.starch },
  ];

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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
          ) : (
            <>
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
                    {MB_OPTIONS[meal].map((o) => (
                      <Button key={o.id} variant={option?.id === o.id ? "default" : "outline"} className="h-auto py-3 text-left whitespace-normal" onClick={() => pickOption(meal, o)}>
                        <span className="text-xs">Option {o.id} — {o.label}</span>
                      </Button>
                    ))}
                  </div>
                </Card>
              )}

              {option && meal && (
                <Card className="p-4 space-y-4">
                  <p className="font-medium">{option.label}</p>
                  {option.fixed?.map((f, i) => (
                    <p key={i} className="text-sm text-muted-foreground">Fixed: <span className="font-medium text-foreground">{f.label} — {f.qty}</span></p>
                  ))}
                  {option.components.map((comp) => {
                    const items = filteredSources(comp.sources);
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
              )}
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
              <Button variant="outline" onClick={() => { setCheckinDone(false); setFeeling(3); setNotes(""); setWeightInput(""); setRatings(initialRatings); }}>
                Submit another
              </Button>
            </Card>
          ) : client.phase === "phase2_strict" ? (
            <Card className="p-6 space-y-6">
              <div>
                <h2 className="text-lg font-semibold">Daily Progress — Phase 2 Strict</h2>
                <p className="text-sm text-muted-foreground">Rate each area from 1 (best) to 5 (worst).</p>
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
                  {client.phase === "phase3" && "You are in the Relaxed Conversion Phase. Your food list has been expanded by your practitioner. You may test new foods gradually using the test and assess method. Treat meals are allowed once per week."}
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
              {client.phase === "phase3" && (
                <Card className="p-6 space-y-2">
                  <p className="font-medium">Your Additional Foods</p>
                  {client.phase3_additional_foods?.trim() ? (
                    <>
                      <p className="text-sm text-muted-foreground">The 10 additional foods you selected have been added by Cheryl.</p>
                      <p className="text-sm text-foreground whitespace-pre-wrap">{client.phase3_additional_foods}</p>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">Your practitioner will add your personalised foods here once your Phase 3 consultation is complete.</p>
                  )}
                </Card>
              )}
              <p className="text-xs text-muted-foreground text-center pt-2">
                Quantities and exact selections are managed by your nutritionist. Use the Home tab to build today's meal.
              </p>
            </>
          )}
        </section>
      )}

      {/* Bottom navigation */}
      <nav className="fixed bottom-0 inset-x-0 border-t bg-background">
        <div className="max-w-5xl mx-auto grid grid-cols-3">
          {([
            { key: "home", label: "Home", Icon: Home },
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
