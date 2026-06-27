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
  calorie_adjustment?: number | null;
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
  weight_loss: "Weight loss — calorie deficit",
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
  deficit: number,
): MacroSet {
  const bmr =
    gender === "male"
      ? 10 * weightKg + 6.25 * heightCm - 5 * age + 5
      : 10 * weightKg + 6.25 * heightCm - 5 * age - 161;
  const tdee = bmr * ACTIVITY_MULTIPLIERS[activity];
  const calories =
    goal === "weight_loss" ? tdee - deficit : goal === "muscle_gain" ? tdee + 300 : tdee;
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
  const [weightUnit, setWeightUnit] = useState<"kg" | "lbs">(
    client.weight_unit === "lbs" ? "lbs" : "kg",
  );
  const isLbs = weightUnit === "lbs";
  const heightCm = client.height_cm ? Number(client.height_cm) : null;
  const gender = client.gender === "male" || client.gender === "female" ? client.gender : null;

  const [heightUnit, setHeightUnit] = useState<"cm" | "ftin">(
    client.weight_unit === "lbs" ? "ftin" : "cm",
  );

  const initialWeight = useMemo(() => {
    if (latestWeightKg == null) return "";
    return isLbs ? (latestWeightKg * 2.20462).toFixed(1) : latestWeightKg.toFixed(1);
  }, [latestWeightKg, isLbs]);

  const [weightInput, setWeightInput] = useState<string>(initialWeight);
  const [age, setAge] = useState<string>(client.age != null ? String(client.age) : "");
  const [activity, setActivity] = useState<ActivityLevel | "">(client.activity_level ?? "");
  const [goal, setGoal] = useState<MacroGoal | "">(client.macro_goal ?? "");
  const [deficit, setDeficit] = useState<number>(client.calorie_adjustment ?? 500);

  const [calculated, setCalculated] = useState<MacroSet | null>(client.macros ?? null);
  const initialAdjusted = client.macros_adjusted ?? client.macros ?? null;
  const [adjusted, setAdjusted] = useState<MacroSet | null>(initialAdjusted);
  const [baseline, setBaseline] = useState<MacroSet | null>(initialAdjusted);
  const [reduction, setReduction] = useState<
    { field: "protein_g" | "carbs_g" | "fat_g"; freed: number } | null
  >(null);
  const [selectedOption, setSelectedOption] = useState<
    "protein" | "fat" | "split" | "remove" | null
  >(null);
  const [shared, setShared] = useState<boolean>(!!client.macros_shared);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setWeightInput(initialWeight);
  }, [initialWeight]);

  const heightDisplay = heightCm == null
    ? "not set"
    : heightUnit === "ftin"
      ? `${Math.floor(heightCm / 2.54 / 12)}ft ${Math.round((heightCm / 2.54) % 12)}in`
      : `${heightCm}cm`;
  const genderDisplay = gender ? gender.charAt(0).toUpperCase() + gender.slice(1) : "not set";

  async function persist(patch: Record<string, unknown>) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.from("clients").update(patch as any).eq("id", client.id);
    if (error) throw error;
    onChanged?.(patch as Partial<ClientLike>);
  }

  async function handleWeightUnitChange(u: "kg" | "lbs") {
    // Convert current input to preserve underlying value
    const n = Number(weightInput);
    if (Number.isFinite(n) && n > 0) {
      if (u === "lbs" && weightUnit === "kg") setWeightInput((n * 2.20462).toFixed(1));
      else if (u === "kg" && weightUnit === "lbs") setWeightInput((n / 2.20462).toFixed(1));
    }
    setWeightUnit(u);
    try {
      await persist({ weight_unit: u });
    } catch (e) {
      console.error(e);
    }
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
    const effectiveDeficit = goal === "weight_loss" ? deficit : 0;
    const result = calcMacros(weightKg, heightCm, ageNum, gender, activity, goal, effectiveDeficit);
    setCalculated(result);
    setAdjusted(result);
    setBaseline(result);
    setReduction(null);

    try {
      await persist({
        age: ageNum,
        activity_level: activity,
        macro_goal: goal,
        calorie_adjustment: goal === "weight_loss" ? deficit : null,
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

    if (field === "protein_g" || field === "carbs_g" || field === "fat_g") {
      const baseVal = baseline ? baseline[field] : 0;
      if (baseline && v < baseVal) {
        const perGram = field === "fat_g" ? 9 : 4;
        const freed = round((baseVal - v) * perGram);
        setReduction({ field, freed });
      } else {
        setReduction(null);
      }
    }
  }

  function applyReallocation(option: "protein" | "fat" | "split" | "remove") {
    if (!adjusted || !reduction) return;
    const next = { ...adjusted };
    if (option === "protein") {
      next.protein_g = round(next.protein_g + reduction.freed / 4);
    } else if (option === "fat") {
      next.fat_g = round(next.fat_g + reduction.freed / 9);
    } else if (option === "split") {
      const half = reduction.freed / 2;
      next.protein_g = round(next.protein_g + half / 4);
      next.fat_g = round(next.fat_g + half / 9);
    }
    next.calories = round(next.protein_g * 4 + next.carbs_g * 4 + next.fat_g * 9);
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
      setBaseline(adjusted);
      setReduction(null);
      toast.success("Macros saved");
    } catch (e) {
      toast.error("Failed to save macros");
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    if (calculated) {
      setAdjusted(calculated);
      setReduction(null);
    }
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
            <div className="flex items-center justify-between">
              <Label>Weight</Label>
              <div className="inline-flex rounded border text-xs overflow-hidden">
                <button
                  type="button"
                  onClick={() => handleWeightUnitChange("kg")}
                  className={`px-2 py-0.5 ${weightUnit === "kg" ? "bg-primary text-primary-foreground" : "bg-background"}`}
                >
                  kg
                </button>
                <button
                  type="button"
                  onClick={() => handleWeightUnitChange("lbs")}
                  className={`px-2 py-0.5 ${weightUnit === "lbs" ? "bg-primary text-primary-foreground" : "bg-background"}`}
                >
                  lbs
                </button>
              </div>
            </div>
            <Input
              type="number"
              inputMode="decimal"
              value={weightInput}
              onChange={(e) => setWeightInput(e.target.value)}
              placeholder={isLbs ? "e.g. 165" : "e.g. 75"}
            />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label>Height</Label>
              <div className="inline-flex rounded border text-xs overflow-hidden">
                <button
                  type="button"
                  onClick={() => setHeightUnit("cm")}
                  className={`px-2 py-0.5 ${heightUnit === "cm" ? "bg-primary text-primary-foreground" : "bg-background"}`}
                >
                  cm
                </button>
                <button
                  type="button"
                  onClick={() => setHeightUnit("ftin")}
                  className={`px-2 py-0.5 ${heightUnit === "ftin" ? "bg-primary text-primary-foreground" : "bg-background"}`}
                >
                  ft+in
                </button>
              </div>
            </div>
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
          {goal === "weight_loss" && (
            <div className="space-y-1 sm:col-span-2">
              <Label>Calorie deficit</Label>
              <Select value={String(deficit)} onValueChange={(v) => setDeficit(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="300">300 calories below TDEE</SelectItem>
                  <SelectItem value="400">400 calories below TDEE</SelectItem>
                  <SelectItem value="500">500 calories below TDEE</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
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

          {reduction && (
            <div className="rounded-md border border-dashed p-3 space-y-3 bg-muted/30">
              <p className="text-sm">
                You freed up <span className="font-semibold">{reduction.freed}</span> calories by reducing{" "}
                {reduction.field === "protein_g" ? "protein" : reduction.field === "carbs_g" ? "carbs" : "fat"}.
                Where would you like to reallocate them?
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {([
                  ["protein", "Add to Protein", `+${round(reduction.freed / 4)} g protein`],
                  ["fat", "Add to Fat", `+${round(reduction.freed / 9)} g fat`],
                  ["split", "Split evenly", `+${round((reduction.freed / 2) / 4)} g protein, +${round((reduction.freed / 2) / 9)} g fat`],
                  ["remove", "Remove from total", `−${reduction.freed} kcal`],
                ] as const).map(([key, label, sub]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => applyReallocation(key)}
                    className="text-left rounded border p-2 hover:bg-accent transition-colors"
                  >
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-xs text-muted-foreground">{sub}</p>
                  </button>
                ))}
              </div>
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : "Confirm reallocation"}
              </Button>
            </div>
          )}

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
