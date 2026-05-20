import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Plus } from "lucide-react";

interface Props {
  value: Record<string, number>;
  onSave: (next: Record<string, number>) => void;
}

type Row = { id: string; name: string; limit: string };

export default function WeeklyLimitsEditor({ value, onSave }: Props) {
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    const incoming = Object.entries(value || {}).map(([name, limit]) => ({
      id: crypto.randomUUID(),
      name,
      limit: String(limit),
    }));
    setRows(incoming);
  }, [value]);

  const commit = (next: Row[]) => {
    const out: Record<string, number> = {};
    for (const r of next) {
      const name = r.name.trim();
      const n = Number(r.limit);
      if (!name || !Number.isFinite(n) || n <= 0) continue;
      out[name] = n;
    }
    onSave(out);
  };

  const update = (id: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const remove = (id: string) => {
    const next = rows.filter((r) => r.id !== id);
    setRows(next);
    commit(next);
  };

  const add = () =>
    setRows((rs) => [...rs, { id: crypto.randomUUID(), name: "", limit: "" }]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-sm font-medium">Weekly Food Limits</p>
          <p className="text-xs text-muted-foreground">
            Used by the Meal Planner to warn the client when a meal would exceed their allowance.
            Examples: <code>eggs · 5</code>, <code>salmon · 2</code>, <code>avocado · 3</code>.
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={add}>
          <Plus className="h-4 w-4" /> Add limit
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No weekly limits set.</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-2">
              <Input
                value={r.name}
                placeholder="Food name (e.g. eggs)"
                onChange={(e) => update(r.id, { name: e.target.value })}
                onBlur={() => commit(rows)}
                className="flex-1"
              />
              <Input
                value={r.limit}
                placeholder="Units / week"
                inputMode="numeric"
                onChange={(e) => update(r.id, { limit: e.target.value.replace(/[^\d.]/g, "") })}
                onBlur={() => commit(rows)}
                className="w-32"
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => remove(r.id)}
                aria-label="Remove limit"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
