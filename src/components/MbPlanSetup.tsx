import { useCallback, useEffect, useRef, useState } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Copy, Loader2, Plus, Trash2, X } from "lucide-react";
import { type MealType } from "@/lib/mb-foods";
import MbPersonalFoodList from "@/components/MbPersonalFoodList";
import WeeklyLimitsEditor from "@/components/WeeklyLimitsEditor";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";


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
const COLOUR_BAR: Record<MbColour, string> = {
  blue: "bg-sky-500",
  green: "bg-emerald-500",
  orange: "bg-amber-500",
};

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

interface Phase2Category {
  title: string;
  items: string[];
}

interface WeeklyAck {
  food_name: string;
  limit_value: number;
  acknowledged_at: string;
}

interface Props {
  clientId: string;
  mbPlan: unknown;
  /** Enriched caps draft (clients.mb_food_limits). */
  mbFoodLimits?: unknown;
  /** Legacy flat caps (clients.food_limits) — shown read-only for reference. */
  legacyFoodLimits?: Record<string, number> | null;
  /** Full client row — seeds the Personal Food List from the food_* columns. */
  client?: Record<string, unknown> | null;
  onSaved?: () => void;

  /* --- relocated from the practitioner Meal Plan tab (unchanged behaviour) --- */
  clientName?: string;
  phase?: string | null;
  phase2Categories?: Phase2Category[];
  phase2Customised?: boolean;
  phase3Groups?: Phase2Category[];
  weeklyAcks?: WeeklyAck[];
  onRestorePhase2Defaults?: () => void;
  onDeletePhase2Section?: (title: string) => void;
  onDeletePhase2Item?: (title: string, item: string) => void;
  onSaveWeeklyLimits?: (limits: Record<string, number>) => void;
}

