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
import { getPhaseProgress, progressLabelForCheckin } from "@/lib/progress";

interface Client {
  id: string;
  name: string;
  email: string;
  magic_token: string;
  phase: Phase;
  phase3_additional_foods: string;
  phase3_meat: string;
  phase3_fish: string;
  phase3_vegetables: string;
  phase3_fruit: string;
  phase3_starches: string;
  phase3_bread: string;
  phase3_dairy: string;
  phase3_other: string;
  phase3_mode: "mb_standard" | "practitioner_custom";
  phase3_mb_fish: string;
  phase3_mb_seafood: string;
  phase3_mb_cheese: string;
  phase3_mb_legumes: string;
  phase3_mb_vegetables: string;
  phase3_mb_fat_oil: string;
  show_rules: boolean;
  height_cm: number | null;
  water_today_litres: number | null;
  water_date: string | null;
  phase2_strict_started_at: string | null;
  system_mode: "mb" | "own_practice";
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
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggleExpanded = (id: string) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  // Streak: count of trailing consecutive days (ending today or yesterday) with a check-in
  const computeStreak = (list: CheckIn[]): number => {
    if (!list.length) return 0;
    const dayKeys = new Set(list.map((ci) => new Date(ci.created_at).toISOString().slice(0, 10)));
    let streak = 0;
    const d = new Date();
    // allow starting from today or yesterday
    const todayKey = d.toISOString().slice(0, 10);
    if (!dayKeys.has(todayKey)) d.setUTCDate(d.getUTCDate() - 1);
    while (dayKeys.has(d.toISOString().slice(0, 10))) {
      streak += 1;
      d.setUTCDate(d.getUTCDate() - 1);
    }
    return streak;
  };

  // Need attention: 2+ consecutive expected daily check-ins missed (only for daily-tracked phases)
  const needsAttention = (client: Client, list: CheckIn[]): boolean => {
    const dailyPhase = client.phase === "phase2_strict";
    if (!dailyPhase) return false;
    if (!list.length) {
      // if started 2+ days ago with no check-ins
      if (!client.phase2_strict_started_at) return false;
      const started = new Date(client.phase2_strict_started_at).getTime();
      return (Date.now() - started) / 86_400_000 >= 2;
    }
    const last = new Date(list[0].created_at).getTime();
    const daysSince = Math.floor((Date.now() - last) / 86_400_000);
    return daysSince >= 2;
  };

  const lastWaterDisplay = (list: CheckIn[]): string => {
    const last = list[0];
    if (!last) return "—";
    if (last.water_litres != null) return `${last.water_litres} L`;
    if (last.water_glasses != null) return `${last.water_glasses} glasses`;
    return "—";
  };

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

  const PHASE3_FIELDS = [
    { key: "phase3_meat", label: "Meat" },
    { key: "phase3_fish", label: "Fish" },
    { key: "phase3_vegetables", label: "Vegetables" },
    { key: "phase3_fruit", label: "Fruit" },
    { key: "phase3_starches", label: "Starches" },
    { key: "phase3_bread", label: "Bread" },
    { key: "phase3_dairy", label: "Dairy" },
    { key: "phase3_other", label: "Other" },
  ] as const;

  const PHASE3_MB_FIELDS = [
    { key: "phase3_mb_fish", label: "Fish" },
    { key: "phase3_mb_seafood", label: "Seafood" },
    { key: "phase3_mb_cheese", label: "Cheese" },
    { key: "phase3_mb_legumes", label: "Legumes" },
    { key: "phase3_mb_vegetables", label: "Vegetables" },
    { key: "phase3_mb_fat_oil", label: "Fat / Oil" },
  ] as const;

  type Phase3FieldKey = typeof PHASE3_FIELDS[number]["key"] | typeof PHASE3_MB_FIELDS[number]["key"];

  const setPhase3Field = (clientId: string, field: Phase3FieldKey, value: string) => {
    setClients((cs) => cs.map((c) => (c.id === clientId ? { ...c, [field]: value } : c)));
  };

  const savePhase3Field = async (clientId: string, field: Phase3FieldKey, value: string) => {
    const { error } = await supabase.from("clients").update({ [field]: value } as never).eq("id", clientId);
    if (error) return toast.error("Could not save additional foods");
    toast.success("Additional foods saved");
  };

  const setPhase3Mode = async (clientId: string, mode: "mb_standard" | "practitioner_custom") => {
    setClients((cs) => cs.map((c) => (c.id === clientId ? { ...c, phase3_mode: mode } : c)));
    const { error } = await supabase.from("clients").update({ phase3_mode: mode } as never).eq("id", clientId);
    if (error) return toast.error("Could not update mode");
    toast.success("Mode updated");
  };

