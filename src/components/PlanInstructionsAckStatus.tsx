import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { parsePlanInstructions, planInstructionsHash } from "@/lib/plan-instructions";

interface Props {
  instructions: unknown;
  ackedHash?: string | null;
  ackedAt?: string | null;
  className?: string;
}

/**
 * Practitioner-facing acknowledgement status for a client's plan instructions.
 * Nothing is shown when the client has no instructions.
 */
export function PlanInstructionsAckStatus({ instructions, ackedHash, ackedAt, className = "" }: Props) {
  const items = parsePlanInstructions(instructions);
  if (!items.length) return null;

  const current = planInstructionsHash(instructions);
  const date = ackedAt ? new Date(ackedAt).toLocaleDateString() : null;

  if (!ackedAt) {
    return (
      <p className={`flex items-center gap-1.5 text-xs text-muted-foreground ${className}`}>
        <Clock className="h-3.5 w-3.5" /> Not yet acknowledged
      </p>
    );
  }
  if (ackedHash === current) {
    return (
      <p className={`flex items-center gap-1.5 text-xs text-muted-foreground ${className}`}>
        <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> Acknowledged on {date}
      </p>
    );
  }
  return (
    <p className={`flex items-center gap-1.5 text-xs text-amber-600 ${className}`}>
      <AlertTriangle className="h-3.5 w-3.5" /> Acknowledged on {date} — instructions changed since,
      re-acknowledgement pending
    </p>
  );
}

export default PlanInstructionsAckStatus;
