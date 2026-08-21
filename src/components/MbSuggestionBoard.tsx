// Shared read-only presentation for MB colour suggestions.
// Used by the client's My Plan tab and the practitioner's Client Plan tab so
// both mirror the MB Plan Setup layout exactly (three colour columns, plain
// text items). Display only — no writes, no plan editing.

import type { ReactNode } from "react";
import type { MealType } from "@/lib/mb-foods";
import type { MbColour, MbPlanItem, MbSuggestion } from "@/lib/mb-plan";
import { categoryLabel, MB_FOOD_CATEGORIES, type MbFoodListMap } from "@/lib/mb-food-list";
import { fmtQty, RUN_MEALS } from "@/lib/mb-run";
import { foodListTitle } from "@/lib/phases";
import { Card } from "@/components/ui/card";

export const MEAL_LABEL: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
};
export const COLOUR_LABEL: Record<MbColour, string> = {
  blue: "Suggestion 1",
  green: "Suggestion 2",
  orange: "Suggestion 3",
};
export const COLOUR_NAME: Record<MbColour, string> = { blue: "Blue", green: "Green", orange: "Orange" };
export const COLOUR_BAR: Record<MbColour, string> = {
  blue: "bg-sky-500",
  green: "bg-emerald-500",
  orange: "bg-amber-500",
};

/** Plain-text line for one plan item. */
export function itemLine(it: MbPlanItem): string {
  const name = it.category === "fixed" ? it.label : categoryLabel(it.category);
  const qty = fmtQty(it);
  return qty ? `${name} · ${qty}` : name;
}

/** The colour bar + title header used in MB Plan Setup. */
export function MbColourHeader({ colour, subtitle }: { colour: MbColour; subtitle?: string }) {
  return (
    <>
      <div className={`h-4 ${COLOUR_BAR[colour]} w-full`} />
      <div className="flex items-center justify-between gap-2 p-3 pb-0">
        <span className="text-sm font-semibold">{COLOUR_LABEL[colour]}</span>
        <span className="text-xs text-muted-foreground">{subtitle ?? COLOUR_NAME[colour]}</span>
      </div>
    </>
  );
}

/** One read-only suggestion column: all three meals, plain text items. */
export function MbSuggestionCard({
  suggestion,
  onClick,
  footer,
}: {
  suggestion: MbSuggestion;
  onClick?: () => void;
  footer?: ReactNode;
}) {
  const meals = (
    <div className="p-3 pt-3 grid gap-3 h-full content-start">
      {RUN_MEALS.map((meal) => {
        const items = suggestion.meals?.[meal]?.items ?? [];
        return (
          <div key={meal} className="rounded-md border p-2 space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide">{MEAL_LABEL[meal]}</p>
            {items.length === 0 ? (
              <p className="text-xs text-muted-foreground">Not set.</p>
            ) : (
              <ul className="text-sm space-y-0.5">
                {items.map((it) => (
                  <li key={it.id}>
                    {itemLine(it)}
                    {it.optional && <span className="text-xs text-muted-foreground"> (optional)</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      {footer}
    </div>
  );

  return (
    <div className="rounded-lg border overflow-hidden hover:border-primary hover:bg-primary/5 transition-colors">
      <MbColourHeader colour={suggestion.colour} />
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className="w-full h-full text-left"
        >
          {meals}
        </button>
      ) : (
        <div className="w-full h-full">{meals}</div>
      )}
    </div>
  );
}

/** All three suggestions, side by side, matching the MB Plan Setup grid. */
export function MbSuggestionsBoard({
  suggestions,
  onPick,
}: {
  suggestions: MbSuggestion[];
  onPick?: (colour: MbColour) => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {suggestions.map((s) => (
        <MbSuggestionCard
          key={s.colour}
          suggestion={s}
          onClick={onPick ? () => onPick(s.colour) : undefined}
        />
      ))}
    </div>
  );
}

/** Read-only view of the client's personal food list, phase-labelled. */
export function MbFoodListReadonly({
  foodList,
  phase,
}: {
  foodList: MbFoodListMap;
  phase?: string | null;
}) {
  const title = foodListTitle(phase);
  const cats = MB_FOOD_CATEGORIES.filter((c) => (foodList[c.key] ?? []).length > 0);
  if (cats.length === 0) return null;
  return (
    <div className="space-y-3">
      {title && <p className="font-medium">{title}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {cats.map((c) => (
          <Card key={c.key} className="p-4">
            <p className="font-medium mb-2">{c.label}</p>
            <ul className="text-sm space-y-1 list-disc list-inside text-muted-foreground">
              {(foodList[c.key] ?? []).map((f) => (
                <li key={f}><span className="text-foreground">{f}</span></li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}
