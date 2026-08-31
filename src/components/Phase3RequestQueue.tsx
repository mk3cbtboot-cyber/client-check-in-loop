import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sprout, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Row {
  id: string;
  food_name: string;
  ai_classification: "whole_food" | "processed_or_meal";
  ai_reason: string | null;
  status: "pending_practitioner_review" | "approved" | "declined" | "needs_resubmit";
  practitioner_note: string | null;
  swap_suggestion: string | null;
  created_at: string;
}

/**
 * Practitioner review queue for Phase 3 food requests. Only whole-food classified
 * requests need a decision; flagged items are shown for context only.
 * Approving appends the food to the client's Phase 3 Additional Foods list.
 */
export function Phase3RequestQueue({
  clientId,
  additionalFoods,
  onAdditionalFoodsChange,
  className = "",
}: {
  clientId: string;
  additionalFoods: string;
  onAdditionalFoodsChange?: (next: string) => void;
}
  & { className?: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [swap, setSwap] = useState<Record<string, string>>({});

  const load = async () => {
    const { data } = await supabase
      .from("phase3_food_requests")
      .select("id, food_name, ai_classification, ai_reason, status, practitioner_note, swap_suggestion, created_at")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false });
    setRows((data ?? []) as Row[]);
    setLoading(false);
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [clientId]);

  const appendToFoodList = async (food: string) => {
    const current = (additionalFoods ?? "").trim();
    const items = current ? current.split(",").map((s) => s.trim()).filter(Boolean) : [];
    if (!items.some((i) => i.toLowerCase() === food.toLowerCase())) items.push(food);
    const next = items.join(", ");
    const { error } = await supabase.from("clients").update({ phase3_additional_foods: next }).eq("id", clientId);
    if (error) throw error;
    onAdditionalFoodsChange?.(next);
  };

  const decide = async (row: Row, status: Row["status"]) => {
    setBusy(row.id);
    try {
      if (status === "approved") await appendToFoodList(row.food_name);
      const { error } = await supabase
        .from("phase3_food_requests")
        .update({
          status,
          reviewed_at: new Date().toISOString(),
          swap_suggestion: swap[row.id]?.trim() || null,
        })
        .eq("id", row.id);
      if (error) throw error;
      toast.success(status === "approved" ? `${row.food_name} added to Additional Foods.` : "Request updated.");
      await load();
    } catch {
      toast.error("Could not update this request.");
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading food requests…</p>;
  }
  if (!rows.length) return null;

  const pending = rows.filter((r) => r.status === "pending_practitioner_review" && r.ai_classification === "whole_food");
  const others = rows.filter((r) => !pending.includes(r));

  return (
    <Card className={`p-4 space-y-3 ${className}`}>
      <div className="flex items-center gap-2">
        <Sprout className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Phase 3 food requests</h3>
        <span className="text-xs text-muted-foreground">{pending.length} awaiting review</span>
      </div>

      {pending.map((r) => (
        <div key={r.id} className="rounded-md border p-3 space-y-2">
          <p className="text-sm font-medium">{r.food_name}</p>
          <Input
            className="h-8 text-xs"
            placeholder="Optional swap suggestion"
            value={swap[r.id] ?? ""}
            onChange={(e) => setSwap((p) => ({ ...p, [r.id]: e.target.value }))}
          />
          <div className="flex gap-2">
            <Button size="sm" disabled={busy === r.id} onClick={() => decide(r, "approved")}>Approve</Button>
            <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => decide(r, "declined")}>Decline</Button>
            <Button size="sm" variant="ghost" disabled={busy === r.id} onClick={() => decide(r, "needs_resubmit")}>Ask to swap</Button>
          </div>
        </div>
      ))}

      {others.length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {others.map((r) => (
            <li key={r.id}>
              <span className="text-foreground">{r.food_name}</span> — {r.status.replace(/_/g, " ")}
              {r.ai_classification === "processed_or_meal" && " (flagged: not a single whole food)"}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default Phase3RequestQueue;
