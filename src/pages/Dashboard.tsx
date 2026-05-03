import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { format } from "date-fns";

interface Client {
  id: string;
  name: string;
  email: string;
  magic_token: string;
  created_at: string;
}

interface CheckIn {
  id: string;
  client_id: string;
  feeling: number;
  water_glasses: number;
  notes: string | null;
  created_at: string;
}

interface Recipe {
  name: string;
  prep_time: string;
  servings: string;
  ingredients: string[];
  instructions: string[];
}

interface SavedRecipe extends Recipe {
  id: string;
  client_id: string;
  created_at: string;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [clients, setClients] = useState<Client[]>([]);
  const [checkIns, setCheckIns] = useState<Record<string, CheckIn[]>>({});
  const [savedRecipes, setSavedRecipes] = useState<Record<string, SavedRecipe[]>>({});
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [userEmail, setUserEmail] = useState("");

  // Recipe generator state
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [foodList, setFoodList] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generatedRecipes, setGeneratedRecipes] = useState<Recipe[]>([]);
  const [savingIdx, setSavingIdx] = useState<number | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        navigate("/auth", { replace: true });
        return;
      }
      setUserEmail(data.session.user.email ?? "");
      load();
    });
  }, [navigate]);

  const load = async () => {
    const { data: clientRows } = await supabase
      .from("clients")
      .select("*")
      .order("created_at", { ascending: false });
    setClients(clientRows ?? []);
    if (clientRows && clientRows.length) {
      const ids = clientRows.map((c) => c.id);
      const [{ data: checkRows }, { data: recipeRows }] = await Promise.all([
        supabase.from("check_ins").select("*").in("client_id", ids).order("created_at", { ascending: false }),
        supabase.from("recipes").select("*").in("client_id", ids).order("created_at", { ascending: false }),
      ]);
      const groupedC: Record<string, CheckIn[]> = {};
      (checkRows ?? []).forEach((ci) => { (groupedC[ci.client_id] ||= []).push(ci); });
      setCheckIns(groupedC);
      const groupedR: Record<string, SavedRecipe[]> = {};
      (recipeRows ?? []).forEach((r: any) => {
        (groupedR[r.client_id] ||= []).push({
          ...r,
          ingredients: Array.isArray(r.ingredients) ? r.ingredients : [],
          instructions: Array.isArray(r.instructions) ? r.instructions : [],
        });
      });
      setSavedRecipes(groupedR);
    }
  };

  const addClient = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("invite-client", {
        body: { name, email },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Client invited — magic link emailed");
      setName("");
      setEmail("");
      setOpen(false);
      await load();
    } catch (err: any) {
      toast.error(err.message ?? "Failed to invite client");
    } finally {
      setSubmitting(false);
    }
  };

  const generateRecipes = async () => {
    if (!selectedClientId) return toast.error("Select a client first");
    if (foodList.trim().length < 3) return toast.error("Enter the allowed food list");
    setGenerating(true);
    setGeneratedRecipes([]);
    try {
      const { data, error } = await supabase.functions.invoke("generate-recipes", {
        body: { foodList },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setGeneratedRecipes(data.recipes ?? []);
    } catch (err: any) {
      toast.error(err.message ?? "Failed to generate recipes");
    } finally {
      setGenerating(false);
    }
  };

  const saveRecipe = async (recipe: Recipe, idx: number) => {
    if (!selectedClientId) return;
    setSavingIdx(idx);
    try {
      const { error } = await supabase.from("recipes").insert({
        client_id: selectedClientId,
        name: recipe.name,
        prep_time: recipe.prep_time,
        servings: recipe.servings,
        ingredients: recipe.ingredients,
        instructions: recipe.instructions,
      });
      if (error) throw error;
      toast.success("Recipe saved to client profile");
      await load();
    } catch (err: any) {
      toast.error(err.message ?? "Failed to save recipe");
    } finally {
      setSavingIdx(null);
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    navigate("/auth", { replace: true });
  };

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b">
        <div className="max-w-5xl mx-auto p-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Tenacia</h1>
            <p className="text-xs text-muted-foreground">{userEmail}</p>
          </div>
          <Button variant="outline" size="sm" onClick={logout}>Log out</Button>
        </div>
      </header>

      <section className="max-w-5xl mx-auto p-4 space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Clients</h2>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>Add client</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add a new client</DialogTitle>
              </DialogHeader>
              <form onSubmit={addClient} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="cname">Name</Label>
                  <Input id="cname" required value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cemail">Email</Label>
                  <Input id="cemail" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? "Sending invite…" : "Add & send invite"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {clients.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">No clients yet. Add your first one.</Card>
        ) : (
          <div className="space-y-4">
            {clients.map((client) => {
              const list = checkIns[client.id] ?? [];
              const recipes = savedRecipes[client.id] ?? [];
              const link = `${window.location.origin}/checkin/${client.magic_token}`;
              return (
                <Card key={client.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium">{client.name}</p>
                      <p className="text-sm text-muted-foreground">{client.email}</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(link);
                        toast.success("Magic link copied");
                      }}
                    >
                      Copy link
                    </Button>
                  </div>
                  <Tabs defaultValue="checkins" className="border-t pt-3">
                    <TabsList>
                      <TabsTrigger value="checkins">Check-ins ({list.length})</TabsTrigger>
                      <TabsTrigger value="recipes">Saved Recipes ({recipes.length})</TabsTrigger>
                    </TabsList>
                    <TabsContent value="checkins" className="pt-3">
                      {list.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No submissions yet.</p>
                      ) : (
                        <ul className="space-y-2">
                          {list.map((ci) => (
                            <li key={ci.id} className="text-sm border rounded p-3 space-y-1">
                              <div className="flex justify-between text-xs text-muted-foreground">
                                <span>{format(new Date(ci.created_at), "PPp")}</span>
                              </div>
                              <div>Feeling: <span className="font-medium">{ci.feeling}/5</span></div>
                              <div>Water: <span className="font-medium">{ci.water_glasses} glasses</span></div>
                              {ci.notes && <div className="pt-1 text-muted-foreground">"{ci.notes}"</div>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </TabsContent>
                    <TabsContent value="recipes" className="pt-3">
                      {recipes.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No saved recipes yet.</p>
                      ) : (
                        <ul className="space-y-2">
                          {recipes.map((r) => (
                            <li key={r.id} className="text-sm border rounded p-3 space-y-2">
                              <div className="flex justify-between items-start gap-2">
                                <p className="font-medium">{r.name}</p>
                                <span className="text-xs text-muted-foreground whitespace-nowrap">
                                  {format(new Date(r.created_at), "PP")}
                                </span>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {r.prep_time} · {r.servings}
                              </p>
                              <div>
                                <p className="text-xs font-medium mb-1">Ingredients</p>
                                <ul className="list-disc list-inside text-xs space-y-0.5">
                                  {r.ingredients.map((ing, i) => <li key={i}>{ing}</li>)}
                                </ul>
                              </div>
                              <div>
                                <p className="text-xs font-medium mb-1">Instructions</p>
                                <ol className="list-decimal list-inside text-xs space-y-0.5">
                                  {r.instructions.map((s, i) => <li key={i}>{s}</li>)}
                                </ol>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </TabsContent>
                  </Tabs>
                </Card>
              );
            })}
          </div>
        )}

        {/* Recipe Generator */}
        <div className="pt-4 space-y-4">
          <h2 className="text-lg font-medium">Recipe Generator</h2>
          <Card className="p-4 space-y-4">
            <div className="space-y-2">
              <Label>Client</Label>
              <Select value={selectedClientId} onValueChange={setSelectedClientId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a client" />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedClientId && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="foodlist">Allowed food list</Label>
                  <Textarea
                    id="foodlist"
                    rows={4}
                    placeholder="e.g. chicken, salmon, broccoli, carrots, olive oil, eggs, almonds"
                    value={foodList}
                    onChange={(e) => setFoodList(e.target.value)}
                  />
                </div>
                <Button onClick={generateRecipes} disabled={generating}>
                  {generating ? "Generating…" : "Generate Recipes"}
                </Button>
              </>
            )}
          </Card>

          {generatedRecipes.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {generatedRecipes.map((r, idx) => (
                <Card key={idx} className="p-4 space-y-3 flex flex-col">
                  <div>
                    <p className="font-medium">{r.name}</p>
                    <p className="text-xs text-muted-foreground">{r.prep_time} · {r.servings}</p>
                  </div>
                  <div className="text-sm">
                    <p className="font-medium mb-1">Ingredients</p>
                    <ul className="list-disc list-inside text-xs space-y-0.5">
                      {r.ingredients.map((ing, i) => <li key={i}>{ing}</li>)}
                    </ul>
                  </div>
                  <div className="text-sm">
                    <p className="font-medium mb-1">Instructions</p>
                    <ol className="list-decimal list-inside text-xs space-y-0.5">
                      {r.instructions.map((s, i) => <li key={i}>{s}</li>)}
                    </ol>
                  </div>
                  <div className="mt-auto pt-2">
                    <Button
                      size="sm"
                      className="w-full"
                      onClick={() => saveRecipe(r, idx)}
                      disabled={savingIdx === idx}
                    >
                      {savingIdx === idx ? "Saving…" : "Save to Client Profile"}
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
