import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { TIERS, type PractitionerTier } from "@/lib/tiers";

export default function Onboarding() {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);
  const [selected, setSelected] = useState<PractitionerTier | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        navigate("/auth", { replace: true });
        return;
      }
      setUserId(data.session.user.id);
      const { data: profile } = await supabase
        .from("profiles")
        .select("practitioner_tier")
        .eq("id", data.session.user.id)
        .maybeSingle();
      if (profile?.practitioner_tier) {
        navigate("/dashboard", { replace: true });
      }
    })();
  }, [navigate]);

  const save = async () => {
    if (!selected || !userId) return;
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ practitioner_tier: selected } as never)
      .eq("id", userId);
    setSaving(false);
    if (error) return toast.error("Could not save practice type");
    toast.success("Practice type saved");
    navigate("/dashboard", { replace: true });
  };

  return (
    <main className="min-h-screen bg-background p-4 flex items-center justify-center">
      <div className="max-w-4xl w-full space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-semibold">Choose your practice type</h1>
          <p className="text-sm text-muted-foreground">This sets which features and plan formats appear in your dashboard. You can change it later in Settings.</p>
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          {TIERS.map((t) => {
            const active = selected === t.value;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => setSelected(t.value)}
                className="text-left"
              >
                <Card className={`p-5 h-full space-y-3 transition ${active ? "border-primary ring-2 ring-primary/30" : "hover:border-primary/40"}`}>
                  <div className="flex items-center justify-between">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">{t.short}</p>
                    {active && <Check className="h-4 w-4 text-primary" />}
                  </div>
                  <h2 className="font-semibold text-lg">{t.label}</h2>
                  <p className="text-sm text-muted-foreground">{t.description}</p>
                  <ul className="text-sm space-y-1">
                    {t.details.map((d) => (
                      <li key={d} className="flex gap-2"><span className="text-primary">•</span><span>{d}</span></li>
                    ))}
                  </ul>
                </Card>
              </button>
            );
          })}
        </div>
        <div className="flex justify-end">
          <Button onClick={save} disabled={!selected || saving}>
            {saving ? "Saving…" : "Continue"}
          </Button>
        </div>
      </div>
    </main>
  );
}
