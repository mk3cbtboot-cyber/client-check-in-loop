import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";

export default function CheckIn() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [valid, setValid] = useState(false);
  const [clientName, setClientName] = useState("");
  const [feeling, setFeeling] = useState<number>(3);
  const [water, setWater] = useState<number>(0);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) return;
    supabase.functions
      .invoke("verify-checkin-token", { body: { token } })
      .then(({ data, error }) => {
        if (error || !data?.valid) {
          setValid(false);
        } else {
          setValid(true);
          setClientName(data.name);
        }
      })
      .finally(() => setLoading(false));
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("submit-checkin", {
        body: { token, feeling, water_glasses: water, notes },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setDone(true);
    } catch (err: any) {
      toast.error(err.message ?? "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <main className="min-h-screen flex items-center justify-center">Loading…</main>;
  }

  if (!valid) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <Card className="p-6 max-w-md text-center">
          <h1 className="text-lg font-semibold mb-2">Invalid link</h1>
          <p className="text-sm text-muted-foreground">This check-in link is not valid. Please contact your nutritionist.</p>
        </Card>
      </main>
    );
  }

  if (done) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <Card className="p-6 max-w-md text-center space-y-2">
          <h1 className="text-lg font-semibold">Thanks!</h1>
          <p className="text-sm text-muted-foreground">Your nutritionist has been notified.</p>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-6 space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Hi {clientName} 👋</h1>
          <p className="text-sm text-muted-foreground">Your daily check-in</p>
        </div>
        <form onSubmit={submit} className="space-y-5">
          <div className="space-y-2">
            <Label>How are you feeling today? ({feeling}/5)</Label>
            <input
              type="range"
              min={1}
              max={5}
              value={feeling}
              onChange={(e) => setFeeling(Number(e.target.value))}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>1 Bad</span><span>5 Great</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="water">How much water did you drink? (glasses)</Label>
            <Input
              id="water"
              type="number"
              min={0}
              max={50}
              value={water}
              onChange={(e) => setWater(Number(e.target.value))}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Any notes for your nutritionist?</Label>
            <Textarea id="notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? "Submitting…" : "Submit check-in"}
          </Button>
        </form>
      </Card>
    </main>
  );
}
