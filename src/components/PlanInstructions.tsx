import { Card } from "@/components/ui/card";
import { Info } from "lucide-react";
import { parsePlanInstructions } from "@/lib/plan-instructions";

interface Props {
  /** Raw clients.plan_instructions jsonb. */
  instructions: unknown;
  className?: string;
}

/**
 * Read-only "Your plan instructions" card. Free-text guidance from the plan
 * document (and the practitioner). Nothing here is enforced — it is guidance
 * the client reads. Renders nothing when the list is empty.
 */
export function PlanInstructions({ instructions, className = "" }: Props) {
  const items = parsePlanInstructions(instructions);
  if (!items.length) return null;

  return (
    <Card className={`p-4 ${className}`}>
      <div className="flex items-center gap-2">
        <Info className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Your plan instructions</h3>
      </div>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
        {items.map((i) => (
          <li key={i.id}>
            {i.origin && <span className="font-medium text-foreground">{i.origin}: </span>}
            {i.text}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default PlanInstructions;
