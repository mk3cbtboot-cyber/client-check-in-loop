import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Info, Loader2 } from "lucide-react";
import { parsePlanInstructions } from "@/lib/plan-instructions";

interface Props {
  /** Raw clients.plan_instructions jsonb. */
  instructions: unknown;
  className?: string;
  /** When true, show the acknowledgement button (client portal gate). */
  needsAck?: boolean;
  /** ISO date of the last acknowledgement, if any. */
  ackedAt?: string | null;
  onAcknowledge?: () => void;
  acknowledging?: boolean;
}

/**
 * Read-only "Your plan instructions" card. Free-text guidance from the plan
 * document (and the practitioner). Nothing here is enforced — it is guidance
 * the client reads. Renders nothing when the list is empty.
 */
export function PlanInstructions({
  instructions,
  className = "",
  needsAck,
  ackedAt,
  onAcknowledge,
  acknowledging,
}: Props) {
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
      {needsAck && onAcknowledge && (
        <div className="mt-3 rounded-md border border-primary/40 bg-primary/5 p-3 space-y-2">
          <p className="text-sm">
            {ackedAt
              ? "Your instructions have changed. Please read them again and confirm."
              : "Please confirm you've read these before building your meals."}
          </p>
          <Button size="sm" onClick={onAcknowledge} disabled={acknowledging}>
            {acknowledging && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}
            I've read and understood these instructions
          </Button>
        </div>
      )}
      {!needsAck && ackedAt && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
          Acknowledged on {new Date(ackedAt).toLocaleDateString()}
        </p>
      )}
    </Card>
  );
}

export default PlanInstructions;

