import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { format } from "date-fns";
import { PHASE_OPTIONS, type Phase } from "@/lib/phases";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

interface Client {
  id: string;
  name: string;
  email: string;
  magic_token: string;
  phase: Phase;
  phase3_additional_foods: string;
  show_rules: boolean;
  height_cm: number | null;
  phase2_strict_started_at: string | null;
  created_at: string;
}

interface CheckIn {
  id: string;
  client_id: string;
  feeling: number | null;
  water_glasses: number | null;
  water_litres: number | null;
  notes: string | null;
  created_at: string;
  weight_kg: number | null;
  general_wellbeing: number | null;
  fatigue: number | null;
  sleep: number | null;
  headache: number | null;
  pain: number | null;
  joint_pain: number | null;
  acid_reflux: number | null;
  digestion: number | null;
  allergy_skin: number | null;
  body_fat_pct: number | null;
  waist_cm: number | null;
  hip_cm: number | null;
  upper_thigh_cm: number | null;
  is_weekly: boolean | null;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [clients, setClients] = useState<Client[]>([]);
  const [checkIns, setCheckIns] = useState<Record<string, CheckIn[]>>({});
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [userEmail, setUserEmail] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        navigate("/auth", { replace: true });
        return;
      }
      setUserEmail(data.session.user.email ?? "");
      load();
    });
  }, [navigate]);

  const load = async () => {
    const { data: clientRows } = await supabase
      .from("clients")
      .select("*")
      .order("created_at", { ascending: false });
    setClients((clientRows ?? []) as Client[]);
    if (clientRows && clientRows.length) {
      const ids = clientRows.map((c) => c.id);
      const { data: checkRows } = await supabase
        .from("check_ins").select("*").in("client_id", ids).order("created_at", { ascending: false });
      const grouped: Record<string, CheckIn[]> = {};
      (checkRows ?? []).forEach((ci) => { (grouped[ci.client_id] ||= []).push(ci); });
      setCheckIns(grouped);
    }
  };

  const addClient = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("invite-client", { body: { name, email } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Client invited — magic link emailed");
      setName(""); setEmail(""); setOpen(false);
      await load();
    } catch (err: any) {
      toast.error(err.message ?? "Failed to invite client");
    } finally { setSubmitting(false); }
  };

  const setPhase = async (clientId: string, phase: Phase) => {
    const current = clients.find((c) => c.id === clientId);
    const updates: { phase: Phase; phase2_strict_started_at?: string } = { phase };
    if (phase === "phase2_strict" && !current?.phase2_strict_started_at) {
      updates.phase2_strict_started_at = new Date().toISOString();
    }
    const { error } = await supabase.from("clients").update(updates).eq("id", clientId);
    if (error) return toast.error("Could not update phase");
    toast.success("Phase updated");
    setClients((cs) => cs.map((c) => (c.id === clientId ? { ...c, phase, phase2_strict_started_at: (updates.phase2_strict_started_at as string) ?? c.phase2_strict_started_at } : c)));
  };

  const setHeight = (clientId: string, value: string) => {
    const num = value === "" ? null : Number(value);
    setClients((cs) => cs.map((c) => (c.id === clientId ? { ...c, height_cm: num } : c)));
  };

  const saveHeight = async (clientId: string, value: string) => {
    const num = value === "" ? null : Number(value);
    const { error } = await supabase.from("clients").update({ height_cm: num }).eq("id", clientId);
    if (error) return toast.error("Could not save height");
    toast.success("Height saved");
  };

  const setPhase3Foods = (clientId: string, value: string) => {
    setClients((cs) => cs.map((c) => (c.id === clientId ? { ...c, phase3_additional_foods: value } : c)));
  };

  const savePhase3Foods = async (clientId: string, value: string) => {
    const { error } = await supabase.from("clients").update({ phase3_additional_foods: value }).eq("id", clientId);
    if (error) return toast.error("Could not save additional foods");
    toast.success("Additional foods saved");
  };

  const setShowRules = async (clientId: string, value: boolean) => {
    setClients((cs) => cs.map((c) => (c.id === clientId ? { ...c, show_rules: value } : c)));
    const { error } = await supabase.from("clients").update({ show_rules: value }).eq("id", clientId);
    if (error) {
      toast.error("Could not update setting");
      setClients((cs) => cs.map((c) => (c.id === clientId ? { ...c, show_rules: !value } : c)));
      return;
    }
    toast.success(value ? "8 Rules visible to client" : "8 Rules hidden from client");
  };

  const logout = async () => {
    await supabase.auth.signOut();
    navigate("/auth", { replace: true });
  };

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b">
        <div className="max-w-5xl mx-auto p-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Tenacia</h1>
            <p className="text-xs text-muted-foreground">{userEmail}</p>
          </div>
          <Button variant="outline" size="sm" onClick={logout}>Log out</Button>
        </div>
      </header>

      <section className="max-w-5xl mx-auto p-4 space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Clients</h2>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button>Add client</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add a new client</DialogTitle></DialogHeader>
              <form onSubmit={addClient} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="cname">Name</Label>
                  <Input id="cname" required value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cemail">Email</Label>
                  <Input id="cemail" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? "Sending invite…" : "Add & send invite"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {clients.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">No clients yet. Add your first one.</Card>
        ) : (
          <div className="space-y-4">
            {clients.map((client) => {
              const list = checkIns[client.id] ?? [];
              const portalLink = `${window.location.origin}/portal/${client.magic_token}`;
              return (
                <Card key={client.id} className="p-4 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{client.name}</p>
                      <p className="text-sm text-muted-foreground">{client.email}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-2">
                        <Label className="text-xs">Phase</Label>
                        <Select value={client.phase} onValueChange={(v) => setPhase(client.id, v as Phase)}>
                          <SelectTrigger className="h-8 w-64"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {PHASE_OPTIONS.map((p) => (
                              <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button variant="outline" size="sm"
                        onClick={() => { navigator.clipboard.writeText(portalLink); toast.success("Portal link copied"); }}>
                        Copy portal link
                      </Button>
                      <div className="flex items-center gap-2">
                        <Label htmlFor={`sr-${client.id}`} className="text-xs">Show 8 Rules</Label>
                        <Switch
                          id={`sr-${client.id}`}
                          checked={!!client.show_rules}
                          onCheckedChange={(v) => setShowRules(client.id, v)}
                        />
                      </div>
                    </div>
                  </div>

                  {client.phase === "phase3" && (
                    <div className="border-t pt-3 space-y-2">
                      <Label htmlFor={`p3-${client.id}`} className="text-xs">Phase 3 Additional Foods</Label>
                      <Textarea
                        id={`p3-${client.id}`}
                        placeholder="e.g. Oats, Sweet potato, Brown rice, Lentils..."
                        value={client.phase3_additional_foods ?? ""}
                        onChange={(e) => setPhase3Foods(client.id, e.target.value)}
                        onBlur={(e) => savePhase3Foods(client.id, e.target.value)}
                        rows={3}
                      />
                      <p className="text-xs text-muted-foreground">Up to 10 foods the client has requested. Saved when you click outside the field.</p>
                    </div>
                  )}

                  <div className="border-t pt-3">
                    <p className="text-sm font-medium mb-2">Check-ins ({list.length})</p>
                    {list.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No submissions yet.</p>
                    ) : (
                      <ul className="space-y-2">
                        {list.map((ci) => {
                          const ratingFields: [string, number | null][] = [
                            ["General Well-Being", ci.general_wellbeing],
                            ["Fatigue", ci.fatigue],
                            ["Sleep", ci.sleep],
                            ["Headache", ci.headache],
                            ["Pain", ci.pain],
                            ["Joint Pain", ci.joint_pain],
                            ["Acid Reflux", ci.acid_reflux],
                            ["Digestion", ci.digestion],
                            ["Allergy / Skin", ci.allergy_skin],
                          ];
                          const hasRatings = ratingFields.some(([, v]) => v != null);
                          return (
                            <li key={ci.id} className="text-sm border rounded p-3 space-y-1">
                              <div className="text-xs text-muted-foreground">{format(new Date(ci.created_at), "PPp")}</div>
                              {ci.weight_kg != null && <div>Weight: <span className="font-medium">{ci.weight_kg} kg</span></div>}
                              {ci.feeling != null && <div>Feeling: <span className="font-medium">{ci.feeling}/5</span></div>}
                              {ci.water_litres != null && <div>Water: <span className="font-medium">{ci.water_litres} L</span></div>}
                              {ci.water_litres == null && ci.water_glasses != null && <div>Water: <span className="font-medium">{ci.water_glasses} glasses</span></div>}
                              {hasRatings && (
                                <div className="grid grid-cols-2 gap-x-3 pt-1">
                                  {ratingFields.filter(([, v]) => v != null).map(([label, v]) => (
                                    <div key={label} className="text-xs"><span className="text-muted-foreground">{label}:</span> <span className="font-medium">{v}/5</span></div>
                                  ))}
                                </div>
                              )}
                              {ci.notes && <div className="pt-1 text-muted-foreground">"{ci.notes}"</div>}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