  const setSystemMode = async (clientId: string, mode: "mb" | "own_practice") => {
    const prev = clients.find((c) => c.id === clientId)?.system_mode ?? "mb";
    if (prev === mode) return;
    setClients((cs) => cs.map((c) => (c.id === clientId ? { ...c, system_mode: mode } : c)));
    const { error } = await supabase.from("clients").update({ system_mode: mode } as never).eq("id", clientId);
    if (error) {
      setClients((cs) => cs.map((c) => (c.id === clientId ? { ...c, system_mode: prev } : c)));
      return toast.error("Could not update system");
    }
    toast.success(mode === "mb" ? "Switched to Metabolic Balance" : "Switched to Own Practice");
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
        {(() => {
          const total = clients.length;
          let streaks = 0, waterHit = 0, attention = 0;
          clients.forEach((c) => {
            const list = checkIns[c.id] ?? [];
            if (computeStreak(list) >= 7) streaks += 1;
            const today = new Date().toISOString().slice(0, 10);
            if (c.water_date === today && Number(c.water_today_litres ?? 0) >= 2.5) waterHit += 1;
            if (needsAttention(c, list)) attention += 1;
          });
          const stats = [
            { label: "Total Clients", value: total, tone: "" },
            { label: "Active Streaks", value: streaks, tone: "" },
            { label: "Water Target Hit", value: waterHit, tone: "" },
            { label: "Need Attention", value: attention, tone: attention > 0 ? "text-destructive" : "" },
          ];
          return (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {stats.map((s) => (
                <Card key={s.label} className="p-4">
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className={`text-2xl font-semibold ${s.tone}`}>{s.value}</p>
                </Card>
              ))}
            </div>
          );
        })()}

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
              const progress = getPhaseProgress(client.phase, client.phase2_strict_started_at);
              const phaseLabel = PHASE_OPTIONS.find((p) => p.value === client.phase)?.label ?? client.phase;
              const streak = computeStreak(list);
              const alert = needsAttention(client, list);
              const isOpen = !!expanded[client.id];
              return (
                <Card key={client.id} className={`p-4 space-y-3 ${alert ? "border-destructive/60" : ""}`}>
                  <button
                    type="button"
                    onClick={() => toggleExpanded(client.id)}
                    className="w-full text-left"
                    aria-expanded={isOpen}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2 flex-wrap min-w-0">
                        <p className="font-medium truncate">{client.name}</p>
                        <span className="px-2 py-0.5 rounded bg-muted text-xs">{phaseLabel}</span>
                        {progress.label && (
                          <span className="px-2 py-0.5 rounded bg-primary/10 text-primary text-xs font-medium">
                            {progress.label}
                          </span>
                        )}
                        <span className={`px-2 py-0.5 rounded text-xs font-medium inline-flex items-center gap-1 ${alert ? "bg-destructive/10 text-destructive" : "bg-accent text-accent-foreground"}`}>
                          {client.system_mode === "own_practice" ? "Own Practice" : "MB"}
                          {alert && <span aria-label="Needs attention">⚠</span>}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <div
                          role="group"
                          aria-label="System mode"
                          className="inline-flex rounded-md border overflow-hidden"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setSystemMode(client.id, "mb"); }}
                            className={`px-2 py-1 text-xs ${client.system_mode !== "own_practice" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
                            aria-pressed={client.system_mode !== "own_practice"}
                          >
                            MB
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setSystemMode(client.id, "own_practice"); }}
                            className={`px-2 py-1 text-xs border-l ${client.system_mode === "own_practice" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
                            aria-pressed={client.system_mode === "own_practice"}
                          >
                            Own Practice
                          </button>
                        </div>
                        <span>Water: <span className="font-medium text-foreground">{lastWaterDisplay(list)}</span></span>
                        <span>Streak: <span className="font-medium text-foreground">{streak}d</span></span>
                        <span className="text-primary">{isOpen ? "Hide" : "Details"}</span>
                      </div>
                    </div>
                  </button>

                  {isOpen && (
                  <>
                  <div className="border-t pt-3 flex flex-wrap items-center gap-2">
                    <p className="text-sm text-muted-foreground mr-auto">{client.email}</p>
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

                  <div className="border-t pt-3 flex items-end gap-3 flex-wrap">
                    <div className="space-y-1">
                      <Label htmlFor={`h-${client.id}`} className="text-xs">Height (cm)</Label>
                      <Input
                        id={`h-${client.id}`}
                        type="number"
                        step="0.1"
                        className="h-8 w-32"
                        value={client.height_cm ?? ""}
                        onChange={(e) => setHeight(client.id, e.target.value)}
                        onBlur={(e) => saveHeight(client.id, e.target.value)}
                        placeholder="e.g. 168"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">Used for BMI &amp; waist-to-height ratio.</p>
                  </div>

                  {client.phase === "phase3" && (() => {
                    const mode = client.phase3_mode === "mb_standard" ? "mb_standard" : "practitioner_custom";
                    const fields = mode === "mb_standard" ? PHASE3_MB_FIELDS : PHASE3_FIELDS;
                    const heading = mode === "mb_standard"
                      ? "Extended Personal Food List (MB Standard)"
                      : "Extended Food List (Practitioner Custom)";
                    return (
                      <div className="border-t pt-3 space-y-3">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <p className="text-sm font-medium">{heading}</p>
                          <div className="flex gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant={mode === "mb_standard" ? "default" : "outline"}
                              onClick={() => setPhase3Mode(client.id, "mb_standard")}
                            >MB Standard</Button>
                            <Button
                              type="button"
                              size="sm"
                              variant={mode === "practitioner_custom" ? "default" : "outline"}
                              onClick={() => setPhase3Mode(client.id, "practitioner_custom")}
                            >Practitioner Custom</Button>
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground">Enter a comma-separated list per category. Saved when you click outside the field.</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {fields.map((f) => (
                            <div key={f.key} className="space-y-1">
                              <Label htmlFor={`${f.key}-${client.id}`} className="text-xs">{f.label}</Label>
                              <Input
                                id={`${f.key}-${client.id}`}
                                placeholder="e.g. Ribeye Steak, Lamb Chop"
                                value={(client[f.key as keyof Client] as string) ?? ""}
                                onChange={(e) => setPhase3Field(client.id, f.key, e.target.value)}
                                onBlur={(e) => savePhase3Field(client.id, f.key, e.target.value)}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

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
                          const measurementFields: [string, string | null][] = [
                            ["Body Fat", ci.body_fat_pct != null ? `${ci.body_fat_pct}%` : null],
                            ["Waist", ci.waist_cm != null ? `${ci.waist_cm} cm` : null],
                            ["Hip", ci.hip_cm != null ? `${ci.hip_cm} cm` : null],
                            ["Upper Thigh", ci.upper_thigh_cm != null ? `${ci.upper_thigh_cm} cm` : null],
                          ];
                          const hasMeasurements = measurementFields.some(([, v]) => v != null);
                          const heightCm = client.height_cm ? Number(client.height_cm) : null;
                          const bmi = heightCm && ci.weight_kg ? (Number(ci.weight_kg) / Math.pow(heightCm / 100, 2)) : null;
                          const whtr = heightCm && ci.waist_cm ? (Number(ci.waist_cm) / heightCm) : null;
                          return (
                            <li key={ci.id} className="text-sm border rounded p-3 space-y-1">
                              <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                                {(() => {
                                  const lbl = progressLabelForCheckin(client.phase, client.phase2_strict_started_at, ci.created_at, !!ci.is_weekly);
                                  return lbl ? <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] uppercase tracking-wide font-medium">{lbl}</span> : null;
                                })()}
                                {format(new Date(ci.created_at), "PPp")}
                                {ci.is_weekly && <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] uppercase tracking-wide">Weekly</span>}
                              </div>
                              {ci.weight_kg != null && <div>Weight: <span className="font-medium">{ci.weight_kg} kg</span></div>}
                              {ci.feeling != null && <div>Feeling: <span className="font-medium">{ci.feeling}/5</span></div>}
                              {ci.water_litres != null && <div>Water: <span className="font-medium">{ci.water_litres} L</span></div>}
                              {ci.water_litres == null && ci.water_glasses != null && <div>Water: <span className="font-medium">{ci.water_glasses} glasses</span></div>}
                              {hasMeasurements && (
                                <div className="grid grid-cols-2 gap-x-3 pt-1">
                                  {measurementFields.filter(([, v]) => v != null).map(([label, v]) => (
                                    <div key={label} className="text-xs"><span className="text-muted-foreground">{label}:</span> <span className="font-medium">{v}</span></div>
                                  ))}
                                  {bmi != null && <div className="text-xs"><span className="text-muted-foreground">BMI:</span> <span className="font-medium">{bmi.toFixed(1)}</span></div>}
                                  {whtr != null && <div className="text-xs"><span className="text-muted-foreground">WHtR:</span> <span className="font-medium">{whtr.toFixed(2)}</span></div>}
                                </div>
                              )}
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
                  </>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
