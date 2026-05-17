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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { getPhaseProgress, progressLabelForCheckin } from "@/lib/progress";
import { formatDistanceToNow } from "date-fns";
import ClientTrendGraphs from "@/components/ClientTrendGraphs";

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
  meal_streak: number | null;
  avocado_count_week: number | null;
  egg_count_week: number | null;
  created_at: string;
  practitioner_notes: string;
  medical_conditions: string;
  current_medications: string;
  client_goal: string;
  vitamins_supplements: string;
  weight_unit: string;
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
  const [recipes, setRecipes] = useState<Record<string, { id: string; name: string; meal_type: string | null; created_at: string }[]>>({});
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [rawOpen, setRawOpen] = useState<Record<string, boolean>>({});

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

  // Need attention: meal_streak is 0, or today's water intake is below 1.0L
  const needsAttention = (client: Client, _list: CheckIn[]): boolean => {
    const today = new Date().toISOString().slice(0, 10);
    const waterToday = client.water_date === today ? Number(client.water_today_litres ?? 0) : 0;
    return (client.meal_streak ?? 0) === 0 || waterToday < 1.0;
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
    const { data: sessionData } = await supabase.auth.getSession();
    const practitionerEmail = sessionData.session?.user.email?.toLowerCase() ?? "";
    const { data: allRows } = await supabase
      .from("clients")
      .select("*")
      .order("created_at", { ascending: false });
    const clientRows = (allRows ?? []).filter(
      (c) => (c.email ?? "").toLowerCase() !== practitionerEmail,
    );
    setClients(clientRows as Client[]);
    if (clientRows && clientRows.length) {
      const ids = clientRows.map((c) => c.id);
      const [{ data: checkRows }, { data: recipeRows }] = await Promise.all([
        supabase.from("check_ins").select("*").in("client_id", ids).order("created_at", { ascending: false }),
        supabase.from("recipes").select("id, client_id, name, meal_type, created_at").in("client_id", ids).order("created_at", { ascending: false }),
      ]);
      const grouped: Record<string, CheckIn[]> = {};
      (checkRows ?? []).forEach((ci) => { (grouped[ci.client_id] ||= []).push(ci); });
      setCheckIns(grouped);
      const rg: Record<string, { id: string; name: string; meal_type: string | null; created_at: string }[]> = {};
      (recipeRows ?? []).forEach((r: any) => { (rg[r.client_id] ||= []).push(r); });
      setRecipes(rg);
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

  const setClientField = (clientId: string, field: keyof Client, value: string) => {
    setClients((cs) => cs.map((c) => (c.id === clientId ? { ...c, [field]: value } : c)));
  };

  const saveClientField = async (clientId: string, field: keyof Client, value: string) => {
    const { error } = await supabase.from("clients").update({ [field]: value } as never).eq("id", clientId);
    if (error) return toast.error("Could not save");
    toast.success("Saved");
  };

  const saveIntake = async (clientId: string) => {
    const c = clients.find((x) => x.id === clientId);
    if (!c) return;
    const { error } = await supabase.from("clients").update({
      medical_conditions: c.medical_conditions ?? "",
      current_medications: c.current_medications ?? "",
      client_goal: c.client_goal ?? "",
      vitamins_supplements: c.vitamins_supplements ?? "",
    } as never).eq("id", clientId);
    if (error) return toast.error("Could not save");
    toast.success("Medical & Intake saved");
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
                    <div className="space-y-2">
                      {/* Row 1: name + alert + (MB only) phase & progress */}
                      <div className="flex items-center gap-2 flex-wrap min-w-0">
                        <p className="font-medium truncate inline-flex items-center gap-1">
                          {client.name}
                          {alert && <span className="text-destructive" aria-label="Needs attention" title="Needs attention">⚠</span>}
                        </p>
                        {client.system_mode !== "own_practice" && (
                          <>
                            <span className="px-2 py-0.5 rounded bg-muted text-xs">{phaseLabel}</span>
                            {progress.label && (
                              <span className="px-2 py-0.5 rounded bg-primary/10 text-primary text-xs font-medium">
                                {progress.label}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                      {/* Row 2: toggles | water | streak | details */}
                      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
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
                        <span className="text-primary ml-auto">{isOpen ? "Hide" : "Details"}</span>
                      </div>
                    </div>
                  </button>

                  {isOpen && (() => {
                    const todayKey = new Date().toISOString().slice(0, 10);
                    const waterToday = client.water_date === todayKey ? Number(client.water_today_litres ?? 0) : 0;
                    // Water streak: consecutive trailing days with water_litres >= 2.0
                    const waterDays = new Set(
                      list.filter((ci) => (ci.water_litres ?? 0) >= 2.0)
                        .map((ci) => new Date(ci.created_at).toISOString().slice(0, 10))
                    );
                    if (waterToday >= 2.0) waterDays.add(todayKey);
                    let waterStreak = 0;
                    const wd = new Date();
                    if (!waterDays.has(wd.toISOString().slice(0, 10))) wd.setUTCDate(wd.getUTCDate() - 1);
                    while (waterDays.has(wd.toISOString().slice(0, 10))) {
                      waterStreak += 1;
                      wd.setUTCDate(wd.getUTCDate() - 1);
                    }
                    const last = list[0];
                    const clientRecipes = recipes[client.id] ?? [];
                    const lastRecipe = clientRecipes[0];
                    const lastLogged = lastRecipe
                      ? formatDistanceToNow(new Date(lastRecipe.created_at), { addSuffix: true })
                      : "No meals yet";
                    const isOwnPractice = client.system_mode === "own_practice";
                    const mealDays = new Set(clientRecipes.map((r) => new Date(r.created_at).toISOString().slice(0, 10)));
                    let mealStreak = 0;
                    const md = new Date();
                    if (!mealDays.has(md.toISOString().slice(0, 10))) md.setUTCDate(md.getUTCDate() - 1);
                    while (mealDays.has(md.toISOString().slice(0, 10))) {
                      mealStreak += 1;
                      md.setUTCDate(md.getUTCDate() - 1);
                    }
                    const stats = [
                      { label: "Meal Streak", value: `${mealStreak}d` },
                      { label: "Water Streak", value: `${waterStreak}d` },
                      { label: "Water Today", value: `${waterToday.toFixed(1)} L` },
                      ...(isOwnPractice ? [] : [
                        { label: "Avocado / Week", value: `${client.avocado_count_week ?? 0}` },
                        { label: "Eggs / Week", value: `${client.egg_count_week ?? 0} / 5` },
                      ]),
                      { label: "Last Logged", value: lastLogged },
                    ];
                    const lastMealText = (() => {
                      if (!lastRecipe) return "No meals logged yet";
                      const d = new Date(lastRecipe.created_at);
                      const isToday = d.toDateString() === new Date().toDateString();
                      const when = isToday ? `${format(d, "p")} today` : format(d, "p 'on' MMM d");
                      const mt = lastRecipe.meal_type
                        ? lastRecipe.meal_type.charAt(0).toUpperCase() + lastRecipe.meal_type.slice(1)
                        : null;
                      return `${mt ? `${mt} — ` : ""}${lastRecipe.name} — ${when}`;
                    })();
                    return (
                  <div className="border-t pt-3 space-y-4" onClick={(e) => e.stopPropagation()}>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                      {stats.map((s) => (
                        <div key={s.label} className="rounded-md border p-2">
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.label}</p>
                          <p className="text-sm font-semibold truncate">{s.value}</p>
                        </div>
                      ))}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">Last meal:</span> {lastMealText}
                    </p>

                    <Tabs defaultValue="overview" className="w-full">
                      <TabsList className="grid w-full grid-cols-4">
                        <TabsTrigger value="overview">Overview</TabsTrigger>
                        <TabsTrigger value="medical">Medical</TabsTrigger>
                        <TabsTrigger value="progress">Progress</TabsTrigger>
                        <TabsTrigger value="mealplan">Meal Plan</TabsTrigger>
                      </TabsList>

                      <TabsContent value="overview" className="space-y-4 pt-3">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-3">
                            <p className="text-sm text-muted-foreground flex-1 min-w-0 truncate">{client.email}</p>
                            {client.system_mode !== "own_practice" && (
                              <div className="flex items-center gap-2">
                                <Label className="text-xs">Phase</Label>
                                <Select value={client.phase} onValueChange={(v) => setPhase(client.id, v as Phase)}>
                                  <SelectTrigger className="h-8 w-[280px]"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {PHASE_OPTIONS.map((p) => (
                                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            )}
                            <Button variant="outline" size="sm"
                              onClick={() => { navigator.clipboard.writeText(portalLink); toast.success("Portal link copied"); }}>
                              Copy portal link
                            </Button>
                          </div>
                          {client.system_mode !== "own_practice" && (
                            <div className="flex items-center gap-2">
                              <Label htmlFor={`sr-${client.id}`} className="text-xs">Show 8 Rules</Label>
                              <Switch
                                id={`sr-${client.id}`}
                                checked={!!client.show_rules}
                                onCheckedChange={(v) => setShowRules(client.id, v)}
                              />
                            </div>
                          )}
                        </div>

                        <div className="flex items-end gap-3 flex-wrap">
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

                        <div className="space-y-2">
                          <Label htmlFor={`pn-${client.id}`} className="text-sm font-medium">Practitioner Notes</Label>
                          <Textarea
                            id={`pn-${client.id}`}
                            placeholder="Ongoing notes about this client…"
                            value={client.practitioner_notes ?? ""}
                            onChange={(e) => setClientField(client.id, "practitioner_notes", e.target.value)}
                            onBlur={(e) => saveClientField(client.id, "practitioner_notes", e.target.value)}
                            rows={3}
                          />
                        </div>
                      </TabsContent>

                      <TabsContent value="medical" className="space-y-3 pt-3">
                        <p className="text-sm font-medium">Medical &amp; Intake</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {([
                            { key: "medical_conditions", label: "Medical Conditions", placeholder: "e.g. IBS, Type 2 Diabetes, Hypertension" },
                            { key: "current_medications", label: "Current Medications", placeholder: "e.g. Metformin 500mg, Lisinopril 10mg" },
                            { key: "client_goal", label: "Client Goal", placeholder: "e.g. Reverse pre-diabetes, lose 20kg" },
                            { key: "vitamins_supplements", label: "Vitamins & Supplements", placeholder: "e.g. Vitamin D3 2000IU, Magnesium Glycinate 400mg" },
                          ] as const).map((f) => (
                            <div key={f.key} className="space-y-1">
                              <Label htmlFor={`${f.key}-${client.id}`} className="text-xs">{f.label}</Label>
                              <Textarea
                                id={`${f.key}-${client.id}`}
                                placeholder={f.placeholder}
                                value={(client[f.key] as string) ?? ""}
                                onChange={(e) => setClientField(client.id, f.key, e.target.value)}
                                rows={2}
                              />
                            </div>
                          ))}
                        </div>
                        <div className="flex justify-end">
                          <Button size="sm" onClick={() => saveIntake(client.id)}>Save Medical &amp; Intake</Button>
                        </div>
                      </TabsContent>

                      <TabsContent value="progress" className="pt-3 space-y-4">
                        <ClientTrendGraphs checkIns={list as any} weightUnit={client.weight_unit} />
                        <Collapsible open={!!rawOpen[client.id]} onOpenChange={(o) => setRawOpen((s) => ({ ...s, [client.id]: o }))}>
                          <CollapsibleTrigger asChild>
                            <Button variant="outline" size="sm">
                              {rawOpen[client.id] ? "Hide" : "View all"} check-ins ({list.length})
                            </Button>
                          </CollapsibleTrigger>
                          <CollapsibleContent className="pt-3">
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
                          </CollapsibleContent>
                        </Collapsible>
                      </TabsContent>

                      <TabsContent value="mealplan" className="pt-3">
                        {client.system_mode === "own_practice" ? (
                          <p className="text-sm text-muted-foreground">Meal plan tools are MB-specific. Switch this client to MB to manage extended food lists.</p>
                        ) : client.phase !== "phase3" ? (
                          <p className="text-sm text-muted-foreground">Extended food lists are available once the client reaches Phase 3.</p>
                        ) : (() => {
                          const mode = client.phase3_mode === "mb_standard" ? "mb_standard" : "practitioner_custom";
                          const fields = mode === "mb_standard" ? PHASE3_MB_FIELDS : PHASE3_FIELDS;
                          const heading = mode === "mb_standard"
                            ? "Extended Personal Food List (MB Standard)"
                            : "Extended Food List (Practitioner Custom)";
                          return (
                            <div className="space-y-3">
                              <div className="flex items-center justify-between flex-wrap gap-2">
                                <p className="text-sm font-medium">{heading}</p>
                                <div className="flex gap-1">
                                  <Button type="button" size="sm" variant={mode === "mb_standard" ? "default" : "outline"} onClick={() => setPhase3Mode(client.id, "mb_standard")}>MB Standard</Button>
                                  <Button type="button" size="sm" variant={mode === "practitioner_custom" ? "default" : "outline"} onClick={() => setPhase3Mode(client.id, "practitioner_custom")}>Practitioner Custom</Button>
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
                      </TabsContent>
                    </Tabs>
                  </div>
                    );
                  })()}
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
