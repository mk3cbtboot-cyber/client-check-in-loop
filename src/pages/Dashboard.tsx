import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { X, ArrowLeft, Settings as SettingsIcon } from "lucide-react";
import { resolvePhase2Categories, type FoodCategory } from "@/lib/phase2-food-list";
import { TIERS, tierLabel, tierShowsToggle, defaultSystemMode, type PractitionerTier } from "@/lib/tiers";

const DEFAULT_PHASE2_OILS = [
  "Cold-Pressed Olive Oil",
  "Cold-Pressed Flaxseed Oil",
  "Cold-Pressed Coconut Oil",
  "Avocado Oil",
];

function categoriesForPhase(raw: unknown, phase: string): FoodCategory[] {
  const base = resolvePhase2Categories(raw);
  if (phase === "phase2_extended" && !base.some((c) => /oil/i.test(c.title))) {
    return [...base, { title: "Oils (Cold-Pressed)", items: DEFAULT_PHASE2_OILS }];
  }
  return base;
}
import { toast } from "sonner";
import { format } from "date-fns";
import { PHASE_OPTIONS, type Phase } from "@/lib/phases";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { getPhaseProgress, progressLabelForCheckin } from "@/lib/progress";
import { formatDistanceToNow } from "date-fns";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import ClientTrendGraphs from "@/components/ClientTrendGraphs";
import WeeklyLimitsEditor from "@/components/WeeklyLimitsEditor";

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
  show_8_rules: boolean;
  height_cm: number | null;
  gender: "female" | "male" | "unspecified" | null;
  water_today_litres: number | null;
  water_date: string | null;
  phase2_strict_started_at: string | null;
  phase2_strict_mode: "mb_standard" | "practitioner_custom";
  phase2_food_list: unknown;
  weekly_food_limits: Record<string, number>;
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
  archived_at: string | null;
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
  chest_cm: number | null;
  upper_thigh_cm: number | null;
  is_weekly: boolean | null;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { clientId: routeClientId } = useParams<{ clientId: string }>();
  const [clients, setClients] = useState<Client[]>([]);
  const [checkIns, setCheckIns] = useState<Record<string, CheckIn[]>>({});
  const [recipes, setRecipes] = useState<Record<string, { id: string; name: string; meal_type: string | null; created_at: string }[]>>({});
  const [weeklyAcks, setWeeklyAcks] = useState<Record<string, { food_name: string; limit_value: number; acknowledged_at: string }[]>>({});
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [gender, setGender] = useState<"female" | "male" | "unspecified" | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [tier, setTier] = useState<PractitionerTier | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savingTier, setSavingTier] = useState(false);
  const [rawOpen, setRawOpen] = useState<Record<string, boolean>>({});
  const [showArchived, setShowArchived] = useState(false);
  const [archiveConfirmId, setArchiveConfirmId] = useState<string | null>(null);
  const [reactivateConfirmId, setReactivateConfirmId] = useState<string | null>(null);

  const isDetailView = !!routeClientId;

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
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        navigate("/auth", { replace: true });
        return;
      }
      const userId = data.session.user.id;
      const { data: roleRow } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .maybeSingle();
      if (roleRow?.role && roleRow.role !== "practitioner") {
        toast.error("This account is a client account, not a practitioner.");
        await supabase.auth.signOut();
        navigate("/auth", { replace: true });
        return;
      }
      setUserEmail(data.session.user.email ?? "");
      const { data: profile } = await supabase
        .from("profiles")
        .select("practitioner_tier")
        .eq("id", userId)
        .maybeSingle();
      const t = (profile?.practitioner_tier ?? null) as PractitionerTier | null;
      if (!t) {
        navigate("/onboarding/tier", { replace: true });
        return;
      }
      setTier(t);
      load();
    })();
  }, [navigate]);

  const saveTier = async (next: PractitionerTier) => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    setSavingTier(true);
    const { error } = await supabase
      .from("profiles")
      .update({ practitioner_tier: next } as never)
      .eq("id", data.session.user.id);
    setSavingTier(false);
    if (error) return toast.error("Could not update practice type");
    setTier(next);
    setSettingsOpen(false);
    toast.success("Practice type updated");
  };

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
      const monday = (() => {
        const dt = new Date();
        const day = (dt.getUTCDay() + 6) % 7;
        dt.setUTCDate(dt.getUTCDate() - day);
        return dt.toISOString().slice(0, 10);
      })();
      const [{ data: checkRows }, { data: recipeRows }, { data: ackRows }] = await Promise.all([
        supabase.from("check_ins").select("*").in("client_id", ids).order("created_at", { ascending: false }),
        supabase.from("recipes").select("id, client_id, name, meal_type, created_at").in("client_id", ids).order("created_at", { ascending: false }),
        supabase.from("weekly_limit_acknowledgements").select("client_id, food_name, limit_value, acknowledged_at").in("client_id", ids).eq("week_start_date", monday),
      ]);
      const grouped: Record<string, CheckIn[]> = {};
      (checkRows ?? []).forEach((ci) => { (grouped[ci.client_id] ||= []).push(ci); });
      setCheckIns(grouped);
      const rg: Record<string, { id: string; name: string; meal_type: string | null; created_at: string }[]> = {};
      (recipeRows ?? []).forEach((r: any) => { (rg[r.client_id] ||= []).push(r); });
      setRecipes(rg);
      const ag: Record<string, { food_name: string; limit_value: number; acknowledged_at: string }[]> = {};
      (ackRows ?? []).forEach((a: any) => { (ag[a.client_id] ||= []).push(a); });
      setWeeklyAcks(ag);
    }
  };

  const addClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!gender) { toast.error("Please select a gender"); return; }
    setSubmitting(true);
    try {
      if (email.trim().toLowerCase() === userEmail.toLowerCase()) {
        throw new Error("You cannot invite yourself as a client");
      }
      const { data, error } = await supabase.functions.invoke("invite-client", { body: { name, email, gender, system_mode: defaultSystemMode(tier) } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Client invited — magic link emailed");
      setName(""); setEmail(""); setGender(""); setOpen(false);
      await load();
    } catch (err: any) {
      toast.error(err.message ?? "Failed to invite client");
    } finally { setSubmitting(false); }
  };

  const archiveClient = async (clientId: string) => {
    const { error } = await supabase.from("clients").update({ archived_at: new Date().toISOString() } as never).eq("id", clientId);
    if (error) return toast.error("Could not archive client");
    toast.success("Client archived");
    setArchiveConfirmId(null);
    if (isDetailView) navigate("/dashboard");
    await load();
  };

  const reactivateClient = async (clientId: string) => {
    const { error } = await supabase.from("clients").update({ archived_at: null } as never).eq("id", clientId);
    if (error) return toast.error("Could not reactivate client");
    toast.success("Client reactivated");
    setReactivateConfirmId(null);
    await load();
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
    setClients((cs) => cs.map((c) => (c.id === clientId ? {
      ...c,
      phase,
      phase2_strict_started_at: (updates.phase2_strict_started_at as string) ?? c.phase2_strict_started_at,
    } : c)));
  };

  // ----- Phase 2 Strict food list editing -----
  const savePhase2FoodList = async (clientId: string, cats: FoodCategory[] | null) => {
    const prev = clients.find((c) => c.id === clientId)?.phase2_food_list;
    setClients((cs) => cs.map((c) => (c.id === clientId ? { ...c, phase2_food_list: cats } : c)));
    const { error } = await supabase
      .from("clients")
      .update({ phase2_food_list: cats as never } as never)
      .eq("id", clientId);
    if (error) {
      setClients((cs) => cs.map((c) => (c.id === clientId ? { ...c, phase2_food_list: prev } : c)));
      toast.error("Could not save food list");
    }
  };

  const deletePhase2Section = (clientId: string, title: string) => {
    const c = clients.find((cl) => cl.id === clientId);
    if (!c) return;
    const cats = categoriesForPhase(c.phase2_food_list, c.phase).filter((cat) => cat.title !== title);
    void savePhase2FoodList(clientId, cats);
    toast.success(`Removed “${title}”`);
  };

  const deletePhase2Item = (clientId: string, title: string, item: string) => {
    const c = clients.find((cl) => cl.id === clientId);
    if (!c) return;
    const cats = categoriesForPhase(c.phase2_food_list, c.phase).map((cat) =>
      cat.title === title ? { ...cat, items: cat.items.filter((i) => i !== item) } : cat,
    );
    void savePhase2FoodList(clientId, cats);
  };

  const restorePhase2Defaults = (clientId: string) => {
    void savePhase2FoodList(clientId, null);
    toast.success("Food list restored to defaults");
  };

  // ----- Weekly food limits -----
  const saveWeeklyFoodLimits = async (clientId: string, limits: Record<string, number>) => {
    const prev = clients.find((c) => c.id === clientId)?.weekly_food_limits ?? {};
    setClients((cs) => cs.map((c) => (c.id === clientId ? { ...c, weekly_food_limits: limits } : c)));
    const { error } = await supabase
      .from("clients")
      .update({ weekly_food_limits: limits as never } as never)
      .eq("id", clientId);
    if (error) {
      setClients((cs) => cs.map((c) => (c.id === clientId ? { ...c, weekly_food_limits: prev } : c)));
      toast.error("Could not save weekly limits");
    }
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

  const saveGender = async (clientId: string, value: "female" | "male" | "unspecified") => {
    setClients((cs) => cs.map((c) => (c.id === clientId ? { ...c, gender: value } : c)));
    const { error } = await supabase.from("clients").update({ gender: value }).eq("id", clientId);
    if (error) return toast.error("Could not save gender");
    toast.success("Gender saved");
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

  const setPhase2StrictMode = async (clientId: string, mode: "mb_standard" | "practitioner_custom") => {
    const prev = clients.find((c) => c.id === clientId)?.phase2_strict_mode ?? "mb_standard";
    if (prev === mode) return;
    setClients((cs) => cs.map((c) => (c.id === clientId ? { ...c, phase2_strict_mode: mode } : c)));
    const updates: Record<string, unknown> = { phase2_strict_mode: mode };
    const { error } = await supabase.from("clients").update(updates as never).eq("id", clientId);
    if (error) {
      setClients((cs) => cs.map((c) => (c.id === clientId ? { ...c, phase2_strict_mode: prev } : c)));
      return toast.error("Could not update Phase 2 mode");
    }
    toast.success(mode === "mb_standard" ? "Phase 2: MB Standard" : "Phase 2: MB Custom");
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

  const setShow8Rules = async (clientId: string, value: boolean) => {
    setClients((cs) => cs.map((c) => (c.id === clientId ? { ...c, show_8_rules: value } : c)));
    const { error } = await supabase.from("clients").update({ show_8_rules: value }).eq("id", clientId);
    if (error) {
      toast.error("Could not update setting");
      setClients((cs) => cs.map((c) => (c.id === clientId ? { ...c, show_8_rules: !value } : c)));
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
          <div className="min-w-0">
            {isDetailView ? (
              <Link to="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
                <ArrowLeft className="h-4 w-4" />
                Clients
              </Link>
            ) : (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl font-semibold">Tenacia</h1>
                  {tier && (
                    <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-medium">
                      {tierLabel(tier)}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{userEmail}</p>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" aria-label="Settings">
                  <SettingsIcon className="h-4 w-4" />
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Practice type</DialogTitle></DialogHeader>
                <div className="space-y-2">
                  {TIERS.map((t) => {
                    const active = tier === t.value;
                    return (
                      <button
                        key={t.value}
                        type="button"
                        disabled={savingTier}
                        onClick={() => saveTier(t.value)}
                        className={`w-full text-left rounded-md border p-3 transition ${active ? "border-primary ring-2 ring-primary/30" : "hover:border-primary/40"}`}
                      >
                        <div className="flex items-center justify-between">
                          <p className="font-medium">{t.label}</p>
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{t.short}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">{t.description}</p>
                      </button>
                    );
                  })}
                </div>
              </DialogContent>
            </Dialog>
            <Button variant="outline" size="sm" onClick={logout}>Log out</Button>
          </div>
        </div>
      </header>

      <section className="max-w-5xl mx-auto p-4 space-y-6">
        {!isDetailView && (() => {
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

        {!isDetailView && (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-medium">{showArchived ? "Archived Clients" : "Clients"}</h2>
              <div role="group" className="inline-flex rounded-md border overflow-hidden text-xs">
                <button
                  type="button"
                  onClick={() => setShowArchived(false)}
                  className={`px-2.5 py-1 ${!showArchived ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
                  aria-pressed={!showArchived}
                >
                  Active ({clients.filter((c) => !c.archived_at).length})
                </button>
                <button
                  type="button"
                  onClick={() => setShowArchived(true)}
                  className={`px-2.5 py-1 border-l ${showArchived ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
                  aria-pressed={showArchived}
                >
                  Archived ({clients.filter((c) => !!c.archived_at).length})
                </button>
              </div>
            </div>
            {!showArchived && (
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
                    <div className="space-y-2">
                      <Label htmlFor="cgender">Gender</Label>
                      <select
                        id="cgender"
                        required
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        value={gender}
                        onChange={(e) => setGender(e.target.value as "female" | "male" | "unspecified" | "")}
                      >
                        <option value="" disabled>Select…</option>
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                        <option value="unspecified">Prefer not to say</option>
                      </select>
                    </div>
                    <Button type="submit" className="w-full" disabled={submitting}>
                      {submitting ? "Sending invite…" : "Add & send invite"}
                    </Button>
                  </form>
                </DialogContent>
              </Dialog>
            )}
          </div>
        )}

        {(() => {
          const visibleClients = isDetailView
            ? clients.filter((c) => c.id === routeClientId)
            : clients.filter((c) => (showArchived ? !!c.archived_at : !c.archived_at));
          if (visibleClients.length === 0) {
            if (isDetailView) {
              return <Card className="p-8 text-center text-muted-foreground">Loading client…</Card>;
            }
            return (
              <Card className="p-8 text-center text-muted-foreground">
                {showArchived ? "No archived clients." : "No clients yet. Add your first one."}
              </Card>
            );
          }
          return null;
        })()}

        {(() => {
          const visibleClients = isDetailView
            ? clients.filter((c) => c.id === routeClientId)
            : clients.filter((c) => (showArchived ? !!c.archived_at : !c.archived_at));
          if (visibleClients.length === 0) return null;
          return (
          <div className="space-y-4">
            {visibleClients.map((client) => {
              const list = checkIns[client.id] ?? [];
              const portalLink = `${window.location.origin}/portal/${client.magic_token}`;
              const progress = getPhaseProgress(client.phase, client.phase2_strict_started_at);
              const phaseLabel = PHASE_OPTIONS.find((p) => p.value === client.phase)?.label ?? client.phase;
              const streak = computeStreak(list);
              const alert = needsAttention(client, list);
              const isOpen = isDetailView;
              return (
                <Card key={client.id} className={`p-4 space-y-3 ${alert ? "border-destructive/60" : ""}`}>
                  <button
                    type="button"
                    onClick={() => { if (!isDetailView) navigate(`/dashboard/clients/${client.id}`); }}
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
                        {tierShowsToggle(tier) && (
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
                        )}
                        <span>Water: <span className="font-medium text-foreground">{lastWaterDisplay(list)}</span></span>
                        <span>Streak: <span className="font-medium text-foreground">{streak}d</span></span>
                        {!isDetailView && <span className="text-primary ml-auto">Details</span>}
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
                          {client.system_mode !== "own_practice" && client.phase2_strict_mode === "practitioner_custom" && (
                            <div className="flex items-center gap-2">
                              <Label htmlFor={`sr-${client.id}`} className="text-xs">Show 8 Rules</Label>
                              <Switch
                                id={`sr-${client.id}`}
                                checked={!!client.show_8_rules}
                                onCheckedChange={(v) => setShow8Rules(client.id, v)}
                              />
                            </div>
                          )}
                          {client.phase === "phase2_strict" && (() => {
                            const p2Mode = client.phase2_strict_mode === "practitioner_custom" ? "practitioner_custom" : "mb_standard";
                            const isCustom = p2Mode === "practitioner_custom";
                            return (
                              <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                                
                                <div className="flex gap-1">
                                  <Button type="button" size="sm" variant={p2Mode === "mb_standard" ? "default" : "outline"} onClick={() => setPhase2StrictMode(client.id, "mb_standard")}>MB Standard</Button>
                                  <Button type="button" size="sm" variant={p2Mode === "practitioner_custom" ? "default" : "outline"} onClick={() => setPhase2StrictMode(client.id, "practitioner_custom")}>MB Custom</Button>
                                </div>
                                {isCustom && client.phase2_strict_started_at && (
                                  <span className="ml-2">
                                    Strict period: <span className="font-medium text-foreground">14 days</span>
                                  </span>
                                )}
                              </div>
                            );
                          })()}
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
                          <div className="space-y-1">
                            <Label className="text-xs">Gender</Label>
                            <select
                              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                              value={client.gender ?? ""}
                              onChange={(e) => saveGender(client.id, e.target.value as "female" | "male" | "unspecified")}
                            >
                              <option value="" disabled>Select…</option>
                              <option value="female">Female</option>
                              <option value="male">Male</option>
                              <option value="unspecified">Prefer not to say</option>
                            </select>
                          </div>
                        </div>




                        {(() => {
                          const weightEntries = [...list]
                            .filter((ci) => ci.weight_kg != null)
                            .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
                          if (weightEntries.length === 0) return null;
                          const isLbs = client.weight_unit === "lbs";
                          const chartData = weightEntries.map((ci) => ({
                            label: format(new Date(ci.created_at), "MMM d"),
                            weight: isLbs
                              ? Number((Number(ci.weight_kg) * 2.20462).toFixed(1))
                              : Number(Number(ci.weight_kg).toFixed(1)),
                          }));
                          return (
                            <div className="space-y-1">
                              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Weight Trend ({isLbs ? "lbs" : "kg"})</p>
                              <div className="h-36 w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                  <LineChart data={chartData} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                                    <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={40} />
                                    <Tooltip
                                      contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", fontSize: 12 }}
                                      formatter={(value: number) => [`${value} ${isLbs ? "lbs" : "kg"}`, "Weight"]}
                                    />
                                    <Line
                                      type="monotone"
                                      dataKey="weight"
                                      stroke="hsl(var(--primary))"
                                      strokeWidth={2}
                                      dot={{ r: 3, fill: "hsl(var(--primary))" }}
                                      activeDot={{ r: 5 }}
                                      connectNulls
                                    />
                                  </LineChart>
                                </ResponsiveContainer>
                              </div>
                            </div>
                          );
                        })()}

                        {(() => {
                          const WATER_TARGET = 2.5;
                          const MEAL_TARGET = 3;
                          const waterByDay = new Map<string, number>();
                          for (const ci of list) {
                            if (ci.water_litres == null) continue;
                            const k = new Date(ci.created_at).toISOString().slice(0, 10);
                            const v = Number(ci.water_litres);
                            waterByDay.set(k, Math.max(waterByDay.get(k) ?? 0, v));
                          }
                          const recipesList = recipes[client.id] ?? [];
                          const mealsByDay = new Map<string, number>();
                          for (const r of recipesList) {
                            const k = new Date(r.created_at).toISOString().slice(0, 10);
                            mealsByDay.set(k, (mealsByDay.get(k) ?? 0) + 1);
                          }
                          const waterData = [...waterByDay.entries()]
                            .sort(([a], [b]) => a.localeCompare(b))
                            .map(([k, v]) => ({ label: format(new Date(k), "MMM d"), litres: Number(v.toFixed(2)) }));
                          const mealsData = [...mealsByDay.entries()]
                            .sort(([a], [b]) => a.localeCompare(b))
                            .map(([k, v]) => ({ label: format(new Date(k), "MMM d"), meals: Math.min(v, MEAL_TARGET) }));
                          const renderGraph = (
                            title: string,
                            data: any[],
                            dataKey: string,
                            yLabel: string,
                            target: number,
                            yMax?: number,
                          ) => (
                            <div className="space-y-1">
                              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{title}</p>
                              {data.length === 0 ? (
                                <p className="text-xs text-muted-foreground">No data yet</p>
                              ) : (
                                <div className="h-36 w-full">
                                  <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={data} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                                      <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                                      <YAxis
                                        domain={[0, yMax ?? "auto"]}
                                        tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                                        axisLine={false}
                                        tickLine={false}
                                        width={40}
                                      />
                                      <Tooltip
                                        contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", fontSize: 12 }}
                                        formatter={(value: number) => [`${value} ${yLabel}`, title]}
                                      />
                                      <ReferenceLine
                                        y={target}
                                        stroke="hsl(var(--muted-foreground))"
                                        strokeDasharray="4 4"
                                        label={{ value: `Target ${target}`, fontSize: 10, fill: "hsl(var(--muted-foreground))", position: "insideTopRight" }}
                                      />
                                      <Line
                                        type="monotone"
                                        dataKey={dataKey}
                                        stroke="hsl(var(--primary))"
                                        strokeWidth={2}
                                        dot={{ r: 3, fill: "hsl(var(--primary))" }}
                                        activeDot={{ r: 5 }}
                                        connectNulls
                                      />
                                    </LineChart>
                                  </ResponsiveContainer>
                                </div>
                              )}
                            </div>
                          );
                          return (
                            <>
                              {renderGraph("Water Intake (L)", waterData, "litres", "L", WATER_TARGET)}
                              {renderGraph("Meals Logged", mealsData, "meals", "meals", MEAL_TARGET, MEAL_TARGET)}
                            </>
                          );
                        })()}




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
                        <ClientTrendGraphs checkIns={list as any} weightUnit={client.weight_unit} gender={client.gender} />
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
                                  const showHip = client.gender !== "male";
                                  const showChest = client.gender !== "female";
                                  const measurementFields: [string, string | null][] = [
                                    ["Body Fat", ci.body_fat_pct != null ? `${ci.body_fat_pct}%` : null],
                                    ["Waist", ci.waist_cm != null ? `${ci.waist_cm} cm` : null],
                                    ...(showHip ? [["Hip", ci.hip_cm != null ? `${ci.hip_cm} cm` : null] as [string, string | null]] : []),
                                    ...(showChest ? [["Chest", ci.chest_cm != null ? `${ci.chest_cm} cm` : null] as [string, string | null]] : []),
                                    ["Upper Thigh", ci.upper_thigh_cm != null ? `${ci.upper_thigh_cm} cm` : null],
                                  ];
                                  const hasMeasurements = measurementFields.some(([, v]) => v != null);
                                  const heightCm = client.height_cm ? Number(client.height_cm) : null;
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
                        ) : (client.phase === "phase2_strict" || client.phase === "phase2_extended") ? (() => {
                          const cats = categoriesForPhase(client.phase2_food_list, client.phase);
                          const isCustomised = Array.isArray(client.phase2_food_list);
                          const isExtended = client.phase === "phase2_extended";
                          const heading = isExtended
                            ? "Phase 2 Extended — Personal Food List"
                            : "Phase 2 Strict — Personal Food List";
                          const helper = isExtended
                            ? "Same food list as Phase 2 Strict, plus 3 tablespoons of cold-pressed oil daily. Remove sections or items — changes save instantly."
                            : "Remove entire sections or individual items. Changes save instantly and appear in the client's My Plan.";
                          return (
                            <div className="space-y-3">
                              <div className="flex items-center justify-between flex-wrap gap-2">
                                <div>
                                  <p className="text-sm font-medium">{heading}</p>
                                  <p className="text-xs text-muted-foreground">{helper}</p>
                                </div>
                                {isCustomised && (
                                  <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                      <Button type="button" size="sm" variant="outline">Restore Defaults</Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                      <AlertDialogHeader>
                                        <AlertDialogTitle>Restore default food list?</AlertDialogTitle>
                                        <AlertDialogDescription>
                                          This will reset {client.name}'s Phase 2 Strict food list back to the full default list. Any sections or items you've removed will be restored.
                                        </AlertDialogDescription>
                                      </AlertDialogHeader>
                                      <AlertDialogFooter>
                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                        <AlertDialogAction onClick={() => restorePhase2Defaults(client.id)}>Restore Defaults</AlertDialogAction>
                                      </AlertDialogFooter>
                                    </AlertDialogContent>
                                  </AlertDialog>
                                )}
                              </div>
                              {cats.length === 0 ? (
                                <p className="text-sm text-muted-foreground">All sections have been removed. Use "Restore Defaults" to bring the list back.</p>
                              ) : (
                                <div className="space-y-3">
                                  {cats.map((cat) => (
                                    <div key={cat.title} className="border rounded-md p-3 space-y-2">
                                      <div className="flex items-center justify-between gap-2">
                                        <p className="text-sm font-medium">{cat.title}</p>
                                        <AlertDialog>
                                          <AlertDialogTrigger asChild>
                                            <Button type="button" size="sm" variant="ghost" className="text-destructive hover:text-destructive">Delete Section</Button>
                                          </AlertDialogTrigger>
                                          <AlertDialogContent>
                                            <AlertDialogHeader>
                                              <AlertDialogTitle>Remove section?</AlertDialogTitle>
                                              <AlertDialogDescription>
                                                Are you sure you want to remove the entire {cat.title} section from this client's plan?
                                              </AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter>
                                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                                              <AlertDialogAction onClick={() => deletePhase2Section(client.id, cat.title)}>Remove Section</AlertDialogAction>
                                            </AlertDialogFooter>
                                          </AlertDialogContent>
                                        </AlertDialog>
                                      </div>
                                      {cat.items.length === 0 ? (
                                        <p className="text-xs text-muted-foreground">No items left in this section.</p>
                                      ) : (
                                        <div className="flex flex-wrap gap-1.5">
                                          {cat.items.map((item) => (
                                            <span key={item} className="inline-flex items-center gap-1 rounded-full bg-secondary text-secondary-foreground text-xs pl-2.5 pr-1 py-1">
                                              {item}
                                              <button
                                                type="button"
                                                aria-label={`Remove ${item}`}
                                                onClick={() => deletePhase2Item(client.id, cat.title, item)}
                                                className="rounded-full p-0.5 hover:bg-destructive/20 hover:text-destructive transition-colors"
                                              >
                                                <X className="h-3 w-3" />
                                              </button>
                                            </span>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                              <div className="border-t pt-3 space-y-3">
                                <WeeklyLimitsEditor
                                  value={client.weekly_food_limits ?? {}}
                                  onSave={(next) => saveWeeklyFoodLimits(client.id, next)}
                                />
                                {(weeklyAcks[client.id] ?? []).length > 0 && (
                                  <div className="rounded-md border border-amber-500/40 bg-amber-50/50 dark:bg-amber-950/20 p-3 space-y-1">
                                    {(weeklyAcks[client.id] ?? []).map((a) => {
                                      const d = new Date(a.acknowledged_at);
                                      const when = d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
                                      return (
                                        <p key={a.food_name} className="text-xs">
                                          ⚠️ {client.name.split(" ")[0]} acknowledged a weekly {a.food_name.toLowerCase()} limit warning on {when}.
                                        </p>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })() : client.phase === "phase3" ? (() => {
                          const mode = client.phase3_mode === "mb_standard" ? "mb_standard" : "practitioner_custom";
                          const fields = mode === "mb_standard" ? PHASE3_MB_FIELDS : PHASE3_FIELDS;
                          const heading = mode === "mb_standard"
                            ? "Extended Personal Food List (MB Standard)"
                            : "Extended Food List (MB Custom)";
                          return (
                            <div className="space-y-3">
                              <div className="flex items-center justify-between flex-wrap gap-2">
                                <p className="text-sm font-medium">{heading}</p>
                                <div className="flex gap-1">
                                  <Button type="button" size="sm" variant={mode === "mb_standard" ? "default" : "outline"} onClick={() => setPhase3Mode(client.id, "mb_standard")}>MB Standard</Button>
                                  <Button type="button" size="sm" variant={mode === "practitioner_custom" ? "default" : "outline"} onClick={() => setPhase3Mode(client.id, "practitioner_custom")}>MB Custom</Button>
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
                        })() : null}
                      </TabsContent>
                    </Tabs>
                  </div>
                    );
                  })()}
                </Card>
              );
            })}
          </div>
          );
        })()}
      </section>
    </main>
  );
}
