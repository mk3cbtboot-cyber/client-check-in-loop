import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Copy, Loader2, Plus, Trash2 } from "lucide-react";
import { MB_FOODS, type MealType } from "@/lib/mb-foods";
import {
  MB_COLOURS,
  parseMbFoodLimits,
  parseMbPlan,
  type MbColour,
  type MbFoodLimit,
  type MbLimitType,
  type MbPlan,
  type MbPlanItem,
  type MbSuggestion,
  type MbUnit,
} from "@/lib/mb-plan";

const MEALS: MealType[] = ["breakfast", "lunch", "dinner"];
const MEAL_LABEL: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
};
const COLOUR_LABEL: Record<MbColour, string> = {
  blue: "Suggestion 1",
  green: "Suggestion 2",
  orange: "Suggestion 3",
};
const COLOUR_NAME: Record<MbColour, string> = { blue: "Blue", green: "Green", orange: "Orange" };
const COLOUR_DOT: Record<MbColour, string> = {
  blue: "bg-sky-500",
  green: "bg-emerald-500",
  orange: "bg-amber-500",
};

const CATEGORIES = [...Object.keys(MB_FOODS), "other"];
const CATEGORY_LABEL = (c: string) =>
  c === "other" ? "Other" : c.replace(/([A-Z])/g, " $1").replace(/^./, (m) => m.toUpperCase());

const UNITS: { value: MbUnit; label: string }[] = [
  { value: "g", label: "g" },
  { value: "ml", label: "ml" },
  { value: "count", label: "count" },
  { value: "as_listed", label: "as listed" },
];

const uid = () => Math.random().toString(36).slice(2, 10);

const blankItem = (): MbPlanItem => ({
  id: uid(),
  category: "other",
  label: "",
  qty: null,
  unit: "g",
  note: "",
});

const blankPlan = (): MbPlan => ({
  version: 1,
  confirmed_at: null,
  suggestions: MB_COLOURS.map((colour) => ({
    colour,
    label: COLOUR_LABEL[colour],
    meals: {
      breakfast: { items: [], note: "" },
      lunch: { items: [], note: "" },
      dinner: { items: [], note: "" },
    },
  })) as MbSuggestion[],
});

interface Props {
  clientId: string;
  mbPlan: unknown;
  /** Enriched caps draft (clients.mb_food_limits). */
  mbFoodLimits?: unknown;
  /** Legacy flat caps (clients.food_limits) — shown read-only for reference. */
  legacyFoodLimits?: Record<string, number> | null;
  onSaved?: () => void;
}

