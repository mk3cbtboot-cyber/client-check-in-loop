import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";
import { MB_FOODS, MB_OPTIONS, MB_RULES, type MealType, type OptionDef } from "@/lib/mb-foods";

interface ClientState {
  id: string;
  name: string;
  phase: number;
  avocado_count_week: number;
  egg_count_week: number;
  water_today_litres: number;
  meal_streak: number;
}

export default function ClientPortal() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [client, setClient] = useState<ClientState | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [meal, setMeal] = useState<MealType | null>(null);
  const [option, setOption] = useState<OptionDef | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [phaseVariant, setPhaseVariant] = useState<"strict" | "extended">("strict");
  const [generating, setGenerating] = useState(false);
  const [recipe, setRecipe] = useState<{ recipe_title: string; recipe: string[]; method: string[]; notes: string[] } | null>(null);

  const refresh = async () => {
    if (!token) return;
    const { data } = await supabase.functions.invoke("client-portal-data", { body: { token } });
    if (data?.valid) setClient(data.client);
  };

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [token]);

  const addWater = async () => {
    const { data, error } = await supabase.functions.invoke("client-portal-water", { body: { token } });
    if (error || data?.error) return toast.error("Could not log water");
    setClient((c) => (c ? { ...c, water_today_litres: data.water_today_litres } : c));
  };

  const pickOption = (m: MealType, o: OptionDef) => {
    setOption(o);
    setMeal(m);
    setPicks({});
    setRecipe(null);
  };

  const filteredSources = (sources: (keyof typeof MB_FOODS)[]) => {
    const items = sources.flatMap((s) => MB_FOODS[s]);
    // de-dupe + remove avocado if at limit
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
    // Validate required fields
    for (const c of option.components) {
      if (!c.optional && !picks[c.key]) return toast.error(`Choose: ${c.label}`);
    }
    const ingredients = [
      ...(option.fixed ?? []).map((f) => ({ label: f.label, qty: f.qty })),
      ...option.components.filter((c) => picks[c.key]).map((c) => ({
        label: `${c.label}: ${picks[c.key]}`,
        qty: c.qty || "see option",
      })),
    ];
    setGenerating(true);
    setRecipe(null);
    try {
      const { data, error } = await supabase.functions.invoke("generate-mb-recipe", {
        body: { token, meal_type: meal, option_label: option.label, ingredients, phase_variant: phaseVariant },
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

  if (loading) return <main className="min-h-screen flex items-center justify-center">Loading…</main>;
  if (!client) return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <Card className="p-6 text-center max-w-md"><p>Invalid link.</p></Card>
    </main>
  );

  const avocadoLeft = Math.max(0, 3 - client.avocado_count_week);
  const eggsLeft = Math.max(0, 5 - client.egg_count_week);
  const waterTarget = 2.5;

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b">
        <div className="max-w-5xl mx-auto p-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Hi {client.name}</h1>
            <p className="text-xs text-muted-foreground">Metabolic Balance · Phase {client.phase}</p>
          </div>
        </div>
      </header>

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

        {/* Rules */}
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

        {/* Meal buttons */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {(["breakfast","lunch","dinner"] as MealType[]).map((m) => (
            <Button key={m} variant={meal === m ? "default" : "outline"} onClick={() => { setMeal(m); setOption(null); setRecipe(null); }}>
              {m[0].toUpperCase() + m.slice(1)}
            </Button>
          ))}
          <Button variant="outline" disabled>Progress Sheets</Button>
        </div>

        {/* Option picker */}
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

        {/* Ingredient selection */}
        {option && meal && (
          <Card className="p-4 space-y-4">
            <p className="font-medium">{option.label}</p>
            {option.fixed?.map((f, i) => (
              <p key={i} className="text-sm text-muted-foreground">Fixed: <span className="font-medium text-foreground">{f.label} — {f.qty}</span></p>
            ))}
            {option.components.map((comp) => {
              const items = filteredSources(comp.sources);
              const showAvocadoNote = comp.sources.includes("vegetables") && (client.avocado_count_week >= 3);
              return (
                <div key={comp.key} className="space-y-1">
                  <Label>{comp.label}{comp.qty && <span className="text-muted-foreground font-normal"> · {comp.qty}</span>}</Label>
                  <Select value={picks[comp.key] ?? ""} onValueChange={(v) => setPicks((p) => ({ ...p, [comp.key]: v }))}>
                    <SelectTrigger><SelectValue placeholder={comp.optional ? "Optional" : "Select…"} /></SelectTrigger>
                    <SelectContent>
                      {items.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {showAvocadoNote && <p className="text-xs text-muted-foreground">Avocado limit reached this week.</p>}
                </div>
              );
            })}

            {client.phase === 2 && (
              <div className="space-y-1">
                <Label>Phase 2 sub-phase</Label>
                <Select value={phaseVariant} onValueChange={(v: any) => setPhaseVariant(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="strict">Strict (first 14 days, no oil)</SelectItem>
                    <SelectItem value="extended">Extended (small amount of cold-pressed oil)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <Button onClick={generate} disabled={generating} className="w-full">
              {generating ? "Generating recipe…" : "Generate Recipe"}
            </Button>
          </Card>
        )}

        {/* Output */}
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
                <ol className="list-decimal list-inside text-sm space-y-1">{recipe.method.map((s, i) => <li key={i}>{s}</li>)}</ol>
              </TabsContent>
              <TabsContent value="notes" className="pt-3">
                <ul className="list-disc list-inside text-sm space-y-1">{recipe.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
              </TabsContent>
            </Tabs>
          </Card>
        )}
      </section>
    </main>
  );
}
