import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import {
  makeInstruction,
  parsePlanInstructions,
  type PlanInstruction,
} from "@/lib/plan-instructions";

interface Props {
  /**
   * Autosave mode: when provided, the list is persisted to
   * clients.plan_instructions on change (debounced).
   */
  clientId?: string;
  /** Initial / controlled value (raw jsonb or parsed list). */
  value: unknown;
  /** Controlled mode: called on every change instead of (or besides) autosaving. */
  onChange?: (next: PlanInstruction[]) => void;
  onSaved?: () => void;
  className?: string;
  title?: string;
  description?: string;
}

/**
 * Free-text plan-instruction editor. Parsed entries are marked but fully
 * editable; new rows are practitioner-authored. Nothing here is enforced.
 */
export default function PlanInstructionsEditor({
  clientId,
  value,
  onChange,
  onSaved,
  className = "",
  title = "Plan instructions",
  description = "Free-text guidance shown to the client on their My Plan tab. Not enforced.",
}: Props) {
  const [items, setItems] = useState<PlanInstruction[]>(() => parsePlanInstructions(value));
  const [saving, setSaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);

  // Re-sync only when the target client changes (or, in controlled mode, never
  // clobber mid-typing state from a parent re-render).
  useEffect(() => {
    setItems(parsePlanInstructions(value));
    dirty.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const persist = useCallback(
    async (next: PlanInstruction[]) => {
      if (!clientId) return;
      setSaving(true);
      const { error } = await supabase
        .from("clients")
        .update({ plan_instructions: next as never })
        .eq("id", clientId);
      setSaving(false);
      if (error) {
        toast.error("Could not save instructions", { description: error.message });
        return;
      }
      onSaved?.();
    },
    [clientId, onSaved],
  );

  const apply = (updater: (rows: PlanInstruction[]) => PlanInstruction[]) => {
    setItems((rows) => {
      const next = updater(rows);
      dirty.current = true;
      onChange?.(next);
      if (clientId) {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => void persist(next), 600);
      }
      return next;
    });
  };

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <div className={`rounded-lg border p-3 space-y-3 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">
            {title}
            {saving && <Loader2 className="inline h-3 w-3 ml-2 animate-spin text-muted-foreground" />}
          </p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => apply((rows) => [...rows, makeInstruction("", "practitioner")])}
        >
          <Plus className="h-3.5 w-3.5 mr-1" /> Add instruction
        </Button>
      </div>

      {items.length === 0 && (
        <p className="text-xs text-muted-foreground">No instructions yet.</p>
      )}

      {items.map((row) => (
        <div key={row.id} className="rounded-md border p-2 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {row.source === "parsed" ? `From plan document${row.origin ? ` · ${row.origin}` : ""}` : "Added by you"}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              aria-label="Remove instruction"
              onClick={() => apply((rows) => rows.filter((r) => r.id !== row.id))}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          <Textarea
            className="min-h-[56px] text-xs"
            placeholder="e.g. Eat potatoes with eggs only twice per week."
            value={row.text}
            onChange={(e) =>
              apply((rows) => rows.map((r) => (r.id === row.id ? { ...r, text: e.target.value } : r)))
            }
          />
        </div>
      ))}
    </div>
  );
}
