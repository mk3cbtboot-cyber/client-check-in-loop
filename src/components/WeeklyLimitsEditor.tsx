import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Plus, Check } from "lucide-react";

interface Props {
  value: Record<string, number>;
  onSave: (next: Record<string, number>) => void;
}

type Row = {
  id: string;
  name: string;
  limit: string;
  savedName: string | null; // name as currently persisted (null = not yet saved)
  error: string | null;
};

export default function WeeklyLimitsEditor({ value, onSave }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const initialized = useRef(false);

  // Sync from external value: keep any in-progress (unsaved) rows the user is typing.
  useEffect(() => {
    setRows((prev) => {
      const fromValue: Row[] = Object.entries(value || {}).map(([name, limit]) => ({
        id: crypto.randomUUID(),
        name,
        limit: String(limit),
        savedName: name,
        error: null,
      }));
      if (!initialized.current) {
        initialized.current = true;
        return fromValue;
      }
      const savedNames = new Set(Object.keys(value || {}));
      const unsaved = prev.filter(
        (r) => r.savedName === null || !savedNames.has(r.savedName),
      );
      return [...fromValue, ...unsaved];
    });
  }, [value]);

  const update = (id: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const buildMap = (rs: Row[]): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const r of rs) {
      if (r.savedName !== null) {
        // pull from saved state (post-confirm rows include savedName)
        const n = Number(r.limit);
        if (r.name.trim() && Number.isFinite(n) && n > 0) {
          out[r.name.trim()] = n;
        }
      }
    }
    return out;
  };

  const confirm = (id: string) => {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    const name = row.name.trim();
    const n = Number(row.limit);
    if (!name || !Number.isFinite(n) || n <= 0) {
      update(id, { error: "Please enter both a food name and a weekly limit" });
      return;
    }
    const next = rows.map((r) =>
      r.id === id ? { ...r, name, savedName: name, error: null } : r,
    );
    setRows(next);
    onSave(buildMap(next));
  };

  const remove = (id: string) => {
    const row = rows.find((r) => r.id === id);
    const next = rows.filter((r) => r.id !== id);
    setRows(next);
    if (row?.savedName) onSave(buildMap(next));
  };

  const add = () =>
    setRows((rs) => [
      ...rs,
      { id: crypto.randomUUID(), name: "", limit: "", savedName: null, error: null },
    ]);

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
          {rows.map((r) => {
            const dirty =
              r.savedName === null ||
              r.savedName !== r.name.trim() ||
              String(value?.[r.savedName] ?? "") !== r.limit;
            return (
              <div key={r.id} className="space-y-1">
                <div className="flex items-center gap-2">
                  <Input
                    value={r.name}
                    placeholder="Food name (e.g. eggs)"
                    onChange={(e) => update(r.id, { name: e.target.value, error: null })}
                    className="flex-1"
                  />
                  <Input
                    value={r.limit}
                    placeholder="Units / week"
                    inputMode="numeric"
                    onChange={(e) =>
                      update(r.id, {
                        limit: e.target.value.replace(/[^\d.]/g, ""),
                        error: null,
                      })
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        confirm(r.id);
                      }
                    }}
                    className="w-32"
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant={dirty ? "default" : "ghost"}
                    onClick={() => confirm(r.id)}
                    disabled={!dirty}
                    aria-label="Save limit"
                  >
                    <Check className="h-4 w-4" />
                  </Button>
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
                {r.error && (
                  <p className="text-xs text-destructive pl-1">{r.error}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
