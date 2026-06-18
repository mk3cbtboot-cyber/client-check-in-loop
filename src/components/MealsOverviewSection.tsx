import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { ChevronDown } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type MealSummary = {
  id: string;
  name: string;
  meal_type: string | null;
  created_at: string;
};

type RecipeDetail = {
  id: string;
  name: string;
  meal_type: string | null;
  created_at: string;
  prep_time: string | null;
  servings: string | null;
  ingredients: unknown;
  instructions: unknown;
};

const MEAL_TARGET = 3;

const dayKey = (iso: string) => new Date(iso).toISOString().slice(0, 10);
const dayLabel = (iso: string) => format(new Date(iso), "MMM d");

const capitalize = (s: string | null | undefined) =>
  s ? s.charAt(0).toUpperCase() + s.slice(1) : "";

function renderIngredients(value: unknown) {
  if (Array.isArray(value)) {
    return (
      <ul className="list-disc pl-5 space-y-1 text-sm">
        {value.map((item, i) => (
          <li key={i}>
            {typeof item === "string"
              ? item
              : item && typeof item === "object"
                ? [
                    (item as any).quantity,
                    (item as any).unit,
                    (item as any).name ?? (item as any).item,
                  ]
                    .filter(Boolean)
                    .join(" ")
                : String(item)}
          </li>
        ))}
      </ul>
    );
  }
  if (typeof value === "string") {
    return <p className="text-sm whitespace-pre-line">{value}</p>;
  }
  return <p className="text-sm text-muted-foreground">No ingredients recorded.</p>;
}

function renderInstructions(value: unknown) {
  if (Array.isArray(value)) {
    return (
      <ol className="list-decimal pl-5 space-y-1 text-sm">
        {value.map((step, i) => (
          <li key={i}>{typeof step === "string" ? step : JSON.stringify(step)}</li>
        ))}
      </ol>
    );
  }
  if (typeof value === "string") {
    return <p className="text-sm whitespace-pre-line">{value}</p>;
  }
  return <p className="text-sm text-muted-foreground">No method recorded.</p>;
}

