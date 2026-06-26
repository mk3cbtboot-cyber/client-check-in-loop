import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type ActivityLevel =
  | "sedentary"
  | "lightly_active"
  | "moderately_active"
  | "very_active"
  | "extra_active";
type MacroGoal = "weight_loss" | "maintenance" | "muscle_gain";

interface MacroSet {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

interface ClientLike {
  id: string;
  gender: "female" | "male" | "unspecified" | null;
  height_cm: number | null;
  weight_unit: string;
  age?: number | null;
  activity_level?: ActivityLevel | null;
  macro_goal?: MacroGoal | null;
  macros?: MacroSet | null;
  macros_adjusted?: MacroSet | null;
  macros_shared?: boolean | null;
}

interface Props {
  client: ClientLike;
  latestWeightKg: number | null;
  onChanged?: (patch: Partial<ClientLike>) => void;
  onGoToProfile?: () => void;
}

const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  lightly_active: 1.375,
  moderately_active: 1.55,
  very_active: 1.725,
  extra_active: 1.9,
};

const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: "Sedentary — little or no exercise",
  lightly_active: "Lightly active — 1 to 3 days per week",
  moderately_active: "Moderately active — 3 to 5 days per week",
  very_active: "Very active — 6 to 7 days per week",
  extra_active: "Extra active — very hard exercise or physical job",
};

const GOAL_LABELS: Record<MacroGoal, string> = {
  weight_loss: "Weight loss — 500 cal deficit",
  maintenance: "Maintenance — TDEE",
  muscle_gain: "Muscle gain — 300 cal surplus",
};

function round(n: number) {
  return Math.round(n);
}

function calcMacros(
  weightKg: number,
  heightCm: number,
  age: number,
  gender: "female" | "male",
  activity: ActivityLevel,
  goal: MacroGoal,
): MacroSet {
  const bmr =
    gender === "male"
      ? 10 * weightKg + 6.25 * heightCm - 5 * age + 5
      : 10 * weightKg + 6.25 * heightCm - 5 * age - 161;
  const tdee = bmr * ACTIVITY_MULTIPLIERS[activity];
  const calories =
    goal === "weight_loss" ? tdee - 500 : goal === "muscle_gain" ? tdee + 300 : tdee;
  const protein_g = (calories * 0.3) / 4;
  const carbs_g = (calories * 0.4) / 4;
  const fat_g = (calories * 0.3) / 9;
  return {
    calories: round(calories),
    protein_g: round(protein_g),
    carbs_g: round(carbs_g),
    fat_g: round(fat_g),
  };
}

