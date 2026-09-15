import { useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { format } from "date-fns";
import { STANDARD_CHECKIN_METRICS, type CheckinMetric, CHECKIN_METRIC_KEYS } from "@/lib/checkin-metrics";

export type CheckInRow = {
  id: string;
  created_at: string;
  weight_kg: number | null;
  water_litres: number | null;
  waist_cm: number | null;
  hip_cm: number | null;
  chest_cm: number | null;
  upper_thigh_cm: number | null;
} & { [K in (typeof CHECKIN_METRIC_KEYS)[number]]: number | null };

interface Props {
  checkIns: CheckInRow[];
  weightUnit?: string;
  gender?: "female" | "male" | "unspecified" | null;
  /** Metrics to chart — defaults to the standard nine (MB behaviour). */
  metrics?: CheckinMetric[];
}

function Graph({
  title,
  data,
  lines,
  yDomain,
}: {
  title: string;
  data: any[];
  lines: { key: string; name: string; color: string }[];
  yDomain?: [number | string, number | string];
}) {
  if (data.length === 0) return null;
  return (
    <div className="border rounded-md p-3 bg-card">
      <p className="text-sm font-medium mb-2">{title}</p>
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
            <YAxis domain={yDomain} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
            <Tooltip
              contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", fontSize: 12 }}
            />
            {lines.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
            {lines.map((l) => (
              <Line key={l.key} type="monotone" dataKey={l.key} name={l.name} stroke={l.color} strokeWidth={2} dot={{ r: 3 }} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function ClientTrendGraphs({ checkIns, weightUnit = "kg", gender, metrics = STANDARD_CHECKIN_METRICS }: Props) {
  const sorted = useMemo(
    () => [...checkIns].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    [checkIns],
  );

  const data = useMemo(
    () =>
      sorted.map((ci) => {
        const w = ci.weight_kg != null ? (weightUnit === "lbs" ? Number(ci.weight_kg) * 2.20462 : Number(ci.weight_kg)) : null;
        return {
          label: format(new Date(ci.created_at), "MMM d"),
          weight: w != null ? Number(w.toFixed(1)) : null,
          water: ci.water_litres != null ? Number(ci.water_litres) : null,
          ...Object.fromEntries(CHECKIN_METRIC_KEYS.map((k) => [k, (ci as any)[k] ?? null])),
          waist: ci.waist_cm,
          hip: ci.hip_cm,
          chest: ci.chest_cm,
          upper_thigh: ci.upper_thigh_cm,
        };
      }),
    [sorted, weightUnit],
  );

  const has = (k: string) => data.some((d) => (d as any)[k] != null);

  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">No data yet to chart.</p>;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {metrics.map((m) =>
        has(m.key) ? (
          <Graph
            key={m.key}
            title={m.label}
            data={data}
            yDomain={[0, 5]}
            lines={[{ key: m.key, name: "Rating (1 Best, 5 Worst)", color: m.color }]}
          />
        ) : null,
      )}
      {(() => {
        const showHip = gender !== "male";
        const showChest = gender !== "female";
        if (!has("waist") && !(showHip && has("hip")) && !(showChest && has("chest")) && !has("upper_thigh")) return null;
        const lines: { key: string; name: string; color: string }[] = [
          { key: "waist", name: "Waist", color: "hsl(var(--primary))" },
        ];
        if (showHip) lines.push({ key: "hip", name: "Hip Circumference", color: "hsl(38 92% 50%)" });
        if (showChest) lines.push({ key: "chest", name: "Chest Circumference", color: "hsl(173 80% 40%)" });
        lines.push({ key: "upper_thigh", name: "Upper Thigh", color: "hsl(262 83% 58%)" });
        return (
          <div className="md:col-span-2">
            <Graph title="Body Measurements (cm)" data={data} lines={lines} />
          </div>
        );
      })()}
    </div>
  );
}
