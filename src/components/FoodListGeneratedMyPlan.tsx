import { Card } from "@/components/ui/card";
import { customSlotLabel } from "@/lib/meal-slots";
import { type FoodItem, categorize, type CategoryKey } from "@/components/FoodSelectionPlanSection";

type SlotKey = "breakfast" | "morning_snack" | "lunch" | "afternoon_snack" | "dinner";

const ALL_SLOTS: SlotKey[] = ["breakfast", "morning_snack", "lunch", "afternoon_snack", "dinner"];

const CATEGORY_LABEL: Record<CategoryKey, string> = {
  protein: "Protein",
  carbs: "Carbs",
  veg: "Veg",
  fat: "Fat",
};

function visibleSlotKeys(meals: number): SlotKey[] {
  if (meals === 5) return ["breakfast", "morning_snack", "lunch", "afternoon_snack", "dinner"];
  if (meals === 4) return ["breakfast", "lunch", "afternoon_snack", "dinner"];
  return ["breakfast", "lunch", "dinner"];
}

function stripEstimated(name: string): string {
  return (name ?? "").replace(/\s*\(estimated\)\s*$/i, "").trim();
}

interface Props {
  foodList: Record<string, FoodItem[]>;
  foodListNotes?: Record<string, string>;
  mealsPerDay: number;
}

export default function FoodListGeneratedMyPlan({ foodList, foodListNotes, mealsPerDay }: Props) {
  const slots = ALL_SLOTS.filter((s) => visibleSlotKeys(mealsPerDay).includes(s));
  return (
    <div className="space-y-5">
      <Card className="p-4">
        <p className="text-sm text-muted-foreground">
          Here's your meal plan. Each meal below lists all the foods your practitioner has set for you.
        </p>
      </Card>
      {slots.map((s) => {
        const foods = Array.isArray(foodList?.[s]) ? foodList[s] : [];
        const note = typeof foodListNotes?.[s] === "string" ? foodListNotes![s] : "";
        const ordered: { cat: CategoryKey; food: FoodItem }[] = [];
        for (const cat of ["protein", "carbs", "veg", "fat"] as CategoryKey[]) {
          for (const f of foods) {
            if (categorize(f) === cat) ordered.push({ cat, food: f });
          }
        }
        return (
          <section key={s} className="space-y-3">
            <h2 className="text-lg font-semibold">{customSlotLabel(s, mealsPerDay)}</h2>
            {ordered.length === 0 ? (
              <Card className="p-4">
                <p className="text-sm text-muted-foreground">No foods set for this meal yet.</p>
              </Card>
            ) : (
              <Card className="p-4 space-y-2">
                <ul className="text-sm space-y-1">
                  {ordered.map(({ cat, food }, i) => (
                    <li key={i}>
                      <span className="font-medium">{stripEstimated(food.name)}</span>
                      {food.portion ? <> · {food.portion}</> : null}
                      <span className="text-muted-foreground"> · {CATEGORY_LABEL[cat]}</span>
                    </li>
                  ))}
                </ul>
                {note && (
                  <p className="text-xs text-muted-foreground border-t pt-2">
                    <span className="font-medium text-foreground">Note: </span>{note}
                  </p>
                )}
              </Card>
            )}
          </section>
        );
      })}
    </div>
  );
}