export function MacrosTab({ client, latestWeightKg, onChanged, onGoToProfile }: Props) {
  const isLbs = client.weight_unit === "lbs";
  const heightCm = client.height_cm ? Number(client.height_cm) : null;
  const gender = client.gender === "male" || client.gender === "female" ? client.gender : null;

  // Initial weight in client's unit
  const initialWeight = useMemo(() => {
    if (latestWeightKg == null) return "";
    return isLbs ? (latestWeightKg * 2.20462).toFixed(1) : latestWeightKg.toFixed(1);
  }, [latestWeightKg, isLbs]);

  const [weightInput, setWeightInput] = useState<string>(initialWeight);
  const [age, setAge] = useState<string>(client.age != null ? String(client.age) : "");
  const [activity, setActivity] = useState<ActivityLevel | "">(client.activity_level ?? "");
  const [goal, setGoal] = useState<MacroGoal | "">(client.macro_goal ?? "");

  const [calculated, setCalculated] = useState<MacroSet | null>(client.macros ?? null);
  const [adjusted, setAdjusted] = useState<MacroSet | null>(
    client.macros_adjusted ?? client.macros ?? null,
  );
  const [shared, setShared] = useState<boolean>(!!client.macros_shared);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setWeightInput(initialWeight);
  }, [initialWeight]);

  const heightDisplay = heightCm == null
    ? "not set"
    : client.weight_unit === "lbs"
      ? `${Math.floor(heightCm / 2.54 / 12)}ft ${Math.round((heightCm / 2.54) % 12)}in`
      : `${heightCm}cm`;
  const genderDisplay = gender ? gender.charAt(0).toUpperCase() + gender.slice(1) : "not set";

  async function persist(patch: Record<string, unknown>) {
    const { error } = await supabase.from("clients").update(patch).eq("id", client.id);
    if (error) throw error;
    onChanged?.(patch as Partial<ClientLike>);
  }

  async function handleCalculate() {
    if (!gender) {
      toast.error("Biological sex is required");
      return;
    }
    if (heightCm == null) {
      toast.error("Height is required");
      return;
    }
    const ageNum = Number(age);
    if (!Number.isFinite(ageNum) || ageNum <= 0) {
      toast.error("Enter a valid age");
      return;
    }
    if (!activity) {
      toast.error("Select an activity level");
      return;
    }
    if (!goal) {
      toast.error("Select a goal");
      return;
    }
    const wNum = Number(weightInput);
    if (!Number.isFinite(wNum) || wNum <= 0) {
      toast.error("Enter a valid weight");
      return;
    }
    const weightKg = isLbs ? wNum / 2.20462 : wNum;
    const result = calcMacros(weightKg, heightCm, ageNum, gender, activity, goal);
    setCalculated(result);
    setAdjusted(result);

    try {
      await persist({
        age: ageNum,
        activity_level: activity,
        macro_goal: goal,
      });
    } catch (e) {
      toast.error("Failed to save inputs");
      console.error(e);
    }
  }

  function updateAdjusted(field: keyof MacroSet, raw: string) {
    if (!adjusted) return;
    const n = Number(raw);
    const v = Number.isFinite(n) ? n : 0;
    const next = { ...adjusted, [field]: v };
    if (field !== "calories") {
      next.calories = round(next.protein_g * 4 + next.carbs_g * 4 + next.fat_g * 9);
    }
    setAdjusted(next);
  }

  async function handleSave() {
    if (!adjusted) return;
    setSaving(true);
    try {
      await persist({
        macros: adjusted,
        macros_adjusted: adjusted,
      });
      toast.success("Macros saved");
    } catch (e) {
      toast.error("Failed to save macros");
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    if (calculated) setAdjusted(calculated);
  }

  async function handleToggleShared(v: boolean) {
    setShared(v);
    try {
      await persist({ macros_shared: v });
    } catch (e) {
      setShared(!v);
      toast.error("Failed to update sharing");
      console.error(e);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-4">
        <p className="font-medium">Calculator</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Weight ({isLbs ? "lbs" : "kg"})</Label>
            <Input
              type="number"
              inputMode="decimal"
              value={weightInput}
              onChange={(e) => setWeightInput(e.target.value)}
              placeholder={isLbs ? "e.g. 165" : "e.g. 75"}
            />
          </div>
          <div className="space-y-1">
            <Label>Height</Label>
            <div className="flex items-center gap-2">
              <Input value={heightDisplay} readOnly className="bg-muted" />
              {onGoToProfile && (
                <button type="button" onClick={onGoToProfile} className="text-xs underline text-primary whitespace-nowrap">
                  Edit
                </button>
              )}
            </div>
          </div>
          <div className="space-y-1">
            <Label>Biological sex</Label>
            <div className="flex items-center gap-2">
              <Input value={genderDisplay} readOnly className="bg-muted" />
              {onGoToProfile && (
                <button type="button" onClick={onGoToProfile} className="text-xs underline text-primary whitespace-nowrap">
                  Edit
                </button>
              )}
            </div>
          </div>
          <div className="space-y-1">
            <Label>Age</Label>
            <Input
              type="number"
              inputMode="numeric"
              value={age}
              onChange={(e) => setAge(e.target.value)}
              placeholder="e.g. 35"
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Activity level</Label>
            <Select value={activity} onValueChange={(v) => setActivity(v as ActivityLevel)}>
              <SelectTrigger><SelectValue placeholder="Select activity level" /></SelectTrigger>
              <SelectContent>
                {(Object.keys(ACTIVITY_LABELS) as ActivityLevel[]).map((k) => (
                  <SelectItem key={k} value={k}>{ACTIVITY_LABELS[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Goal</Label>
            <Select value={goal} onValueChange={(v) => setGoal(v as MacroGoal)}>
              <SelectTrigger><SelectValue placeholder="Select goal" /></SelectTrigger>
              <SelectContent>
                {(Object.keys(GOAL_LABELS) as MacroGoal[]).map((k) => (
                  <SelectItem key={k} value={k}>{GOAL_LABELS[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button onClick={handleCalculate}>Calculate</Button>
      </Card>

      {adjusted && (
        <Card className="p-4 space-y-4">
          <p className="font-medium">Results</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {([
              ["Calories", adjusted.calories, "kcal"],
              ["Protein", adjusted.protein_g, "g"],
              ["Carbs", adjusted.carbs_g, "g"],
              ["Fat", adjusted.fat_g, "g"],
            ] as const).map(([label, v, unit]) => (
              <div key={label} className="rounded border p-3 text-center">
                <p className="text-xs uppercase text-muted-foreground">{label}</p>
                <p className="text-xl font-semibold">{v}<span className="text-xs text-muted-foreground ml-1">{unit}</span></p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label>Calories</Label>
              <Input
                type="number"
                value={adjusted.calories}
                onChange={(e) => updateAdjusted("calories", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Protein (g)</Label>
              <Input
                type="number"
                value={adjusted.protein_g}
                onChange={(e) => updateAdjusted("protein_g", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Carbs (g)</Label>
              <Input
                type="number"
                value={adjusted.carbs_g}
                onChange={(e) => updateAdjusted("carbs_g", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Fat (g)</Label>
              <Input
                type="number"
                value={adjusted.fat_g}
                onChange={(e) => updateAdjusted("fat_g", e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
            {calculated && (
              <button
                type="button"
                onClick={handleReset}
                className="text-sm underline text-muted-foreground"
              >
                Reset to calculated
              </button>
            )}
          </div>
        </Card>
      )}

      <Card className="p-4 flex items-center justify-between gap-3">
        <div>
          <p className="font-medium">Share macro targets with client</p>
          <p className="text-xs text-muted-foreground">
            When on, the client sees their macros in the My Plan tab.
          </p>
        </div>
        <Switch checked={shared} onCheckedChange={handleToggleShared} />
      </Card>
    </div>
  );
}
