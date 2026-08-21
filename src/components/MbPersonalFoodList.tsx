import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Loader2, Plus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  MB_FOOD_CATEGORIES, resolveMbFoodList, seedMbFoodList, type MbFoodListMap,
} from "@/lib/mb-food-list";

interface Props {
  clientId: string;
  /** The full client row — used to seed from the legacy food_* columns. */
  client: Record<string, unknown> | null | undefined;
  /** Client's current MB phase — labels the list (Phase 1 has no food list). */
  phase?: string | null;
  onSaved?: () => void;
}

/**
 * The client's ONE personal approved-food list, organised by category.
 * Chips are removable; sections can be deleted; items can be added back.
 * Saves to clients.mb_food_list (the legacy food_* columns are never touched).
 */
export function MbPersonalFoodList({ clientId, client, phase, onSaved }: Props) {

  const [list, setList] = useState<MbFoodListMap>(() => resolveMbFoodList(client));
  const [adding, setAdding] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);

  useEffect(() => {
    dirty.current = false;
    setList(resolveMbFoodList(client));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const save = useCallback(
    async (next: MbFoodListMap) => {
      setSaving(true);
      const { error } = await supabase
        .from("clients")
        .update({ mb_food_list: next as never })
        .eq("id", clientId);
      setSaving(false);
      if (error) {
        toast.error(`Food list not saved: ${error.message}`);
        return;
      }
      onSaved?.();
    },
    [clientId, onSaved],
  );

  useEffect(() => {
    if (!dirty.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(list), 700);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [list, save]);

  const mutate = (fn: (m: MbFoodListMap) => MbFoodListMap) => {
    dirty.current = true;
    setList((m) => fn({ ...m }));
  };

  const removeItem = (key: string, item: string) =>
    mutate((m) => ({ ...m, [key]: (m[key] ?? []).filter((i) => i !== item) }));

  const deleteSection = (key: string) =>
    mutate((m) => ({ ...m, [key]: [] }));

  const addItem = (key: string) => {
    const raw = (adding[key] ?? "").trim();
    if (!raw) return;
    mutate((m) => {
      const existing = m[key] ?? [];
      if (existing.some((i) => i.toLowerCase() === raw.toLowerCase())) return m;
      return { ...m, [key]: [...existing, raw] };
    });
    setAdding((a) => ({ ...a, [key]: "" }));
  };

  const restoreSeed = () => {
    dirty.current = true;
    setList(seedMbFoodList(client));
  };

  const isEmpty = MB_FOOD_CATEGORIES.every((c) => (list[c.key] ?? []).length === 0);

  return (
    <div className="rounded-lg border p-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold flex items-center gap-2">
            Personal Food List
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </p>
          <p className="text-xs text-muted-foreground">
            One list for this client — the foods they can pick from inside each suggestion. Changes save automatically.
          </p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs">Restore from plan</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Restore the food list?</AlertDialogTitle>
              <AlertDialogDescription>
                This resets the list back to the foods on file from this client's MB plan. Anything you removed comes back.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={restoreSeed}>Restore</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {isEmpty && (
        <p className="text-xs text-muted-foreground">
          No foods on file yet. Add items below, or upload this client's MB PDF first.
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {MB_FOOD_CATEGORIES.map((cat) => {
          const items = list[cat.key] ?? [];
          return (
            <div key={cat.key} className="border rounded-md p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{cat.label}</p>
                {items.length > 0 && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button type="button" size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:text-destructive">
                        Delete Section
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove section?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Remove every food in the {cat.label} section from this client's list?
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => deleteSection(cat.key)}>Remove Section</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>

              {items.length === 0 ? (
                <p className="text-xs text-muted-foreground">No items in this section.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {items.map((item) => (
                    <span
                      key={item}
                      className="inline-flex items-center gap-1 rounded-full bg-secondary text-secondary-foreground text-xs pl-2.5 pr-1 py-1"
                    >
                      {item}
                      <button
                        type="button"
                        aria-label={`Remove ${item}`}
                        onClick={() => removeItem(cat.key, item)}
                        className="rounded-full p-0.5 hover:bg-destructive/20 hover:text-destructive transition-colors"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="flex gap-1.5">
                <Input
                  className="h-8 text-xs"
                  placeholder={`Add to ${cat.label}…`}
                  value={adding[cat.key] ?? ""}
                  onChange={(e) => setAdding((a) => ({ ...a, [cat.key]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); addItem(cat.key); }
                  }}
                />
                <Button
                  type="button" variant="outline" size="icon" className="h-8 w-8"
                  aria-label={`Add to ${cat.label}`}
                  onClick={() => addItem(cat.key)}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default MbPersonalFoodList;