export function MbPlanSetup({
  clientId, mbPlan, mbFoodLimits, legacyFoodLimits, client, onSaved,
  clientName = "This client", phase, phase2Categories = [], phase2Customised = false,
  phase3Groups = [], weeklyAcks = [],
  onRestorePhase2Defaults, onDeletePhase2Section, onDeletePhase2Item, onSaveWeeklyLimits,
}: Props) {


  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<MbPlan>(() => parseMbPlan(mbPlan) ?? blankPlan());
  const [limits, setLimits] = useState<MbFoodLimit[]>(() => parseMbFoodLimits(mbFoodLimits));
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);

  // Load the stored draft whenever the dialog opens (never mid-edit).
  useEffect(() => {
    if (open) {
      dirty.current = false;
      setIssues([]);
      setPlan(parseMbPlan(mbPlan) ?? blankPlan());
      setLimits(parseMbFoodLimits(mbFoodLimits));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, clientId]);

  const save = useCallback(
    async (next: MbPlan, nextLimits: MbFoodLimit[], confirmedAt?: string | null) => {
      setSaving(true);
      const payload = {
        ...next,
        version: 1,
        confirmed_at: confirmedAt === undefined ? next.confirmed_at ?? null : confirmedAt,
      };
      const { error } = await supabase
        .from("clients")
        // mb_food_limits is stored only; clients.food_limits is never touched here.
        .update({ mb_plan: payload as never, mb_food_limits: nextLimits as never })
        .eq("id", clientId);
      setSaving(false);
      if (error) {
        toast.error(`Not saved: ${error.message}`);
        return false;
      }
      onSaved?.();
      return true;
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

  const validate = (p: MbPlan): string[] => {
    const problems: string[] = [];
    for (const colour of MB_COLOURS) {
      const s = p.suggestions.find((x) => x.colour === colour);
      if (!s) {
        problems.push(`${COLOUR_NAME[colour]}: missing entirely`);
        continue;
      }
      for (const meal of MEALS) {
        const items = (s.meals?.[meal]?.items ?? []).filter((i) => i.label.trim() !== "");
        if (items.length === 0) {
          problems.push(`${COLOUR_NAME[colour]} — ${MEAL_LABEL[meal]}: needs at least one item`);
        }
      }
    }
    return problems;
  };

  const confirmPlan = async () => {
    const problems = validate(plan);
    setIssues(problems);
    if (problems.length > 0) {
      toast.error("Plan is incomplete — see the list below.");
      return;
    }
    setConfirming(true);
    if (timer.current) clearTimeout(timer.current);
    const stamp = new Date().toISOString();
    const ok = await save(plan, limits, stamp);
    setConfirming(false);
    if (ok) {
      dirty.current = false;
      setPlan((p) => ({ ...p, confirmed_at: stamp }));
      toast.success("Plan confirmed.");
      setOpen(false);
    }
  };


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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">MB Plan Setup</Button>
      </DialogTrigger>
      <DialogContent className="max-w-6xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            MB Plan Setup
            {saving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </DialogTitle>
          <DialogDescription>
            Build the three colour days by hand. Saved as a draft — clients see nothing until it is published.
          </DialogDescription>
        </DialogHeader>

        {plan.confirmed_at && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2">
            <p className="text-xs text-amber-700 dark:text-amber-400">
              You are editing a live plan (confirmed {new Date(plan.confirmed_at).toLocaleString()}).
              Changes autosave; re-confirm to republish.
            </p>
          </div>
        )}


        <div className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-3">
          {plan.suggestions.map((s) => (

            <div key={s.colour} className="rounded-lg border overflow-hidden space-y-0">
              <div className={`h-3 ${COLOUR_BAR[s.colour]}`} />
              <div className="p-3">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <span className="text-sm font-semibold">{COLOUR_LABEL[s.colour]}</span>
                  <span className="text-xs text-muted-foreground">{COLOUR_NAME[s.colour]}</span>
                </div>

                <div className="grid gap-3">
                  {MEALS.map((meal) => {
                    const items = s.meals[meal].items;
                    return (
                      <div key={meal} className="rounded-md border p-2 space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide">{MEAL_LABEL[meal]}</p>

                        {items.length === 0 && (
                          <p className="text-xs text-muted-foreground">No items yet.</p>
                        )}

                        {items.map((item, idx) => (
                          <div key={item.id} className="rounded border p-2 space-y-1.5">
                            <div className="flex items-start gap-1.5">
                              <Input
                                className="h-8 text-xs"
                                placeholder="Food / category (e.g. Chicken breast)"
                                value={item.label}
                                onChange={(e) =>
                                  setItems(s.colour, meal, (list) =>
                                    list.map((i) => (i.id === item.id ? { ...i, label: e.target.value } : i)),
                                  )
                                }
                              />
                              <div className="flex items-center gap-0.5 shrink-0">
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
            </div>
          ))}
          </div>

          <MbPersonalFoodList clientId={clientId} client={client} onSaved={onSaved} />

          {(phase === "phase2_strict" || phase === "phase2_extended") && (
            <div className="rounded-lg border p-3 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <p className="text-sm font-medium">
                    {phase === "phase2_extended"
                      ? "Phase 2 Extended — Personal Food List"
                      : "Phase 2 Strict — Personal Food List"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {phase === "phase2_extended"
                      ? "Same food list as Phase 2 Strict, with treat meals allowed. Remove sections or items — changes save instantly."
                      : "Remove entire sections or individual items. Changes save instantly and appear in the client's My Plan."}
                  </p>
                </div>
                {phase2Customised && onRestorePhase2Defaults && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button type="button" size="sm" variant="outline">Restore Defaults</Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Restore default food list?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will reset {clientName}'s Phase 2 Strict food list back to the full default list. Any sections or items you've removed will be restored.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => onRestorePhase2Defaults()}>Restore Defaults</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
              {phase2Categories.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {phase2Customised
                    ? 'All sections have been removed. Use "Restore Defaults" to bring the list back.'
                    : "No food list yet — upload this client's MB PDF to populate it."}
                </p>
              ) : (
                <div className="space-y-3">
                  {phase2Categories.map((cat) => (
                    <div key={cat.title} className="border rounded-md p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium">{cat.title}</p>
                        {onDeletePhase2Section && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button type="button" size="sm" variant="ghost" className="text-destructive hover:text-destructive">Delete Section</Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Remove section?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to remove the entire {cat.title} section from this client's plan?
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => onDeletePhase2Section(cat.title)}>Remove Section</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </div>
                      {cat.items.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No items left in this section.</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {cat.items.map((item) => (
                            <span key={item} className="inline-flex items-center gap-1 rounded-full bg-secondary text-secondary-foreground text-xs pl-2.5 pr-1 py-1">
                              {item}
                              {onDeletePhase2Item && (
                                <button
                                  type="button"
                                  aria-label={`Remove ${item}`}
                                  onClick={() => onDeletePhase2Item(cat.title, item)}
                                  className="rounded-full p-0.5 hover:bg-destructive/20 hover:text-destructive transition-colors"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              )}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {phase === "phase3" && phase3Groups.length > 0 && (
            <div className="rounded-lg border p-3 space-y-3">
              <div>
                <p className="text-sm font-medium">Phase 3 — Extended Personal Food List</p>
                <p className="text-xs text-muted-foreground">Parsed from this client's MB PDF.</p>
              </div>
              <div className="space-y-3">
                {phase3Groups.map((cat) => (
                  <div key={cat.title} className="border rounded-md p-3 space-y-2">
                    <p className="text-sm font-medium">{cat.title}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {cat.items.map((item) => (
                        <span key={item} className="inline-flex items-center rounded-full bg-secondary text-secondary-foreground text-xs px-2.5 py-1">
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {onSaveWeeklyLimits && (
            <div className="rounded-lg border p-3 space-y-3">
              <WeeklyLimitsEditor
                value={legacyFoodLimits ?? {}}
                onSave={(next) => onSaveWeeklyLimits(next)}
              />
              {weeklyAcks.length > 0 && (
                <div className="rounded-md border border-amber-500/40 bg-amber-50/50 dark:bg-amber-950/20 p-3 space-y-1">
                  {weeklyAcks.map((a) => {
                    const d = new Date(a.acknowledged_at);
                    const when = d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
                    return (
                      <p key={a.food_name} className="text-xs">
                        ⚠️ {clientName.split(" ")[0]} acknowledged a weekly {a.food_name.toLowerCase()} limit warning on {when}.
                      </p>
                    );
                  })}
                </div>
              )}
            </div>
          )}





          <div className="rounded-lg border p-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">Food caps</p>
                <p className="text-xs text-muted-foreground">
                  Live caps — enforced when a client picks and confirms a run.
                </p>
              </div>
              <Button
                type="button" variant="outline" size="sm" className="h-7 text-xs"
                onClick={() =>
                  mutateLimits((rows) => [
                    ...rows,
                    { id: uid(), food: "", type: "weekly", min: null, max: null, unit: "count" },
                  ])
                }
              >
                <Plus className="h-3.5 w-3.5 mr-1" /> Add cap
              </Button>
            </div>

            {legacyEntries.length > 0 && (
              <div className="rounded-md bg-muted/50 p-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Existing caps (read-only, current system)
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {legacyEntries.map(([k, v]) => `${k}: ${v}`).join(" · ")}
                </p>
              </div>
            )}

            {limits.length === 0 && <p className="text-xs text-muted-foreground">No caps yet.</p>}

            {limits.map((row) => (
              <div key={row.id} className="rounded-md border p-2 space-y-1.5">
                <div className="flex gap-1.5">
                  <Input
                    className="h-8 text-xs"
                    placeholder="Food (e.g. Eggs)"
                    value={row.food}
                    onChange={(e) => setLimit(row.id, { food: e.target.value })}
                  />
                  <Select
                    value={row.type}
                    onValueChange={(v) => setLimit(row.id, { type: v as MbLimitType })}
                  >
                    <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="per_day">Per day</SelectItem>
                      <SelectItem value="combination">Combination</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    type="button" variant="ghost" size="icon" className="h-8 w-8"
                    aria-label="Remove cap"
                    onClick={() => mutateLimits((rows) => rows.filter((r) => r.id !== row.id))}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div className="flex gap-1.5">
                  <Input
                    className="h-8 w-20 text-xs" type="number" inputMode="decimal" placeholder="Min"
                    value={row.min ?? ""}
                    onChange={(e) =>
                      setLimit(row.id, { min: e.target.value === "" ? null : Number(e.target.value) })
                    }
                  />
                  <Input
                    className="h-8 w-20 text-xs" type="number" inputMode="decimal" placeholder="Max"
                    value={row.max ?? ""}
                    onChange={(e) =>
                      setLimit(row.id, { max: e.target.value === "" ? null : Number(e.target.value) })
                    }
                  />
                  <Input
                    className="h-8 w-28 text-xs"
                    placeholder="Unit (count / serving / g)"
                    value={row.unit ?? ""}
                    onChange={(e) => setLimit(row.id, { unit: e.target.value })}
                  />
                </div>

                {row.type === "combination" && (
                  <Input
                    className="h-8 text-xs"
                    placeholder="Combines with (comma separated)"
                    value={(row.combines_with ?? []).join(", ")}
                    onChange={(e) =>
                      setLimit(row.id, {
                        combines_with: e.target.value
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                )}

                <Input
                  className="h-8 text-xs"
                  placeholder="Note (optional)"
                  value={row.note ?? ""}
                  onChange={(e) => setLimit(row.id, { note: e.target.value })}
                />
              </div>
            ))}
          </div>

          {issues.length > 0 && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3">
              <p className="text-xs font-semibold text-destructive">Cannot confirm — incomplete plan</p>
              <ul className="mt-1 list-disc pl-4 text-xs text-destructive">
                {issues.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Draft autosaves.{" "}
              {plan.confirmed_at
                ? `Confirmed ${new Date(plan.confirmed_at).toLocaleString()}.`
                : "Confirm to mark this plan as live."}
            </p>
            <Button type="button" size="sm" onClick={() => void confirmPlan()} disabled={confirming || saving}>
              {confirming && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {plan.confirmed_at ? "Re-confirm plan" : "Confirm plan"}
            </Button>
          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
}
