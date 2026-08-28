import { Card } from "@/components/ui/card";
import { customSlotLabel } from "@/lib/meal-slots";
import { formatPortionDisplay } from "@/lib/portion";
import {
  type FoodItem,
  type CategoryKey,
  type FoodSelections,
  categorize,
  stripEstimated,
} from "@/lib/food-categories";
...
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
                <p className="text-xs uppercase text-muted-foreground">Approved foods</p>
                <ul className="text-sm space-y-1">
                  {ordered.map(({ cat, food }, i) => (
                    <li key={i}>
                      <span className="font-medium">{stripEstimated(food.name)}</span>
                      {food.portion ? <> · {formatPortionDisplay(food.portion, food.name)}</> : null}
                    </li>
                  ))}
                </ul>

                {veg2Food && (
                  <p className="text-xs text-muted-foreground border-t pt-2">
                    <span className="font-medium text-foreground">Second vegetable: </span>
                    {stripEstimated(veg2Food.name)}
                  </p>
                )}

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
