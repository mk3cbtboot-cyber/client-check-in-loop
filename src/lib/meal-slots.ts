export type MealSlotKey = "breakfast" | "morning_snack" | "lunch" | "afternoon_snack" | "dinner";

const SLOT_ORDER: Record<number, MealSlotKey[]> = {
  3: ["breakfast", "lunch", "dinner"],
  4: ["breakfast", "lunch", "afternoon_snack", "dinner"],
  5: ["breakfast", "morning_snack", "lunch", "afternoon_snack", "dinner"],
};

const FIVE_MEAL_INDEX: Record<MealSlotKey, number> = {
  breakfast: 1,
  morning_snack: 2,
  lunch: 3,
  afternoon_snack: 4,
  dinner: 5,
};

/**
 * Display label for a meal slot for Custom (own_practice) clients.
 * Returns "Meal N" based on slot position within the client's meals_per_day.
 * If mealsPerDay is omitted (e.g. library-level dropdowns), falls back to
 * the natural 5-meal ordering (breakfast=1 … dinner=5).
 */
export function customSlotLabel(slot: MealSlotKey, mealsPerDay?: number): string {
  if (mealsPerDay && SLOT_ORDER[mealsPerDay]) {
    const idx = SLOT_ORDER[mealsPerDay].indexOf(slot);
    if (idx !== -1) return `Meal ${idx + 1}`;
  }
  return `Meal ${FIVE_MEAL_INDEX[slot]}`;
}
