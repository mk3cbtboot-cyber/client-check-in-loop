import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bell, Check, Loader2, X } from "lucide-react";

export interface PendingLog {
  date: string;
  days_ago: number;
  slot: string;
  meal_type: string;
  label: string;
  assignment_id?: string;
  prepped?: boolean;
}

interface Props {
  pending: PendingLog[];
  /** Logs the slot via the client's existing logger. Resolve on success. */
  onLog: (p: PendingLog) => Promise<void>;
}

const keyOf = (p: PendingLog) => `${p.date}:${p.slot}:${p.assignment_id ?? ""}`;

/**
 * Dismissible reminder for meals that were planned but never logged.
 * Today's misses read plainly ("You haven't logged Lunch yet"); yesterday's are
 * shown as retroactive and stay loggable. Dismissal is session-local.
 */
export default function MealLogNudge({ pending, onLog }: Props) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [logged, setLogged] = useState<Set<string>>(new Set());

  const visible = useMemo(
    () => pending.filter((p) => !dismissed.has(keyOf(p)) && !logged.has(keyOf(p))),
    [pending, dismissed, logged],
  );

  if (visible.length === 0) return null;

  const handleLog = async (p: PendingLog) => {
    const k = keyOf(p);
    setBusy(k);
    try {
      await onLog(p);
      setLogged((s) => new Set(s).add(k));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="p-4 space-y-3 border-amber-300/70 bg-amber-50/60 dark:bg-amber-950/20">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium flex items-center gap-2">
          <Bell className="h-4 w-4" /> Did you eat these?
        </p>
        <button
          type="button"
          aria-label="Dismiss reminders"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => setDismissed(new Set(pending.map(keyOf)))}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <ul className="space-y-2">
        {visible.map((p) => {
          const k = keyOf(p);
          const retro = p.days_ago > 0;
          return (
            <li key={k} className="flex items-center justify-between gap-3 text-sm">
              <span>
                {retro
                  ? `Yesterday's ${p.label.toLowerCase()} wasn't logged`
                  : `You haven't logged ${p.label.toLowerCase()} yet`}
                {p.prepped && (
                  <span className="text-muted-foreground"> · you prepped this</span>
                )}
              </span>
              <span className="flex items-center gap-1 shrink-0">
                <Button size="sm" disabled={busy === k} onClick={() => handleLog(p)}>
                  {busy === k ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  <span className="ml-1">I ate this</span>
                </Button>
                <button
                  type="button"
                  aria-label={`Dismiss ${p.label}`}
                  className="text-muted-foreground hover:text-foreground px-1"
                  onClick={() => setDismissed((s) => new Set(s).add(k))}
                >
                  <X className="h-4 w-4" />
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
