import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertTriangle, CheckCircle2, Clock, Loader2, Sprout, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface Phase3Request {
  id: string;
  food_name: string;
  ai_classification: "whole_food" | "processed_or_meal";
  ai_reason: string | null;
  status: "pending_practitioner_review" | "approved" | "declined" | "needs_resubmit";
  practitioner_note: string | null;
  swap_suggestion: string | null;
  created_at: string;
}

const STATUS_META: Record<Phase3Request["status"], { label: string; icon: typeof Clock; className: string }> = {
  pending_practitioner_review: { label: "Sent to your practitioner for review", icon: Clock, className: "text-muted-foreground" },
  approved: { label: "Approved — added to your food list", icon: CheckCircle2, className: "text-primary" },
  declined: { label: "Not approved for now", icon: XCircle, className: "text-muted-foreground" },
  needs_resubmit: { label: "Please resubmit as a single whole food", icon: AlertTriangle, className: "text-amber-600" },
};

/**
 * Phase 3 "test and assess" food request card. MB clients in Phase 3 can ask to
 * reintroduce up to 10 foods at a time. Every submission is also forwarded to the
 * practitioner as a normal message by the backend.
 */
export function Phase3FoodRequests({ token }: { token: string }) {
  const [requests, setRequests] = useState<Phase3Request[]>([]);
  const [active, setActive] = useState(0);
  const [max, setMax] = useState(10);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [drafts, setDrafts] = useState<string[]>([""]);

  const apply = (data: any) => {
    setRequests((data?.requests ?? []) as Phase3Request[]);
    setActive(Number(data?.active ?? 0));
    setMax(Number(data?.max ?? 10));
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.functions.invoke("phase3-food-requests", { body: { token, action: "list" } });
      if (!cancelled) { apply(data); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const remaining = Math.max(0, max - active);

  const submit = async () => {
    const foods = drafts.map((d) => d.trim()).filter(Boolean);
    if (!foods.length) return;
    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke("phase3-food-requests", {
      body: { token, action: "submit", foods },
    });
    setSubmitting(false);
    if (error || data?.error) {
      toast.error(data?.error === "limit_reached" ? `You already have ${max} active requests.` : "Could not submit your request.");
      return;
    }
    apply(data);
    setDrafts([""]);
    toast.success("Request sent to your practitioner.");
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Sprout className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Request foods to test</h3>
      </div>
      <p className="text-sm text-muted-foreground">
        In Phase 3 you can ask to reintroduce foods using the test and assess method. Submit single whole foods
        (for example salmon, sweet potato, strawberry) — not meals or processed products. You can have up to {max} active
        requests at a time.
      </p>

      {loading ? (
        <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</p>
      ) : (
        <>
          <div className="space-y-2">
            {drafts.map((d, i) => (
              <Input
                key={i}
                value={d}
                maxLength={80}
                placeholder="Food name"
                disabled={remaining === 0}
                onChange={(e) => setDrafts((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
              />
            ))}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={remaining === 0 || drafts.length >= remaining}
                onClick={() => setDrafts((p) => [...p, ""])}
              >
                Add another food
              </Button>
              <Button size="sm" onClick={submit} disabled={submitting || remaining === 0 || !drafts.some((d) => d.trim())}>
                {submitting && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}
                Send request
              </Button>
              <span className="text-xs text-muted-foreground">
                {remaining === 0 ? `You've reached your ${max} active requests.` : `${remaining} of ${max} remaining`}
              </span>
            </div>
          </div>

          {requests.length > 0 && (
            <ul className="space-y-2 pt-1">
              {requests.map((r) => {
                const meta = STATUS_META[r.status];
                const Icon = meta.icon;
                return (
                  <li key={r.id} className="rounded-md border p-2.5">
                    <p className="text-sm font-medium">{r.food_name}</p>
                    <p className={`mt-0.5 flex items-center gap-1.5 text-xs ${meta.className}`}>
                      <Icon className="h-3.5 w-3.5" /> {meta.label}
                    </p>
                    {r.status === "needs_resubmit" && r.ai_reason && (
                      <p className="mt-1 text-xs text-muted-foreground">{r.ai_reason}</p>
                    )}
                    {r.practitioner_note && (
                      <p className="mt-1 text-xs text-muted-foreground">Practitioner: {r.practitioner_note}</p>
                    )}
                    {r.swap_suggestion && (
                      <p className="mt-1 text-xs text-muted-foreground">Suggested swap: {r.swap_suggestion}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}

export default Phase3FoodRequests;
