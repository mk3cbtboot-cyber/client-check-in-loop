import { useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, ReferenceLine } from "recharts";
import { format } from "date-fns";

export interface CheckInRow {
  id: string;
  created_at: string;
  weight_kg: number | null;
  water_litres: number | null;
  general_wellbeing: number | null;
  fatigue: number | null;
  sleep: number | null;
  digestion: number | null;
  waist_cm: number | null;
  hip_cm: number | null;
  upper_thigh_cm: number | null;
}

interface Props {
  checkIns: CheckInRow[];
  weightUnit?: string;
  heightCm?: number | null;
}

function Graph({
  title,
  data,
  lines,
  yDomain,
  referenceLines,
}: {
  title: string;
  data: any[];
  lines: { key: string; name: string; color: string }[];
  yDomain?: [number | string, number | string];
  referenceLines?: { y: number; label: string; color?: string }[];
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
            {referenceLines?.map((r) => (
              <ReferenceLine
                key={r.label}
                y={r.y}
                stroke={r.color ?? "hsl(var(--muted-foreground))"}
                strokeDasharray="3 3"
                label={{ value: r.label, fontSize: 10, fill: "hsl(var(--muted-foreground))", position: "insideTopRight" }}
              />
            ))}
            {lines.map((l) => (
              <Line key={l.key} type="monotone" dataKey={l.key} name={l.name} stroke={l.color} strokeWidth={2} dot={{ r: 3 }} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function ClientTrendGraphs({ checkIns, weightUnit = "kg", heightCm = null }: Props) {
  const sorted = useMemo(
    () => [...checkIns].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    [checkIns],
  );

  const data = useMemo(
    () =>
      sorted.map((ci) => {
        const w = ci.weight_kg != null ? (weightUnit === "lbs" ? Number(ci.weight_kg) * 2.20462 : Number(ci.weight_kg)) : null;
        const bmi = ci.weight_kg != null && heightCm
          ? Number(ci.weight_kg) / Math.pow(Number(heightCm) / 100, 2)
          : null;
        return {
          label: format(new Date(ci.created_at), "MMM d"),
          weight: w != null ? Number(w.toFixed(1)) : null,
          water: ci.water_litres != null ? Number(ci.water_litres) : null,
          general_wellbeing: ci.general_wellbeing,
          fatigue: ci.fatigue,
          sleep: ci.sleep,
          digestion: ci.digestion,
          waist: ci.waist_cm,
          hip: ci.hip_cm,
          upper_thigh: ci.upper_thigh_cm,
          bmi: bmi != null ? Number(bmi.toFixed(1)) : null,
        };
      }),
    [sorted, weightUnit, heightCm],
  );

  const has = (k: string) => data.some((d) => (d as any)[k] != null);

  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">No data yet to chart.</p>;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {has("weight") && (
        <Graph title={`Weight (${weightUnit})`} data={data} lines={[{ key: "weight", name: "Weight", color: "hsl(var(--primary))" }]} />
      )}
      {has("bmi") && (
        <div className="md:col-span-2">
          <Graph
            title="BMI Over Time"
            data={data}
            lines={[{ key: "bmi", name: "BMI", color: "hsl(var(--primary))" }]}
            referenceLines={[
              { y: 18.5, label: "18.5 Underweight" },
              { y: 25, label: "25 Normal" },
              { y: 30, label: "30 Overweight" },
            ]}
          />
        </div>
      )}
      {has("water") && (
        <Graph title="Water Intake (L)" data={data} lines={[{ key: "water", name: "Litres", color: "hsl(217 91% 60%)" }]} />
      )}
      {has("general_wellbeing") && (
        <Graph title="General Well-Being" data={data} yDomain={[0, 5]} lines={[{ key: "general_wellbeing", name: "Rating", color: "hsl(142 71% 45%)" }]} />
      )}
      {has("fatigue") && (
        <Graph title="Fatigue" data={data} yDomain={[0, 5]} lines={[{ key: "fatigue", name: "Rating", color: "hsl(38 92% 50%)" }]} />
      )}
      {has("sleep") && (
        <Graph title="Sleep" data={data} yDomain={[0, 5]} lines={[{ key: "sleep", name: "Rating", color: "hsl(262 83% 58%)" }]} />
      )}
      {has("digestion") && (
        <Graph title="Digestion" data={data} yDomain={[0, 5]} lines={[{ key: "digestion", name: "Rating", color: "hsl(173 80% 40%)" }]} />
      )}
      {(has("waist") || has("hip") || has("upper_thigh")) && (
        <div className="md:col-span-2">
          <Graph
            title="Body Measurements (cm)"
            data={data}
            lines={[
              { key: "waist", name: "Waist", color: "hsl(var(--primary))" },
              { key: "hip", name: "Hip", color: "hsl(38 92% 50%)" },
              { key: "upper_thigh", name: "Upper Thigh", color: "hsl(262 83% 58%)" },
            ]}
          />
        </div>
      )}
    </div>
  );
}
