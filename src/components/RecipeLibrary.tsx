import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Pencil, Trash2, Plus, Sparkles, X } from "lucide-react";
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

const slotLabel = (s: Slot) => SLOT_OPTIONS.find((o) => o.value === s)?.label ?? s;

type Ingredient = { food: string; amount: string };

type Recipe = {
  id: string;
  practitioner_id: string;
  name: string;
  ingredients: Ingredient[];
  method: string;
  notes: string | null;
  default_slot: Slot;
  created_at: string;
};

type FormState = {
  id?: string;
  name: string;
  default_slot: Slot;
  ingredients: Ingredient[];
  method: string;
  notes: string;
};

const emptyForm = (): FormState => ({
  name: "",
  default_slot: "any",
  ingredients: [{ food: "", amount: "" }],
  method: "",
  notes: "",
});

export default function RecipeLibrary({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);

  const [aiOpen, setAiOpen] = useState(false);
  const [aiBrief, setAiBrief] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  const [deleteId, setDeleteId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("practitioner_recipes" as never)
      .select("*")
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) return toast.error(error.message);
    setRecipes(((data as unknown) as Recipe[]) ?? []);
  };

  useEffect(() => {
    if (open) void load();
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return recipes;
    return recipes.filter((r) => r.name.toLowerCase().includes(q));
  }, [recipes, search]);

  const openAdd = () => {
    setForm(emptyForm());
    setFormOpen(true);
  };

  const openEdit = (r: Recipe) => {
    setForm({
      id: r.id,
      name: r.name,
      default_slot: r.default_slot,
      ingredients: r.ingredients?.length ? r.ingredients : [{ food: "", amount: "" }],
      method: r.method ?? "",
    });
    setFormOpen(true);
  };

  const updateIngredient = (i: number, patch: Partial<Ingredient>) => {
    setForm((f) => ({
      ...f,
      ingredients: f.ingredients.map((ing, idx) => (idx === i ? { ...ing, ...patch } : ing)),
    }));
  };

  const addIngredientRow = () =>
    setForm((f) => ({ ...f, ingredients: [...f.ingredients, { food: "", amount: "" }] }));

  const removeIngredientRow = (i: number) =>
    setForm((f) => ({ ...f, ingredients: f.ingredients.filter((_, idx) => idx !== i) }));

  const saveRecipe = async () => {
    if (!form.name.trim()) return toast.error("Recipe name is required");
    setSaving(true);
    const cleanIngredients = form.ingredients
      .map((i) => ({ food: i.food.trim(), amount: i.amount.trim() }))
      .filter((i) => i.food);

    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) {
      setSaving(false);
      return toast.error("Not signed in");
    }

    const payload = {
      name: form.name.trim(),
      default_slot: form.default_slot,
      ingredients: cleanIngredients,
      method: form.method,
      practitioner_id: uid,
    };

    let error;
    if (form.id) {
      ({ error } = await supabase
        .from("practitioner_recipes" as never)
        .update(payload as never)
        .eq("id", form.id));
    } else {
      ({ error } = await supabase.from("practitioner_recipes" as never).insert(payload as never));
    }
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(form.id ? "Recipe updated" : "Recipe saved");
    setFormOpen(false);
    void load();
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from("practitioner_recipes" as never).delete().eq("id", deleteId);
    setDeleteId(null);
    if (error) return toast.error(error.message);
    toast.success("Recipe deleted");
    void load();
  };

  const generateAi = async () => {
    if (!aiBrief.trim()) return toast.error("Describe the recipe");
    setAiLoading(true);
    const { data, error } = await supabase.functions.invoke("generate-recipe", {
      body: { brief: aiBrief.trim() },
    });
    setAiLoading(false);
    if (error) return toast.error(error.message);
    const r = (data as { recipe?: FormState })?.recipe;
    if (!r) return toast.error("No recipe returned");
    setForm({
      name: r.name ?? "",
      default_slot: (r.default_slot as Slot) ?? "any",
      ingredients: r.ingredients?.length ? r.ingredients : [{ food: "", amount: "" }],
      method: r.method ?? "",
    });
    setAiOpen(false);
    setAiBrief("");
    setFormOpen(true);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Recipe Library</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <Input
              placeholder="Search recipes…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="sm:max-w-xs"
            />
            <div className="flex gap-2 sm:ml-auto">
              <Button variant="outline" onClick={() => setAiOpen(true)}>
                <Sparkles className="h-4 w-4" /> Generate with AI
              </Button>
              <Button onClick={openAdd}>
                <Plus className="h-4 w-4" /> Add recipe
              </Button>
            </div>
          </div>

          <div className="space-y-2 pt-2">
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {recipes.length === 0 ? "No recipes yet. Add your first one." : "No recipes match your search."}
              </p>
            ) : (
              filtered.map((r) => (
                <Card key={r.id} className="p-3 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{r.name}</p>
                    <p className="text-xs text-muted-foreground">{slotLabel(r.default_slot)}</p>
                  </div>
                  <Button size="icon" variant="ghost" aria-label="Edit" onClick={() => openEdit(r)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" aria-label="Delete" onClick={() => setDeleteId(r.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </Card>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Add/Edit form */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit recipe" : "Add recipe"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Recipe name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>

            <div className="space-y-1">
              <Label>Default slot</Label>
              <Select
                value={form.default_slot}
                onValueChange={(v) => setForm({ ...form, default_slot: v as Slot })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SLOT_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Ingredients</Label>
              {form.ingredients.map((ing, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    placeholder="Food (e.g. Chicken breast)"
                    value={ing.food}
                    onChange={(e) => updateIngredient(i, { food: e.target.value })}
                  />
                  <Input
                    placeholder="Amount (e.g. 170g)"
                    value={ing.amount}
                    onChange={(e) => updateIngredient(i, { amount: e.target.value })}
                    className="max-w-[140px]"
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label="Remove"
                    onClick={() => removeIngredientRow(i)}
                    disabled={form.ingredients.length === 1}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addIngredientRow}>
                <Plus className="h-4 w-4" /> Add ingredient
              </Button>
            </div>

            <div className="space-y-1">
              <Label>Method</Label>
              <Textarea
                rows={6}
                value={form.method}
                onChange={(e) => setForm({ ...form, method: e.target.value })}
                placeholder="Preparation steps…"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button onClick={saveRecipe} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI brief */}
      <Dialog open={aiOpen} onOpenChange={setAiOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate with AI</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Describe the recipe you want</Label>
            <Textarea
              rows={4}
              value={aiBrief}
              onChange={(e) => setAiBrief(e.target.value)}
              placeholder="e.g. high-protein lunch, salmon and vegetables, no dairy"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAiOpen(false)}>Cancel</Button>
            <Button onClick={generateAi} disabled={aiLoading}>
              {aiLoading ? "Generating…" : "Generate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={(v) => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this recipe?</AlertDialogTitle>
            <AlertDialogDescription>
              It will be removed from your library and any clients it is assigned to.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