export function MbPlanSetup({ clientId, mbPlan, mbFoodLimits, legacyFoodLimits, onSaved }: Props) {
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<MbPlan>(() => parseMbPlan(mbPlan) ?? blankPlan());
  const [limits, setLimits] = useState<MbFoodLimit[]>(() => parseMbFoodLimits(mbFoodLimits));
  const [saving, setSaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);

  // Load the stored draft whenever the dialog opens (never mid-edit).
  useEffect(() => {
    if (open) {
      dirty.current = false;
      setPlan(parseMbPlan(mbPlan) ?? blankPlan());
      setLimits(parseMbFoodLimits(mbFoodLimits));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, clientId]);

  const save = useCallback(
    async (next: MbPlan, nextLimits: MbFoodLimit[]) => {
      setSaving(true);
      const payload = { ...next, version: 1, confirmed_at: null };
      const { error } = await supabase
        .from("clients")
        // draft only — confirmed_at stays null until slice 4.
        // mb_food_limits is stored only; clients.food_limits is never touched here.
        .update({ mb_plan: payload as never, mb_food_limits: nextLimits as never })
        .eq("id", clientId);
      setSaving(false);
      if (error) toast.error(`Draft not saved: ${error.message}`);
      else onSaved?.();
    },
    [clientId, onSaved],
  );

  // Debounced autosave.
  useEffect(() => {
    if (!open || !dirty.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(plan, limits), 700);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [plan, limits, open, save]);

  const mutate = (fn: (draft: MbPlan) => MbPlan) => {
    dirty.current = true;
    setPlan((p) => fn(structuredClone(p)));
  };

  const mutateLimits = (fn: (rows: MbFoodLimit[]) => MbFoodLimit[]) => {
    dirty.current = true;
    setLimits((rows) => fn(rows));
  };

  const setLimit = (id: string, patch: Partial<MbFoodLimit>) =>
    mutateLimits((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const legacyEntries = Object.entries(legacyFoodLimits ?? {});

  const setItems = (colour: MbColour, meal: MealType, fn: (items: MbPlanItem[]) => MbPlanItem[]) =>
    mutate((d) => {
      const s = d.suggestions.find((x) => x.colour === colour);
      if (s) s.meals[meal].items = fn(s.meals[meal].items);
      return d;
    });

  const copySources = useMemo(
    () =>
      plan.suggestions.flatMap((s) =>
        MEALS.map((m) => ({
          key: `${s.colour}:${m}`,
          label: `${s.label} — ${MEAL_LABEL[m]}`,
        })),
      ),
    [plan],
  );

  const copyMealFrom = (target: { colour: MbColour; meal: MealType }, sourceKey: string) => {
    const [c, m] = sourceKey.split(":") as [MbColour, MealType];
    mutate((d) => {
      const src = d.suggestions.find((x) => x.colour === c)?.meals[m];
      const dst = d.suggestions.find((x) => x.colour === target.colour);
      if (src && dst) {
        dst.meals[target.meal] = {
          note: src.note ?? "",
          items: src.items.map((i) => ({ ...i, id: uid() })),
        };
      }
      return d;
    });
  };

  const duplicateColour = (from: MbColour, to: MbColour) =>
    mutate((d) => {
      const src = d.suggestions.find((x) => x.colour === from);
      const dst = d.suggestions.find((x) => x.colour === to);
      if (src && dst) {
        dst.meals = structuredClone(src.meals);
        for (const m of MEALS) dst.meals[m].items = dst.meals[m].items.map((i) => ({ ...i, id: uid() }));
      }
      return d;
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">MB Plan Setup</Button>
      </DialogTrigger>
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            MB Plan Setup
            {saving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </DialogTitle>
          <DialogDescription>
            Build the three colour days by hand. Saved as a draft — clients see nothing until it is published.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {plan.suggestions.map((s) => (
            <div key={s.colour} className="rounded-lg border p-3 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`h-3 w-3 rounded-full ${COLOUR_DOT[s.colour]}`} />
                <span className="text-xs font-medium w-14">{COLOUR_NAME[s.colour]}</span>
                <Input
                  className="h-8 w-56"
                  value={s.label}
                  onChange={(e) =>
                    mutate((d) => {
                      const t = d.suggestions.find((x) => x.colour === s.colour);
                      if (t) t.label = e.target.value;
                      return d;
                    })
                  }
                />
                <div className="ml-auto flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground">Duplicate colour into</Label>
                  <Select value="" onValueChange={(v) => duplicateColour(s.colour, v as MbColour)}>
                    <SelectTrigger className="h-8 w-36"><SelectValue placeholder="Choose…" /></SelectTrigger>
                    <SelectContent>
                      {MB_COLOURS.filter((c) => c !== s.colour).map((c) => (
                        <SelectItem key={c} value={c}>{COLOUR_NAME[c]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-3">
                {MEALS.map((meal) => {
                  const items = s.meals[meal].items;
                  return (
                    <div key={meal} className="rounded-md border p-2 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wide">{MEAL_LABEL[meal]}</p>
                        <Select value="" onValueChange={(v) => copyMealFrom({ colour: s.colour, meal }, v)}>
                          <SelectTrigger className="h-7 w-32 text-xs">
                            <SelectValue placeholder="Copy from…" />
                          </SelectTrigger>
                          <SelectContent>
                            {copySources
                              .filter((o) => o.key !== `${s.colour}:${meal}`)
                              .map((o) => (
                                <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {items.length === 0 && (
                        <p className="text-xs text-muted-foreground">No items yet.</p>
                      )}

                      {items.map((item, idx) => (
                        <div key={item.id} className="rounded border p-2 space-y-1.5">
                          <div className="flex gap-1.5">
                            <Select
                              value={item.category || "other"}
                              onValueChange={(v) =>
                                setItems(s.colour, meal, (list) =>
                                  list.map((i) => (i.id === item.id ? { ...i, category: v } : i)),
                                )
                              }
                            >
                              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {CATEGORIES.map((c) => (
                                  <SelectItem key={c} value={c}>{CATEGORY_LABEL(c)}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <div className="flex items-center gap-0.5">
                              <Button
                                type="button" variant="ghost" size="icon" className="h-8 w-7"
                                aria-label="Move up" disabled={idx === 0}
                                onClick={() =>
                                  setItems(s.colour, meal, (list) => {
                                    const n = [...list];
                                    [n[idx - 1], n[idx]] = [n[idx], n[idx - 1]];
                                    return n;
                                  })
                                }
                              >
                                <ArrowUp className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                type="button" variant="ghost" size="icon" className="h-8 w-7"
                                aria-label="Move down" disabled={idx === items.length - 1}
                                onClick={() =>
                                  setItems(s.colour, meal, (list) => {
                                    const n = [...list];
                                    [n[idx + 1], n[idx]] = [n[idx], n[idx + 1]];
                                    return n;
                                  })
                                }
                              >
                                <ArrowDown className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                type="button" variant="ghost" size="icon" className="h-8 w-7"
                                aria-label="Remove item"
                                onClick={() =>
                                  setItems(s.colour, meal, (list) => list.filter((i) => i.id !== item.id))
                                }
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>

                          <Input
                            className="h-8 text-xs"
                            placeholder="Label (e.g. Chicken breast)"
                            value={item.label}
                            onChange={(e) =>
                              setItems(s.colour, meal, (list) =>
                                list.map((i) => (i.id === item.id ? { ...i, label: e.target.value } : i)),
                              )
                            }
                          />

                          <div className="flex gap-1.5">
                            <Input
                              className="h-8 w-20 text-xs"
                              type="number"
                              inputMode="decimal"
                              placeholder="Qty"
                              value={item.qty ?? ""}
                              onChange={(e) =>
                                setItems(s.colour, meal, (list) =>
                                  list.map((i) =>
                                    i.id === item.id
                                      ? { ...i, qty: e.target.value === "" ? null : Number(e.target.value) }
                                      : i,
                                  ),
                                )
                              }
                            />
                            <Select
                              value={item.unit}
                              onValueChange={(v) =>
                                setItems(s.colour, meal, (list) =>
                                  list.map((i) => (i.id === item.id ? { ...i, unit: v as MbUnit } : i)),
                                )
                              }
                            >
                              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {UNITS.map((u) => (
                                  <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <Input
                            className="h-8 text-xs"
                            placeholder="Note (optional)"
                            value={item.note ?? ""}
                            onChange={(e) =>
                              setItems(s.colour, meal, (list) =>
                                list.map((i) => (i.id === item.id ? { ...i, note: e.target.value } : i)),
                              )
                            }
                          />
                        </div>
                      ))}

                      <div className="flex gap-1.5">
                        <Button
                          type="button" variant="outline" size="sm" className="h-7 text-xs"
                          onClick={() => setItems(s.colour, meal, (list) => [...list, blankItem()])}
                        >
                          <Plus className="h-3.5 w-3.5 mr-1" /> Add item
                        </Button>
                        {items.length > 0 && (
                          <Button
                            type="button" variant="ghost" size="sm" className="h-7 text-xs"
                            onClick={() =>
                              setItems(s.colour, meal, (list) => [
                                ...list,
                                { ...list[list.length - 1], id: uid() },
                              ])
                            }
                          >
                            <Copy className="h-3.5 w-3.5 mr-1" /> Duplicate last
                          </Button>
                        )}
                      </div>

                      <Input
                        className="h-8 text-xs"
                        placeholder="Meal note (optional)"
                        value={s.meals[meal].note ?? ""}
                        onChange={(e) =>
                          mutate((d) => {
                            const t = d.suggestions.find((x) => x.colour === s.colour);
                            if (t) t.meals[meal].note = e.target.value;
                            return d;
                          })
                        }
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <p className="text-xs text-muted-foreground">
            Draft autosaves. Publishing to clients comes in a later step.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
