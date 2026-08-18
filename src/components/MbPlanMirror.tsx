import { Card } from "@/components/ui/card";
import type { MealType } from "@/lib/mb-foods";
import type { MbColour, MbSuggestion } from "@/lib/mb-plan";
import { categoryLabel, type MbFoodListMap } from "@/lib/mb-food-list";
import { RUN_DAYS, RUN_MEALS, fmtQty, parseMbRun, resolveRunMeal } from "@/lib/mb-run";

const MEAL_LABEL: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
};
const COLOUR_DOT: Record<MbColour, string> = {
  blue: "bg-sky-500",
  green: "bg-emerald-500",
  orange: "bg-amber-500",
};

interface Props {
  suggestions: MbSuggestion[];
  foodList: MbFoodListMap;
  /** Raw clients.mb_run. */
  run: unknown;
  /** Whether the practitioner has confirmed (published) the plan. */
  confirmed: boolean;
  clientName: string;
}

/**
 * Read-only mirror of the MB client's "My Plan" tab, for the practitioner.
 * Renders exactly what the client sees — pre-lock three-card view, or the
 * locked run with their picks (honouring per-meal colour swaps) — with no
 * selection controls, no dropdowns and no writes. MB clients only.
 */
export function MbPlanMirror({ suggestions, foodList, run: rawRun, confirmed, clientName }: Props) {
  const firstName = clientName.split(" ")[0] || "This client";

  if (!confirmed || suggestions.length === 0) {
    return (
      <div className="rounded-md border p-6 text-center space-y-2">
        <p className="text-sm font-medium">No live plan yet</p>
        <p className="text-xs text-muted-foreground">
          Build and confirm this client's three colour suggestions in <span className="font-medium">MB Plan Setup</span> (Overview tab).
          Once confirmed, their live plan appears here exactly as they see it.
        </p>
      </div>
    );
  }

  const run = parseMbRun(rawRun);

  /* ---------------- not picked yet: three cards ---------------- */
  if (!run.colour) {
    return (
      <Card className="p-4 space-y-4">
        <div>
          <p className="font-medium">{firstName} hasn't chosen a suggestion yet</p>
          <p className="text-sm text-muted-foreground">
            This is their My Plan view: three suggestions to choose from, locking all meals for {RUN_DAYS} days.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {suggestions.map((s) => (
            <div key={s.colour} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className={`h-3 w-3 rounded-full ${COLOUR_DOT[s.colour]}`} aria-hidden />
                <span className="font-medium">{s.label}</span>
              </div>
              {RUN_MEALS.map((m) => (
                <div key={m} className="text-sm">
                  <p className="text-xs uppercase text-muted-foreground">{MEAL_LABEL[m]}</p>
                  <ul className="list-disc pl-5">
                    {(s.meals[m]?.items ?? []).map((it) => (
                      <li key={it.id}>
                        {it.category === "fixed" ? it.label : categoryLabel(it.category)}
                        {fmtQty(it) ? ` · ${fmtQty(it)}` : ""}
                      </li>
                    ))}
                    {(s.meals[m]?.items ?? []).length === 0 && (
                      <li className="text-muted-foreground">Not set</li>
                    )}
                  </ul>
                </div>
              ))}
            </div>
          ))}
        </div>
      </Card>
    );
  }

  /* ---------------- locked run ---------------- */
  const locked = suggestions.find((s) => s.colour === run.colour);

  return (
    <Card className="p-4 space-y-4">
      <div>
        <p className="font-medium flex items-center gap-2">
          <span className={`h-3 w-3 rounded-full ${COLOUR_DOT[run.colour]}`} aria-hidden />
          {locked?.label ?? "Their suggestion"}
        </p>
        <p className="text-sm text-muted-foreground">
          Locked for {RUN_DAYS} days{run.started_on ? ` from ${new Date(run.started_on).toLocaleDateString()}` : ""}.
          Read-only — this is what {firstName} sees. Edit the plan in MB Plan Setup.
        </p>
      </div>

      {RUN_MEALS.map((meal) => {
        const { colour: mealColour, suggestion: s, items, picks, swapped } = resolveRunMeal(run, suggestions, meal);
        return (
          <div key={meal} className="rounded-lg border p-3 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide flex items-center gap-2">
              {MEAL_LABEL[meal]}
              {swapped && (
                <span className="inline-flex items-center gap-1 normal-case text-[11px] font-normal text-muted-foreground">
                  <span className={`h-2 w-2 rounded-full ${COLOUR_DOT[mealColour]}`} aria-hidden />
                  swapped to {s?.label ?? "another suggestion"}
                </span>
              )}
            </p>

            {items.length === 0 && <p className="text-sm text-muted-foreground">Not set.</p>}

            {items.map((it) => {
              if (it.category === "fixed") {
                return (
                  <div key={it.id} className="text-sm">
                    <span className="font-medium">{it.label}</span>
                    {fmtQty(it) ? <span className="text-muted-foreground"> · {fmtQty(it)}</span> : null}
                  </div>
                );
              }
              const picked = picks[it.id] ?? "";
              const hasOptions = ((foodList[it.category] ?? []).length || (it.options ?? []).length) > 0;
              return (
                <div key={it.id} className="text-sm flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{categoryLabel(it.category)}</span>
                  {fmtQty(it) && <span className="text-xs text-muted-foreground">{fmtQty(it)}</span>}
                  {it.optional && <span className="text-xs text-muted-foreground">(optional)</span>}
                  <span aria-hidden className="text-muted-foreground">→</span>
                  {picked ? (
                    <span>{picked}</span>
                  ) : (
                    <span className="text-muted-foreground italic">
                      {hasOptions ? "Not picked yet" : "No approved foods listed for this group"}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </Card>
  );
}

export default MbPlanMirror;
