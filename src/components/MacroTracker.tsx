import { Card } from "@/components/ui/card";

export interface MacroSet {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

interface Props {
  target: MacroSet;
  used: MacroSet;
}

function remainColor(remaining: number, target: number): string {
  if (target <= 0) return "text-foreground";
  if (remaining < 0) return "text-red-600 dark:text-red-400";
  const pct = Math.abs(remaining) / target;
  if (pct <= 0.1) return "text-amber-600 dark:text-amber-400";
  return "text-green-600 dark:text-green-400";
}

function Stat({ label, unit, target, used }: { label: string; unit: string; target: number; used: number }) {
  const remaining = target - used;
  return (
    <Card className="p-3 space-y-1">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-base font-semibold">{Math.round(target)}{unit} <span className="text-xs font-normal text-muted-foreground">target</span></p>
      <p className="text-xs text-muted-foreground">Used {Math.round(used)}{unit}</p>
      <p className={`text-xs font-medium ${remainColor(remaining, target)}`}>
        {remaining >= 0 ? `${Math.round(remaining)}${unit} left` : `${Math.round(Math.abs(remaining))}${unit} over`}
      </p>
    </Card>
  );
}

export default function MacroTracker({ target, used }: Props) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Macro tracker</h3>
        <span className="text-[11px] text-muted-foreground">Estimated from added foods</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat label="Calories" unit=" kcal" target={target.calories} used={used.calories} />
        <Stat label="Protein" unit="g" target={target.protein_g} used={used.protein_g} />
        <Stat label="Carbs" unit="g" target={target.carbs_g} used={used.carbs_g} />
        <Stat label="Fat" unit="g" target={target.fat_g} used={used.fat_g} />
      </div>
    </div>
  );
}