export default function MealsOverviewSection({ recipes }: { recipes: MealSummary[] }) {
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RecipeDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const dateRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Group meals by day, newest first
  const { groups, mealsData, labelToDate } = useMemo(() => {
    const byDay = new Map<string, MealSummary[]>();
    for (const r of recipes) {
      const k = dayKey(r.created_at);
      const arr = byDay.get(k) ?? [];
      arr.push(r);
      byDay.set(k, arr);
    }
    const sortedDesc = [...byDay.entries()].sort(([a], [b]) => b.localeCompare(a));
    for (const [, arr] of sortedDesc) {
      arr.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }
    const sortedAsc = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
    const labelToDateMap: Record<string, string> = {};
    const data = sortedAsc.map(([k, arr]) => {
      const lbl = format(new Date(k), "MMM d");
      labelToDateMap[lbl] = k;
      return { label: lbl, meals: Math.min(arr.length, MEAL_TARGET) };
    });
    return { groups: sortedDesc, mealsData: data, labelToDate: labelToDateMap };
  }, [recipes]);

  // Scroll list to hovered date
  useEffect(() => {
    if (!hoveredDate) return;
    const el = dateRefs.current[hoveredDate];
    if (el && listRef.current) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [hoveredDate]);

  // Load recipe detail when opening
  useEffect(() => {
    if (!openId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    (async () => {
      const { data } = await supabase
        .from("recipes")
        .select("id, name, meal_type, created_at, prep_time, servings, ingredients, instructions")
        .eq("id", openId)
        .maybeSingle();
      if (!cancelled) {
        setDetail((data as RecipeDetail | null) ?? null);
        setLoadingDetail(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [openId]);

  const hoveredHasMeals = hoveredDate
    ? groups.some(([k]) => k === hoveredDate)
    : false;

  return (
    <div className="space-y-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Meals Logged</p>
      {mealsData.length === 0 ? (
        <p className="text-xs text-muted-foreground">No data yet</p>
      ) : (
        <div className="h-36 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={mealsData}
              margin={{ top: 4, right: 8, left: -12, bottom: 0 }}
              onMouseMove={(state: any) => {
                if (!expanded) return;
                const lbl = state?.activeLabel;
                if (typeof lbl === "string") {
                  setHoveredDate(labelToDate[lbl] ?? null);
                }
              }}
              onMouseLeave={() => {
                if (!expanded) return;
                setHoveredDate(null);
              }}
            >
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={[0, MEAL_TARGET]}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false}
                tickLine={false}
                width={40}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--background))",
                  border: "1px solid hsl(var(--border))",
                  fontSize: 12,
                }}
                formatter={(value: number) => [`${value} meals`, "Meals Logged"]}
              />
              <ReferenceLine
                y={MEAL_TARGET}
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="4 4"
                label={{
                  value: `Target ${MEAL_TARGET}`,
                  fontSize: 10,
                  fill: "hsl(var(--muted-foreground))",
                  position: "insideTopRight",
                }}
              />
              <Line
                type="monotone"
                dataKey="meals"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={{ r: 3, fill: "hsl(var(--primary))" }}
                activeDot={{ r: 5 }}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="pt-2 border rounded-md overflow-hidden">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/50 transition-colors"
        >
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Meal Log</p>
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        </button>

        {expanded && (
          <div className="px-3 pb-3">
            <div className="flex items-center justify-between">
              <span className="sr-only">Meal Log</span>
              {hoveredDate && !hoveredHasMeals && (
                <p className="text-[10px] text-muted-foreground">
                  No meals logged on {dayLabel(hoveredDate)}
                </p>
              )}
            </div>
            {groups.length === 0 ? (
              <p className="text-xs text-muted-foreground pt-2">No meals logged yet.</p>
            ) : (
              <div
                ref={listRef}
                className="h-64 mt-2 rounded-md border overflow-y-auto p-2 space-y-3"
              >
                {groups.map(([k, items]) => {
                  const isHighlighted = hoveredDate === k;
                  return (
                    <div
                      key={k}
                      ref={(el) => {
                        dateRefs.current[k] = el;
                      }}
                      className={`rounded-md border transition-colors ${
                        isHighlighted ? "border-primary bg-primary/5" : "border-transparent"
                      }`}
                    >
                      <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                        {format(new Date(k), "EEEE, MMM d")}
                      </div>
                      <ul className="divide-y">
                        {items.map((m) => (
                          <li key={m.id}>
                            <button
                              type="button"
                              onClick={() => setOpenId(m.id)}
                              className="w-full text-left px-2 py-2 hover:bg-muted/50 transition-colors flex items-center justify-between gap-2"
                            >
                              <div className="min-w-0">
                                <p className="text-sm truncate">
                                  <span className="font-medium">{capitalize(m.meal_type) || "Meal"}</span>
                                  {" — "}
                                  <span>{m.name}</span>
                                </p>
                              </div>
                              <span className="text-xs text-muted-foreground shrink-0">
                                {format(new Date(m.created_at), "p")}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <Dialog open={!!openId} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {detail?.name ?? "Recipe"}
            </DialogTitle>
          </DialogHeader>
          {loadingDetail ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : detail ? (
            <div className="space-y-4">
              <div className="text-xs text-muted-foreground flex flex-wrap gap-3">
                {detail.meal_type && <span>{capitalize(detail.meal_type)}</span>}
                <span>Logged {format(new Date(detail.created_at), "PPp")}</span>
                {detail.prep_time && <span>Prep: {detail.prep_time}</span>}
                {detail.servings && <span>Servings: {detail.servings}</span>}
              </div>
              <div>
                <p className="text-sm font-semibold mb-1">Ingredients</p>
                {renderIngredients(detail.ingredients)}
              </div>
              <div>
                <p className="text-sm font-semibold mb-1">Method</p>
                {renderInstructions(detail.instructions)}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Recipe not found.</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
