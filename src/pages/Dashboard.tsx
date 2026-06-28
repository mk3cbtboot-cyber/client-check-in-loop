import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { X, ArrowLeft, Settings as SettingsIcon, BookOpen, Loader2 } from "lucide-react";
import RecipeLibrary from "@/components/RecipeLibrary";
import { resolvePhase2Categories, type FoodCategory } from "@/lib/phase2-food-list";
import { TIERS, tierLabel, tierShowsToggle, defaultSystemMode, type PractitionerTier } from "@/lib/tiers";
import {
  DAY_KEYS, DAY_LABELS, defaultOfficeHours, normalizeOfficeHours, checkAvailability,
  type OfficeHours, type DayKey,
} from "@/lib/office-hours";


function parseParsedOils(raw: string | null | undefined): string[] {
  return (raw ?? "").split(",").map((x) => x.trim()).filter((x) => x.length > 0);
}

// Phase 2 food groups as parsed from the MB PDF into individual columns.
const PHASE2_PARSED_GROUPS: { title: string; field: string }[] = [
  { title: "Fish", field: "food_fish" },
  { title: "Seafood", field: "food_seafood" },
  { title: "Milk Products", field: "food_milk_products" },
  { title: "Yogurt", field: "food_yogurt" },
  { title: "Nuts", field: "food_nuts" },
  { title: "Meat", field: "food_meat" },
  { title: "Poultry", field: "food_poultry" },
  { title: "Cheese", field: "food_cheese" },
  { title: "Legumes", field: "food_legumes" },
  { title: "Pumpkin Seeds", field: "food_pumpkin_seeds" },
  { title: "Sunflower Seeds", field: "food_sunflower_seeds" },
  { title: "Vegetables", field: "food_vegetables" },
  { title: "Veg./Lettuce", field: "food_veg_lettuce" },
  { title: "Starch", field: "food_starch" },
  { title: "Bread", field: "food_bread" },
  { title: "Fruit", field: "food_fruit" },
];

function categoriesFromParsedFields(client: Record<string, unknown>): FoodCategory[] {
  return PHASE2_PARSED_GROUPS
    .map((g) => ({
      title: g.title,
      items: ((client[g.field] as string) ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    }))
    .filter((g) => g.items.length > 0);
}

function categoriesForPhase(raw: unknown, phase: string, parsedOilsRaw: string | null | undefined, client?: Record<string, unknown>): FoodCategory[] {
  let base = resolvePhase2Categories(raw);
  // Fallback: if the practitioner hasn't customised the list yet but the PDF
  // has been parsed into per-food columns, build the categories from those.
  if (base.length === 0 && client) {
    base = categoriesFromParsedFields(client);
  }
  return base;
}
import { toast } from "sonner";
import { format } from "date-fns";
import { PHASE_OPTIONS, type Phase } from "@/lib/phases";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MbPdfImport } from "@/components/MbPdfImport";
import { MacrosTab } from "@/components/MacrosTab";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { getPhaseProgress, progressLabelForCheckin } from "@/lib/progress";
import { formatDistanceToNow } from "date-fns";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import ClientTrendGraphs from "@/components/ClientTrendGraphs";
import WeeklyLimitsEditor from "@/components/WeeklyLimitsEditor";
import PractitionerMessages from "@/components/PractitionerMessages";
import MealsOverviewSection from "@/components/MealsOverviewSection";
import AppointmentDialog, { type Appointment } from "@/components/AppointmentDialog";
import CustomFoodListEditor from "@/components/CustomFoodListEditor";
import RecipePlanAssignments from "@/components/RecipePlanAssignments";
import FoodListDocImport from "@/components/FoodListDocImport";
import FoodListPlanGenerator from "@/components/FoodListPlanGenerator";
import MacroAllocationSection from "@/components/MacroAllocationSection";
import RecipesDocImport from "@/components/RecipesDocImport";


interface Client {
  id: string;
  name: string;
  email: string;
  magic_token: string;
  mb_pdf_path: string | null;
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
  phase3_mb_meat: string;
  phase3_mb_cheese: string;
  phase3_mb_legumes: string;
  phase3_mb_vegetables: string;
  phase3_mb_veg_lettuce: string;
  phase3_mb_sprouts: string;
  phase3_mb_fat_oil: string;
  show_8_rules: boolean;
  height_cm: number | null;
  gender: "female" | "male" | "unspecified" | null;
  water_today_litres: number | null;
  water_date: string | null;
  phase2_strict_started_at: string | null;
  phase2_strict_mode: "mb_standard" | "practitioner_custom";
  phase2_food_list: unknown;
  food_limits: Record<string, number>;
  food_limit_counts: Record<string, number>;
  system_mode: "mb" | "own_practice";
  client_type: "mb" | "custom";
  plan_format: "food_list" | "recipe" | "food_list_generated";
  batch_cooking_mode: "3-day" | "off";
  meal_streak: number | null;
  created_at: string;
  practitioner_notes: string;
  medical_conditions: string;
  current_medications: string;
  client_goal: string;
  vitamins_supplements: string;
  weight_unit: string;
  archived_at: string | null;
  practitioner_last_read_at: string | null;
  phase4_start_date: string | null;
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
  const [generatingPlans, setGeneratingPlans] = useState<Record<string, boolean>>({});
  const [checkIns, setCheckIns] = useState<Record<string, CheckIn[]>>({});
  const [recipes, setRecipes] = useState<Record<string, { id: string; name: string; meal_type: string | null; created_at: string }[]>>({});
  const [weeklyAcks, setWeeklyAcks] = useState<Record<string, { food_name: string; limit_value: number; acknowledged_at: string }[]>>({});
  const [waterStreaks, setWaterStreaks] = useState<Record<string, number>>({});
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [gender, setGender] = useState<"female" | "male" | "">("");
  const [heightCm, setHeightCm] = useState<string>("");
  const [heightUnit, setHeightUnit] = useState<"cm" | "ftin">("cm");
  const [heightFt, setHeightFt] = useState<string>("");
  const [heightIn, setHeightIn] = useState<string>("");
  const [newClientType, setNewClientType] = useState<"mb" | "custom" | null>(null);
  const [typeFilter, setTypeFilter] = useState<"all" | "mb" | "custom">("all");
  const [submitting, setSubmitting] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [practitionerId, setPractitionerId] = useState<string>("");
  const [appointments, setAppointments] = useState<Record<string, Appointment | null>>({});
  const [apptDialogClientId, setApptDialogClientId] = useState<string | null>(null);
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null);
  const [tier, setTier] = useState<PractitionerTier | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [recipeLibOpen, setRecipeLibOpen] = useState(false);
  const [savingTier, setSavingTier] = useState(false);
  const [rawOpen, setRawOpen] = useState<Record<string, boolean>>({});
  const [showArchived, setShowArchived] = useState(false);
  const [archiveConfirmId, setArchiveConfirmId] = useState<string | null>(null);
  const [reactivateConfirmId, setReactivateConfirmId] = useState<string | null>(null);
  // clientId -> ISO timestamp of latest non-deferred message from client
  const [lastClientMessageAt, setLastClientMessageAt] = useState<Record<string, string>>({});

  // Practitioner availability profile fields
  const [officeHours, setOfficeHours] = useState<Required<OfficeHours>>(() =>
    defaultOfficeHours(typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC"),
  );
  const [outOfOffice, setOutOfOffice] = useState(false);
  const [oooMessage, setOooMessage] = useState("");
  const [oooReturnDate, setOooReturnDate] = useState<string>("");
  const [displayName, setDisplayName] = useState("");
  const [savingDisplayName, setSavingDisplayName] = useState(false);
  const [savingHours, setSavingHours] = useState(false);
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNowTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  const availability = (() => {
    void nowTick;
    return checkAvailability({
      office_hours: officeHours,
      out_of_office: outOfOffice,
      ooo_return_date: oooReturnDate || null,
      timezone: officeHours.tz,
    });
  })();

  // ---- Single ordered load pipeline ----
  // loadSeq makes load() "latest request wins": every call takes a sequence
  // number and any response belonging to a superseded call is discarded
  // instead of overwriting newer state. loadRef always points at the latest
  // render's load() so long-lived closures (auth listener, realtime channel)
  // never run a stale copy. scheduleLoad coalesces bursts of realtime events
  // into a single refetch instead of firing parallel competing fetches.
  const loadSeq = useRef(0);
  const loadRef = useRef<() => Promise<void>>(async () => {});
  const loadDebounce = useRef<number | null>(null);
  const scheduleLoad = () => {
    if (loadDebounce.current != null) window.clearTimeout(loadDebounce.current);
    loadDebounce.current = window.setTimeout(() => {
      loadDebounce.current = null;
      void loadRef.current();
    }, 250);
  };




  const markPractitionerRead = async (clientId: string) => {
    const nowIso = new Date().toISOString();
    setClients((prev) => prev.map((c) => (c.id === clientId ? { ...c, practitioner_last_read_at: nowIso } : c)));
    await supabase.from("clients").update({ practitioner_last_read_at: nowIso } as never).eq("id", clientId);
  };

  const hasUnreadFromClient = (c: Client): boolean => {
    const last = lastClientMessageAt[c.id];
    if (!last) return false;
    const read = c.practitioner_last_read_at;
    if (!read) return true;
    return new Date(last).getTime() > new Date(read).getTime();
  };

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

  const WATER_TARGET = 2.5;
  const computeWaterStreak = (rows: { log_date: string; litres: number }[], todayStr: string): number => {
    const map = new Map(rows.map((r) => [r.log_date, Number(r.litres)]));
    let streak = 0;
    const d = new Date(todayStr + "T00:00:00Z");
    if ((map.get(todayStr) ?? 0) >= WATER_TARGET) streak += 1;
    d.setUTCDate(d.getUTCDate() - 1);
    while (true) {
      const key = d.toISOString().slice(0, 10);
      if ((map.get(key) ?? 0) >= WATER_TARGET) {
        streak += 1;
        d.setUTCDate(d.getUTCDate() - 1);
      } else break;
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
    let cancelled = false;
    const bootstrap = async (userId: string, email: string) => {
      const { data: roleRow } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .maybeSingle();
      if (cancelled) return;
      if (roleRow?.role && roleRow.role !== "practitioner") {
        toast.error("This account is a client account, not a practitioner.");
        await supabase.auth.signOut();
        navigate("/auth", { replace: true });
        return;
      }
      setUserEmail(email);
      setPractitionerId(userId);
      const { data: profile } = await supabase
        .from("profiles")
        .select("practitioner_tier, office_hours, out_of_office, ooo_message, ooo_return_date, timezone, display_name")
        .eq("id", userId)
        .maybeSingle();
      if (cancelled) return;
      const browserTz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";
      setOfficeHours(normalizeOfficeHours((profile as any)?.office_hours, (profile as any)?.timezone || browserTz));
      setOutOfOffice(!!(profile as any)?.out_of_office);
      setOooMessage(((profile as any)?.ooo_message ?? "") as string);
      setOooReturnDate(((profile as any)?.ooo_return_date ?? "") as string);
      setDisplayName(((profile as any)?.display_name ?? "") as string);

      const t = (profile?.practitioner_tier ?? null) as PractitionerTier | null;
      if (!t) {
        navigate("/onboarding/tier", { replace: true });
        return;
      }
      setTier(t);
      void loadRef.current();
    };

    let bootstrapped = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!data.session) {
        navigate("/auth", { replace: true });
        return;
      }
      bootstrapped = true;
      await bootstrap(data.session.user.id, data.session.user.email ?? "");
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (event === "SIGNED_OUT" || !session) {
        navigate("/auth", { replace: true });
        return;
      }
      if (event === "TOKEN_REFRESHED" || event === "SIGNED_IN") {
        // After a refresh or sign-in, re-fetch clients so RLS sees the new token.
        if (!bootstrapped) {
          bootstrapped = true;
          void bootstrap(session.user.id, session.user.email ?? "");
        } else {
          void loadRef.current();
        }
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
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

  const saveDisplayName = async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    setSavingDisplayName(true);
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: displayName.trim() || null } as never)
      .eq("id", data.session.user.id);
    setSavingDisplayName(false);
    if (error) return toast.error("Could not save display name");
    toast.success("Display name saved");
  };



  const saveAvailability = async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    setSavingHours(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        office_hours: officeHours,
        out_of_office: outOfOffice,
        ooo_message: oooMessage,
        ooo_return_date: oooReturnDate || null,
        timezone: officeHours.tz,
      } as never)
      .eq("id", data.session.user.id);
    setSavingHours(false);
    if (error) return toast.error("Could not save availability");
    toast.success("Availability saved");
  };

  const updateDay = (key: DayKey, patch: Partial<{ enabled: boolean; start: string; end: string }>) => {
    setOfficeHours((h) => ({ ...h, days: { ...h.days, [key]: { ...h.days[key], ...patch } } }));
  };


  const load = async () => {
    // Latest-request-wins: take a sequence number and bail out at every commit
    // point if a newer load() has started since. This prevents an older,
    // slower response (e.g. one issued just before a token refresh or a
    // mutation) from landing last and overwriting newer state with a stale
    // snapshot of the client list.
    const seq = ++loadSeq.current;
    const isCurrent = () => seq === loadSeq.current;

    const { data: sessionData } = await supabase.auth.getSession();
    if (!isCurrent()) return;
    if (!sessionData.session) {
      // No session yet (e.g. token refreshing). Don't wipe existing client list.
      return;
    }
    const practitionerEmail = sessionData.session.user.email?.toLowerCase() ?? "";
    const { data: allRows, error } = await supabase
      .from("clients")
      .select("*")
      .order("created_at", { ascending: false });
    if (!isCurrent()) return;
    if (error || allRows == null) {
      // Transient failure / RLS race — keep previous client list rather than blanking it.
      console.warn("Dashboard load(): clients fetch failed, preserving current list", error);
      return;
    }
    const clientRows = allRows.filter(
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
      const [{ data: checkRows }, { data: recipeRows }, { data: ackRows }, { data: waterRows }] = await Promise.all([
        supabase.from("check_ins").select("*").in("client_id", ids).order("created_at", { ascending: false }),
        supabase.from("recipes").select("id, client_id, name, meal_type, created_at").in("client_id", ids).order("created_at", { ascending: false }),
        supabase.from("weekly_limit_acknowledgements").select("client_id, food_name, limit_value, acknowledged_at").in("client_id", ids).eq("week_start_date", monday),
        supabase.from("daily_water_logs").select("client_id, log_date, litres").in("client_id", ids).order("log_date", { ascending: false }).limit(400),
      ]);
      if (!isCurrent()) return;
      const grouped: Record<string, CheckIn[]> = {};
      (checkRows ?? []).forEach((ci) => { (grouped[ci.client_id] ||= []).push(ci); });
      setCheckIns(grouped);
      const rg: Record<string, { id: string; name: string; meal_type: string | null; created_at: string }[]> = {};
      (recipeRows ?? []).forEach((r: any) => { (rg[r.client_id] ||= []).push(r); });
      setRecipes(rg);
      const ag: Record<string, { food_name: string; limit_value: number; acknowledged_at: string }[]> = {};
      (ackRows ?? []).forEach((a: any) => { (ag[a.client_id] ||= []).push(a); });
      setWeeklyAcks(ag);

      const todayStr = new Date().toISOString().slice(0, 10);
      const ws: Record<string, number> = {};
      ids.forEach((id) => {
        const rows = (waterRows ?? []).filter((w: any) => w.client_id === id);
        ws[id] = computeWaterStreak(rows, todayStr);
      });
      setWaterStreaks(ws);

      // All non-attended appointments per client (used to surface upcoming + missed).
      const { data: apptRows } = await supabase
        .from("appointments")
        .select("*")
        .in("client_id", ids)
        .neq("status", "attended")
        .order("scheduled_at", { ascending: true });
      if (!isCurrent()) return;

      const nowMs = Date.now();
      const DAY_MS = 24 * 60 * 60 * 1000;

      // Auto-flag missed (status='scheduled' AND >24h past scheduled_at)
      const toFlagMissed = (apptRows ?? []).filter((a: any) =>
        (a.status ?? "scheduled") === "scheduled" &&
        new Date(a.scheduled_at).getTime() + DAY_MS < nowMs
      );
      for (const a of toFlagMissed) {
        const flaggedAt = new Date().toISOString();
        await supabase
          .from("appointments")
          .update({ status: "missed", missed_flagged_at: flaggedAt } as never)
          .eq("id", a.id);
        a.status = "missed";
        a.missed_flagged_at = flaggedAt;
      }

      // Auto-archive clients whose missed appointment has been unactioned for 7+ days.
      const archiveDueToMissed = new Set<string>();
      (apptRows ?? []).forEach((a: any) => {
        if (a.status === "missed" && a.missed_flagged_at) {
          if (new Date(a.missed_flagged_at).getTime() + 7 * DAY_MS < nowMs) {
            archiveDueToMissed.add(a.client_id);
          }
        }
      });
      // Auto-archive clients 12+ months past phase4_start_date with no action.
      const archiveDueToExpiry = new Set<string>();
      (clientRows ?? []).forEach((c: any) => {
        if (c.archived_at) return;
        if (c.phase !== "phase4" || !c.phase4_start_date) return;
        const start = new Date(c.phase4_start_date as string);
        const expiry = new Date(start);
        expiry.setMonth(expiry.getMonth() + 12);
        if (expiry.getTime() < nowMs) archiveDueToExpiry.add(c.id);
      });
      const toArchive = new Set<string>([...archiveDueToMissed, ...archiveDueToExpiry]);
      if (toArchive.size > 0) {
        const archivedAt = new Date().toISOString();
        await supabase
          .from("clients")
          .update({ archived_at: archivedAt } as never)
          .in("id", Array.from(toArchive))
          .is("archived_at", null);
        (clientRows ?? []).forEach((c: any) => {
          if (toArchive.has(c.id) && !c.archived_at) c.archived_at = archivedAt;
        });
        setClients(clientRows as Client[]);
      }

      // Earliest non-attended appointment per client (may be a missed one in the past).
      const appts: Record<string, Appointment | null> = {};
      ids.forEach((id) => { appts[id] = null; });
      (apptRows ?? []).forEach((a: any) => {
        if (!appts[a.client_id]) appts[a.client_id] = a as Appointment;
      });
      setAppointments(appts);


      // Latest client-sent message per client for unread indicator.
      // Deferred messages (sent while practitioner was off-hours) are excluded
      // until the practitioner is currently available again.
      const msgQuery = supabase
        .from("messages")
        .select("client_id, created_at, deferred")
        .in("client_id", ids)
        .eq("sender", "client")
        .order("created_at", { ascending: false });
      const { data: msgRows } = await msgQuery;
      if (!isCurrent()) return;
      const currentlyAvailable = checkAvailability({
        office_hours: officeHours, out_of_office: outOfOffice,
        ooo_return_date: oooReturnDate || null, timezone: officeHours.tz,
      }).available;
      const latest: Record<string, string> = {};
      (msgRows ?? []).forEach((m: any) => {
        if (!currentlyAvailable && m.deferred) return;
        if (!latest[m.client_id]) latest[m.client_id] = m.created_at;
      });
      setLastClientMessageAt(latest);
    }
  };
  // Keep the ref pointing at the latest render's load so long-lived closures
  // (auth listener, realtime channels) never invoke a stale copy.
  loadRef.current = load;


  // Realtime: new client messages bump the unread indicator
  useEffect(() => {
    const ids = clients.map((c) => c.id);
    if (ids.length === 0) return;
    const channel = supabase
      .channel("dashboard-messages")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const row = payload.new as { client_id: string; sender: string; created_at: string; deferred?: boolean };
          if (row.sender !== "client") return;
          if (!ids.includes(row.client_id)) return;
          // Suppress notification while practitioner is currently out of office / out of hours.
          if (row.deferred && !availability.available) return;
          setLastClientMessageAt((prev) => ({ ...prev, [row.client_id]: row.created_at }));
        },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients.map((c) => c.id).join(","), availability.available]);

  // When the practitioner becomes available again (office hours resume or OOO toggled off),
  // re-load message snapshot so any previously deferred client messages surface as unread.
  useEffect(() => {
    if (availability.available && clients.length > 0) void loadRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availability.available]);

  // Realtime: external changes to the clients table (new invites, edits, archives,
  // restores) propagate without manual refresh.
  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled || !data.session) return;
      const userId = data.session.user.id;
      channel = supabase
        .channel(`dashboard-clients-${userId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "clients", filter: `practitioner_id=eq.${userId}` },
          // Coalesce bursts of realtime events (e.g. portal counters updating)
          // into one debounced refetch instead of N parallel competing fetches.
          () => scheduleLoad(),
        )
        .subscribe((status) => {
          // Once the realtime channel is live, fire one authoritative refetch.
          // This guarantees the same trigger that eventually self-corrects the
          // client list (a clients-table event) runs on first mount, instead of
          // waiting minutes for an organic UPDATE. Without this, an initial
          // load() that races the JWT / loadSeq can be discarded with no
          // follow-up until something else happens to update a client row.
          if (status === "SUBSCRIBED" && !cancelled) {
            void loadRef.current();
          }
        });
    })();
    return () => {
      cancelled = true;
      if (loadDebounce.current != null) {
        window.clearTimeout(loadDebounce.current);
        loadDebounce.current = null;
      }
      if (channel) void supabase.removeChannel(channel);
    };
  }, []);




  const addClient = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (!newClientType) throw new Error("Please choose a client type first");
      if (email.trim().toLowerCase() === userEmail.toLowerCase()) {
        throw new Error("You cannot invite yourself as a client");
      }
      let heightNum: number | null = null;
      if (heightUnit === "cm") {
        const trimmedHeight = heightCm.trim();
        if (trimmedHeight === "") throw new Error("Height is required");
        const n = Number(trimmedHeight);
        if (!Number.isFinite(n) || n <= 0) throw new Error("Please enter a valid height in cm");
        heightNum = n;
      } else {
        const ft = heightFt.trim() === "" ? NaN : Number(heightFt);
        const inch = heightIn.trim() === "" ? 0 : Number(heightIn);
        if (!Number.isFinite(ft) || ft <= 0 || !Number.isFinite(inch) || inch < 0) {
          throw new Error("Please enter a valid height");
        }
        heightNum = Math.round((ft * 12 + inch) * 2.54 * 10) / 10;
      }
      if (!gender) throw new Error("Biological sex is required");
      const system_mode = newClientType === "custom" ? "own_practice" : "mb";
      const body: Record<string, unknown> = { name, email, system_mode, client_type: newClientType, gender, height_cm: heightNum };
      const { data, error } = await supabase.functions.invoke("invite-client", { body });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Client invited — magic link emailed");
      setName(""); setEmail(""); setGender(""); setHeightCm(""); setHeightFt(""); setHeightIn(""); setHeightUnit("cm"); setNewClientType(null); setOpen(false);
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

  const markAppointmentAttended = async (apptId: string, clientId: string) => {
    const nowIso = new Date().toISOString();
    const { error } = await supabase
      .from("appointments")
      .update({ status: "attended", attended_at: nowIso, missed_flagged_at: null } as never)
      .eq("id", apptId);
    if (error) return toast.error("Could not mark as attended");
    toast.success("Appointment marked as attended");
    // Refresh next non-attended appointment for this client
    const { data: nextAppt } = await supabase
      .from("appointments")
      .select("*")
      .eq("client_id", clientId)
      .neq("status", "attended")
      .order("scheduled_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    setAppointments((prev) => ({ ...prev, [clientId]: (nextAppt as Appointment | null) ?? null }));
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
    const updates: { phase: Phase; phase2_strict_started_at?: string; phase4_start_date?: string } = { phase };
    if (phase === "phase2_strict" && !current?.phase2_strict_started_at) {
      updates.phase2_strict_started_at = new Date().toISOString();
    }
    const enteringPhase4 =
      phase === "phase4" && !(current as unknown as { phase4_start_date?: string | null })?.phase4_start_date;
    let phase4StartIso: string | null = null;
    if (enteringPhase4) {
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, "0");
      const dd = String(today.getDate()).padStart(2, "0");
      updates.phase4_start_date = `${yyyy}-${mm}-${dd}`;
      phase4StartIso = today.toISOString();
    }
    const { error } = await supabase.from("clients").update(updates as never).eq("id", clientId);
    if (error) return toast.error("Could not update phase");

    if (enteringPhase4 && phase4StartIso && practitionerId) {
      const base = new Date(phase4StartIso);
      const mkDate = (monthsAhead: number) => {
        const d = new Date(base);
        d.setMonth(d.getMonth() + monthsAhead);
        d.setHours(9, 0, 0, 0);
        return d.toISOString();
      };
      const rows = [
        { client_id: clientId, practitioner_id: practitionerId, title: "3-Month Check-in", scheduled_at: mkDate(3), notes: null },
        { client_id: clientId, practitioner_id: practitionerId, title: "6-Month Check-in", scheduled_at: mkDate(6), notes: null },
        { client_id: clientId, practitioner_id: practitionerId, title: "12-Month Check-in", scheduled_at: mkDate(12), notes: null },
      ];
      const { error: apptErr } = await supabase.from("appointments").insert(rows as never);
      if (apptErr) {
        toast.error("Phase updated, but failed to create Phase 4 check-ins");
      } else {
        toast.success("Phase 4 started — 3 check-ins scheduled");
        // Refresh next upcoming appointment for this client
        const { data: nextAppt } = await supabase
          .from("appointments")
          .select("*")
          .eq("client_id", clientId)
          .gte("scheduled_at", new Date().toISOString())
          .order("scheduled_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        setAppointments((prev) => ({ ...prev, [clientId]: (nextAppt as Appointment | null) ?? prev[clientId] ?? null }));
      }
    } else {
      toast.success("Phase updated");
    }

    setClients((cs) => cs.map((c) => (c.id === clientId ? {
      ...c,
      phase,
      phase2_strict_started_at: (updates.phase2_strict_started_at as string) ?? c.phase2_strict_started_at,
      ...(updates.phase4_start_date ? { phase4_start_date: updates.phase4_start_date } : {}),
    } : c)));
  };

  const setBatchCookingMode = async (clientId: string, mode: "3-day" | "off") => {
    const prev = clients.find((c) => c.id === clientId)?.batch_cooking_mode ?? "3-day";
    setClients((cs) => cs.map((c) => (c.id === clientId ? { ...c, batch_cooking_mode: mode } : c)));
    const { error } = await supabase.from("clients").update({ batch_cooking_mode: mode } as never).eq("id", clientId);
    if (error) {
      setClients((cs) => cs.map((c) => (c.id === clientId ? { ...c, batch_cooking_mode: prev } : c)));
      return toast.error("Could not update batch cooking");
    }
    toast.success("Batch cooking updated");
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
    const cats = categoriesForPhase(c.phase2_food_list, c.phase, c.phase3_mb_fat_oil).filter((cat) => cat.title !== title);
    void savePhase2FoodList(clientId, cats);
    toast.success(`Removed “${title}”`);
  };

  const deletePhase2Item = (clientId: string, title: string, item: string) => {
    const c = clients.find((cl) => cl.id === clientId);
    if (!c) return;
    const cats = categoriesForPhase(c.phase2_food_list, c.phase, c.phase3_mb_fat_oil).map((cat) =>
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
    const prev = clients.find((c) => c.id === clientId)?.food_limits ?? {};
    setClients((cs) => cs.map((c) => (c.id === clientId ? { ...c, food_limits: limits } : c)));
    const { error } = await supabase
      .from("clients")
      .update({ food_limits: limits as never } as never)
      .eq("id", clientId);
    if (error) {
      setClients((cs) => cs.map((c) => (c.id === clientId ? { ...c, food_limits: prev } : c)));
      toast.error("Could not save weekly limits");
    }
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
    const newType = mode === "own_practice" ? "custom" : "mb";
    setClients((cs) => cs.map((c) => (c.id === clientId ? { ...c, system_mode: mode, client_type: newType } : c)));
    const { error } = await supabase.from("clients").update({ system_mode: mode, client_type: newType } as never).eq("id", clientId);
    if (error) {
      const prevType = prev === "own_practice" ? "custom" : "mb";
      setClients((cs) => cs.map((c) => (c.id === clientId ? { ...c, system_mode: prev, client_type: prevType } : c)));
      return toast.error("Could not update system");
    }
    toast.success(mode === "mb" ? "Switched to Metabolic Balance" : "Switched to Custom");
  };

  const setPlanFormat = async (clientId: string, fmt: "food_list" | "recipe" | "food_list_generated") => {
    const prev = clients.find((c) => c.id === clientId)?.plan_format ?? "food_list";
    if (prev === fmt) return;
    const clearFoodList = prev === "food_list_generated" && fmt === "food_list";
    if (clearFoodList) {
      if (!window.confirm("Switching to Meal Plan will clear the generated food list. You'll start with empty meal slots to build manually. Are you sure?")) {
        setClients((cs) => cs.map((c) => (c.id === clientId ? { ...c, plan_format: prev } : c)));
        return;
      }
    }
    setClients((cs) => cs.map((c) => (c.id === clientId ? { ...c, plan_format: fmt, ...(clearFoodList ? { food_list: {} as never } : {}) } : c)));
    const update: Record<string, unknown> = { plan_format: fmt };
    if (clearFoodList) update.food_list = {};
    const { error } = await supabase.from("clients").update(update as never).eq("id", clientId);
    if (error) {
      setClients((cs) => cs.map((c) => (c.id === clientId ? { ...c, plan_format: prev } : c)));
      return toast.error("Could not update plan format");
    }
    const label = fmt === "recipe" ? "Recipe Plan" : fmt === "food_list_generated" ? "Meal Plan Generator" : "Meal Plan";
    toast.success(`Plan format: ${label}`);
  };

  const autoGenerateFoodListPlan = async (
    clientId: string,
    macros: { calories: number; protein_g: number; carbs_g: number; fat_g: number },
  ) => {
    const c = clients.find((x) => x.id === clientId);
    const meals = Number((c as unknown as { meals_per_day?: number } | undefined)?.meals_per_day ?? 3);
    const exclusions = (((c as unknown as { food_exclusions?: string[] | null } | undefined)?.food_exclusions) ?? []) as string[];
    setGeneratingPlans((g) => ({ ...g, [clientId]: true }));
    setClients((cs) => cs.map((x) => (x.id === clientId ? ({ ...x, _activeTab: "mealplan" } as typeof x) : x)));
    try {
      const { data, error } = await supabase.functions.invoke("generate-foodlist-plan", {
        body: { macros, meals_per_day: meals, exclusions, preferences: "" },
      });
      if (error || !data?.ok || !data?.food_list) {
        toast.error(data?.error || "Failed to generate meal plan. Please try again.");
        setClients((cs) => cs.map((x) => (x.id === clientId ? ({ ...x, _activeTab: "macros" } as typeof x) : x)));
        return;
      }
      const { error: saveError } = await supabase
        .from("clients")
        .update({ food_list: data.food_list } as never)
        .eq("id", clientId);
      if (saveError) {
        toast.error("Failed to save generated meal plan");
        setClients((cs) => cs.map((x) => (x.id === clientId ? ({ ...x, _activeTab: "macros" } as typeof x) : x)));
        return;
      }
      setClients((cs) => cs.map((x) => (x.id === clientId ? ({ ...x, food_list: data.food_list } as typeof x) : x)));
      toast.success("Meal plan generated.");
    } catch (e) {
      console.error(e);
      toast.error("Failed to generate meal plan.");
      setClients((cs) => cs.map((x) => (x.id === clientId ? ({ ...x, _activeTab: "macros" } as typeof x) : x)));
    } finally {
      setGeneratingPlans((g) => {
        const n = { ...g };
        delete n[clientId];
        return n;
      });
    }
  };



  const setMealsPerDay = async (clientId: string, next: number) => {
    const c = clients.find((x) => x.id === clientId);
    const prev = Number((c as unknown as { meals_per_day?: number } | undefined)?.meals_per_day ?? 3);
    if (next === prev) return;
    if (next < prev && !window.confirm("Reduce meals per day? Hidden meal slots will be saved but not visible to the client.")) return;
    setClients((cs) => cs.map((x) => (x.id === clientId ? ({ ...x, meals_per_day: next } as typeof x) : x)));
    const { error } = await supabase.from("clients").update({ meals_per_day: next } as never).eq("id", clientId);
    if (error) {
      setClients((cs) => cs.map((x) => (x.id === clientId ? ({ ...x, meals_per_day: prev } as typeof x) : x)));
      return toast.error("Could not update meals per day");
    }
    toast.success(`Meals per day: ${next}`);
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
            {!isDetailView && (
              <Button variant="outline" size="sm" onClick={() => setRecipeLibOpen(true)}>
                <BookOpen className="h-4 w-4" /> Recipe Library
              </Button>
            )}
            <RecipeLibrary open={recipeLibOpen} onOpenChange={setRecipeLibOpen} />
            <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" aria-label="Settings">
                  <SettingsIcon className="h-4 w-4" />
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
                <DialogHeader><DialogTitle>Settings</DialogTitle></DialogHeader>
                <Tabs defaultValue="practice">
                  <TabsList className="w-full grid grid-cols-3">
                    <TabsTrigger value="practice">Practice type</TabsTrigger>
                    <TabsTrigger value="profile">Profile</TabsTrigger>
                    <TabsTrigger value="availability">Availability</TabsTrigger>
                  </TabsList>

                  <TabsContent value="profile" className="space-y-3 pt-3">
                    <div className="space-y-2">
                      <Label htmlFor="dispname">Display name</Label>
                      <Input
                        id="dispname"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="e.g. Cheryl"
                      />
                      <p className="text-[11px] text-muted-foreground">
                        This is the name clients see (e.g. in messages from your AI assistant). If left blank, your first name will be used.
                      </p>
                    </div>
                    <div className="flex justify-end">
                      <Button onClick={saveDisplayName} disabled={savingDisplayName}>
                        {savingDisplayName ? "Saving…" : "Save display name"}
                      </Button>
                    </div>
                  </TabsContent>

                  <TabsContent value="practice" className="space-y-2 pt-3">
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
                  </TabsContent>

                  <TabsContent value="availability" className="space-y-4 pt-3">
                    <div className={`rounded-md border p-3 text-xs ${availability.available ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100" : "border-amber-200 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100"}`}>
                      {availability.available
                        ? "You're currently within office hours — clients get instant notifications."
                        : availability.reason === "out_of_office"
                          ? "You're marked Out of Office. New client messages won't notify you until you return."
                          : "Outside office hours — new client messages will wait until your next available window."}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="tz">Timezone</Label>
                      <Input
                        id="tz"
                        value={officeHours.tz}
                        onChange={(e) => setOfficeHours((h) => ({ ...h, tz: e.target.value }))}
                        placeholder="e.g. Europe/London"
                      />
                      <p className="text-[11px] text-muted-foreground">Office hours are saved in this timezone.</p>
                    </div>

                    <div className="space-y-2">
                      <Label>Office Hours</Label>
                      <div className="space-y-2">
                        {DAY_KEYS.map((k) => {
                          const day = officeHours.days[k];
                          return (
                            <div key={k} className="flex items-center gap-2 rounded-md border p-2">
                              <div className="flex items-center gap-2 w-32">
                                <Switch
                                  checked={day.enabled}
                                  onCheckedChange={(v) => updateDay(k, { enabled: !!v })}
                                  aria-label={`Toggle ${DAY_LABELS[k]}`}
                                />
                                <span className="text-sm font-medium">{DAY_LABELS[k]}</span>
                              </div>
                              <Input
                                type="time"
                                disabled={!day.enabled}
                                value={day.start}
                                onChange={(e) => updateDay(k, { start: e.target.value })}
                                className="w-32"
                              />
                              <span className="text-xs text-muted-foreground">to</span>
                              <Input
                                type="time"
                                disabled={!day.enabled}
                                value={day.end}
                                onChange={(e) => updateDay(k, { end: e.target.value })}
                                className="w-32"
                              />
                              {!day.enabled && <span className="text-xs text-muted-foreground ml-auto">Off</span>}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="space-y-3 rounded-md border p-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <Label htmlFor="ooo">Out of Office</Label>
                          <p className="text-xs text-muted-foreground">Overrides office hours until switched off or the return date is reached.</p>
                        </div>
                        <Switch id="ooo" checked={outOfOffice} onCheckedChange={(v) => setOutOfOffice(!!v)} />
                      </div>
                      {outOfOffice && (
                        <>
                          <div className="space-y-1">
                            <Label htmlFor="ooomsg">Out of office message</Label>
                            <Textarea
                              id="ooomsg"
                              value={oooMessage}
                              onChange={(e) => setOooMessage(e.target.value)}
                              placeholder="Hi — I'm away until Monday and will reply when I'm back."
                              className="min-h-[80px]"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor="ooodate">Return date (optional)</Label>
                            <Input
                              id="ooodate"
                              type="date"
                              value={oooReturnDate}
                              onChange={(e) => setOooReturnDate(e.target.value)}
                            />
                          </div>
                        </>
                      )}
                    </div>

                    <div className="flex justify-end">
                      <Button onClick={saveAvailability} disabled={savingHours}>
                        {savingHours ? "Saving…" : "Save availability"}
                      </Button>
                    </div>

                    <p className="text-[11px] text-muted-foreground">
                      When Practice Better is connected, office hours will sync automatically — no need to maintain them here.
                    </p>
                  </TabsContent>
                </Tabs>
              </DialogContent>

            </Dialog>
            <Button variant="outline" size="sm" onClick={logout}>Log out</Button>
          </div>
        </div>
      </header>

      <section className="max-w-5xl mx-auto p-4 space-y-6">
        {!isDetailView && (() => {
          const activeClients = clients.filter((c) => !c.archived_at);
          const archivedClients = clients.filter((c) => !!c.archived_at);

          // Top-left card filters by selected type tab
          const cardActiveClients = typeFilter === "all"
            ? activeClients
            : typeFilter === "mb"
              ? activeClients.filter((c) => c.client_type === "mb")
              : activeClients.filter((c) => c.client_type === "custom");
          const cardArchivedClients = typeFilter === "all"
            ? archivedClients
            : typeFilter === "mb"
              ? archivedClients.filter((c) => c.client_type === "mb")
              : archivedClients.filter((c) => c.client_type === "custom");

          let streaks = 0, waterHit = 0, attention = 0;
          activeClients.forEach((c) => {
            const list = checkIns[c.id] ?? [];
            const matchesFilter = typeFilter === "all" || (typeFilter === "mb" ? c.client_type === "mb" : c.client_type === "custom");
            if (matchesFilter && computeStreak(list) >= 7) streaks += 1;
            const today = new Date().toISOString().slice(0, 10);
            if (matchesFilter && c.water_date === today && Number(c.water_today_litres ?? 0) >= 2.5) waterHit += 1;
            if (matchesFilter && needsAttention(c, list)) attention += 1;
          });

          // Breakdown for the top-left card
          let cardBreakdown: { label: string; count: number }[] = [];
          if (typeFilter === "mb") {
            const phaseCounts: Record<string, number> = {};
            cardActiveClients.forEach((c) => {
              const label = PHASE_OPTIONS.find((o) => o.value === c.phase)?.label ?? c.phase;
              phaseCounts[label] = (phaseCounts[label] ?? 0) + 1;
            });
            cardBreakdown = Object.entries(phaseCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([label, count]) => ({ label, count }));
          } else if (typeFilter === "custom") {
            const planFormatCounts: Record<string, number> = {};
            cardActiveClients.forEach((c) => {
              const label = c.plan_format === "food_list" ? "Meal Plan" : c.plan_format === "food_list_generated" ? "Meal Plan Generator" : c.plan_format === "recipe" ? "Recipe Plan" : "Not set";
              planFormatCounts[label] = (planFormatCounts[label] ?? 0) + 1;
            });
            cardBreakdown = Object.entries(planFormatCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([label, count]) => ({ label, count }));
          }

          const cardTitle = typeFilter === "all" ? "Total Clients" : typeFilter === "mb" ? "Metabolic Balance Clients" : "Custom Clients";

          return (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">

              <Card className="p-4">
                <p className="text-xs text-muted-foreground mb-2">{cardTitle}</p>
                <div className="flex gap-4 mb-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Active</p>
                    <p className="text-2xl font-semibold">{cardActiveClients.length}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Archived</p>
                    <p className="text-2xl font-semibold">{cardArchivedClients.length}</p>
                  </div>
                </div>
                {cardBreakdown.length > 0 && (
                  <div className="space-y-0.5 border-t pt-2 mt-1">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">
                      {typeFilter === "mb" ? "Phase Breakdown" : "Plan Format"}
                    </p>
                    {cardBreakdown.map(({ label, count }) => (
                      <div key={label} className="flex justify-between text-xs">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="font-medium">{count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
              {(() => {
                const unreadClients = activeClients.filter((c) => {
                  const matchesFilter = typeFilter === "all" || (typeFilter === "mb" ? c.client_type === "mb" : c.client_type === "custom");
                  return matchesFilter && hasUnreadFromClient(c);
                });
                const unreadCount = unreadClients.length;
                const items = [
                  {
                    label: "Messages",
                    value: unreadCount,
                    tone: unreadCount > 0 ? "text-destructive" : "",
                    sub: unreadCount > 0 ? `${unreadCount === 1 ? "client has" : "clients have"} new message${unreadCount === 1 ? "" : "s"}` : "No new messages",
                    onClick: unreadCount > 0 ? () => navigate(`/dashboard/clients/${unreadClients[0].id}`) : undefined,
                  },
                  { label: "Active Streaks", value: streaks, tone: "", sub: undefined, onClick: undefined },
                  { label: "Water Target Hit", value: waterHit, tone: "", sub: undefined, onClick: undefined },
                  { label: "Need Attention", value: attention, tone: attention > 0 ? "text-destructive" : "", sub: undefined, onClick: undefined },
                ];
                return items.map((s) => (
                  <Card
                    key={s.label}
                    onClick={s.onClick}
                    className={`p-4 relative ${s.onClick ? "cursor-pointer hover:border-primary/60 transition-colors" : ""}`}
                  >
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                    <p className={`text-2xl font-semibold ${s.tone}`}>{s.value}</p>
                    {s.sub && <p className="text-[10px] text-muted-foreground mt-1">{s.sub}</p>}
                    {s.label === "Messages" && unreadCount > 0 && (
                      <span aria-label="Unread messages" className="absolute top-2 right-2 h-2.5 w-2.5 rounded-full bg-destructive" />
                    )}
                  </Card>
                ));
              })()}

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
              {!showArchived && (
                <div role="group" aria-label="Client type filter" className="inline-flex rounded-md border overflow-hidden text-xs">
                  {([
                    { v: "all", label: `All (${clients.filter((c) => !c.archived_at).length})` },
                    { v: "mb", label: `MB (${clients.filter((c) => !c.archived_at && c.client_type !== "custom").length})` },
                    { v: "custom", label: `Custom (${clients.filter((c) => !c.archived_at && c.client_type === "custom").length})` },
                  ] as const).map((opt, i) => (
                    <button
                      key={opt.v}
                      type="button"
                      onClick={() => setTypeFilter(opt.v)}
                      className={`px-2.5 py-1 ${i > 0 ? "border-l" : ""} ${typeFilter === opt.v ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
                      aria-pressed={typeFilter === opt.v}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {!showArchived && (
              <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setNewClientType(null); }}>
                <DialogTrigger asChild><Button>Add client</Button></DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Add a new client</DialogTitle></DialogHeader>
                  {!newClientType ? (
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground">Choose the client type to get started.</p>
                      <div className="grid gap-3">
                        <button
                          type="button"
                          onClick={() => setNewClientType("mb")}
                          className="text-left rounded-lg border p-4 hover:border-primary hover:bg-accent transition-colors"
                        >
                          <p className="font-medium">MB</p>
                          <p className="text-xs text-muted-foreground mt-1">Metabolic Balance client. Uses MB food plans and phases.</p>
                        </button>
                        <button
                          type="button"
                          onClick={() => setNewClientType("custom")}
                          className="text-left rounded-lg border p-4 hover:border-primary hover:bg-accent transition-colors"
                        >
                          <p className="font-medium">Custom</p>
                          <p className="text-xs text-muted-foreground mt-1">Your own nutrition protocol. Uses food-list or recipe plans.</p>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <form onSubmit={addClient} className="space-y-4">
                      <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
                        <span className="text-xs">
                          Type: <span className="font-medium">{newClientType === "mb" ? "MB" : "Custom"}</span>
                        </span>
                        <button type="button" className="text-xs text-primary hover:underline" onClick={() => setNewClientType(null)}>
                          Change
                        </button>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="cname">Name</Label>
                        <Input id="cname" required value={name} onChange={(e) => setName(e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="cemail">Email</Label>
                        <Input id="cemail" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="cgender">Biological Sex</Label>
                        <select
                          id="cgender"
                          required
                          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                          value={gender}
                          onChange={(e) => setGender(e.target.value as "female" | "male" | "")}
                        >
                          <option value="">Select…</option>
                          <option value="male">Male</option>
                          <option value="female">Female</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label htmlFor="cheight">Height</Label>
                          <div className="inline-flex rounded-md border border-input p-0.5 text-xs">
                            <button
                              type="button"
                              className={`px-2 py-0.5 rounded ${heightUnit === "cm" ? "bg-primary text-primary-foreground" : ""}`}
                              onClick={() => setHeightUnit("cm")}
                            >cm</button>
                            <button
                              type="button"
                              className={`px-2 py-0.5 rounded ${heightUnit === "ftin" ? "bg-primary text-primary-foreground" : ""}`}
                              onClick={() => setHeightUnit("ftin")}
                            >ft / in</button>
                          </div>
                        </div>
                        {heightUnit === "cm" ? (
                          <Input
                            id="cheight"
                            type="number"
                            step="0.1"
                            min="0"
                            required
                            placeholder="e.g. 175"
                            value={heightCm}
                            onChange={(e) => setHeightCm(e.target.value)}
                          />
                        ) : (
                          <div className="flex gap-2">
                            <div className="flex items-center gap-1 flex-1">
                              <Input
                                id="cheight"
                                type="number"
                                step="1"
                                min="0"
                                required
                                placeholder="5"
                                value={heightFt}
                                onChange={(e) => setHeightFt(e.target.value)}
                              />
                              <span className="text-sm text-muted-foreground">ft</span>
                            </div>
                            <div className="flex items-center gap-1 flex-1">
                              <Input
                                type="number"
                                step="0.1"
                                min="0"
                                max="11.9"
                                placeholder="10"
                                value={heightIn}
                                onChange={(e) => setHeightIn(e.target.value)}
                              />
                              <span className="text-sm text-muted-foreground">in</span>
                            </div>
                          </div>
                        )}
                      </div>
                      <Button type="submit" className="w-full" disabled={submitting}>
                        {submitting ? "Sending invite…" : "Add & send invite"}
                      </Button>
                    </form>
                  )}
                </DialogContent>
              </Dialog>
            )}
          </div>
        )}

        {(() => {
          const sortByName = (a: Client, b: Client) => {
            const aParts = a.name.trim().split(/\s+/);
            const bParts = b.name.trim().split(/\s+/);
            const aLast = aParts.pop() ?? "";
            const bLast = bParts.pop() ?? "";
            const aFirst = aParts.join(" ");
            const bFirst = bParts.join(" ");
            const lastCompare = aLast.localeCompare(bLast);
            if (lastCompare !== 0) return lastCompare;
            return aFirst.localeCompare(bFirst);
          };
          const visibleClients = isDetailView
            ? clients.filter((c) => c.id === routeClientId)
            : clients
                .filter((c) => (showArchived ? !!c.archived_at : !c.archived_at))
                .filter((c) => showArchived || typeFilter === "all" || (typeFilter === "custom" ? c.client_type === "custom" : c.client_type !== "custom"))
                .sort(sortByName);
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
          const sortByName = (a: Client, b: Client) => {
            const aParts = a.name.trim().split(/\s+/);
            const bParts = b.name.trim().split(/\s+/);
            const aLast = aParts.pop() ?? "";
            const bLast = bParts.pop() ?? "";
            const aFirst = aParts.join(" ");
            const bFirst = bParts.join(" ");
            const lastCompare = aLast.localeCompare(bLast);
            if (lastCompare !== 0) return lastCompare;
            return aFirst.localeCompare(bFirst);
          };
          const visibleClients = isDetailView
            ? clients.filter((c) => c.id === routeClientId)
            : clients
                .filter((c) => (showArchived ? !!c.archived_at : !c.archived_at))
                .filter((c) => showArchived || typeFilter === "all" || (typeFilter === "custom" ? c.client_type === "custom" : c.client_type !== "custom"))
                .sort(sortByName);
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
                        {hasUnreadFromClient(client) && (
                          <span
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold"
                            aria-label="New message from client"
                            title="New message from client"
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-destructive-foreground" />
                            New message
                          </span>
                        )}
                        {appointments[client.id]?.status === "missed" && (
                          <span
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold"
                            aria-label="Missed appointment"
                            title="Missed appointment"
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-destructive-foreground" />
                            Missed appointment
                          </span>
                        )}
                        {client.archived_at && (
                          <span className="px-2 py-0.5 rounded bg-muted text-muted-foreground text-xs">Archived</span>
                        )}
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
                      {/* Row 2: toggles | client info | details */}
                      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                        {tierShowsToggle(tier) && (
                          <>
                            {client.client_type === "custom" ? (
                              <span className="px-2 py-1 rounded-md border bg-primary text-primary-foreground text-xs font-medium">
                                Custom
                              </span>
                            ) : (
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
                                  Custom
                                </button>
                              </div>
                            )}
                          </>
                        )}
                        <span className="whitespace-nowrap">
                          {client.email}
                          {" · "}
                          Height: {client.height_cm ? `${client.height_cm}cm` : "not set"}
                          {" · "}
                          Biology: {client.gender === "unspecified" ? "Other" : client.gender ? client.gender.charAt(0).toUpperCase() + client.gender.slice(1) : "not set"}
                        </span>
                        {!isDetailView && (
                          <div className="ml-auto inline-flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                            {client.archived_at ? (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setReactivateConfirmId(client.id); }}
                                className="text-primary hover:underline"
                              >
                                Reactivate
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setArchiveConfirmId(client.id); }}
                                className="text-destructive hover:underline"
                              >
                                Archive
                              </button>
                            )}
                            <span className="text-primary">Details</span>
                          </div>
                        )}
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
                    const foodLimits = (client.food_limits ?? {}) as Record<string, number>;
                    const foodLimitCounts = (client.food_limit_counts ?? {}) as Record<string, number>;
                    const foodLimitCards = isOwnPractice ? [] : Object.entries(foodLimits)
                      .filter(([, lim]) => Number(lim) > 0)
                      .map(([name, lim]) => ({
                        label: `${name.charAt(0).toUpperCase() + name.slice(1)} / Week`,
                        value: client.mb_pdf_path
                          ? `${Number(foodLimitCounts[name] ?? 0)} / ${Number(lim)}`
                          : `${Number(foodLimitCounts[name] ?? 0)}`,
                      }));
                    const stats = [
                      { label: "Meal Streak", value: `${mealStreak}d` },
                      { label: "Water Streak", value: `${waterStreak}d` },
                      { label: "Water Today", value: `${waterToday.toFixed(1)} L` },
                      ...foodLimitCards,
                      { label: "Last Meal Logged", value: lastLogged },
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
                    const upcomingAppt = appointments[client.id] ?? null;
                    return (
                  <div className="border-t pt-3 space-y-4" onClick={(e) => e.stopPropagation()}>
                    {upcomingAppt && (() => {
                      const isMissed = upcomingAppt.status === "missed";
                      return (
                        <div
                          className={`w-full rounded-md border p-3 ${
                            isMissed
                              ? "border-destructive/60 bg-destructive/10"
                              : "border-primary/40 bg-primary/5"
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => { setEditingAppointment(upcomingAppt); setApptDialogClientId(client.id); }}
                            className="w-full text-left"
                          >
                            <div className="flex items-center gap-2">
                              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                {isMissed ? "Missed appointment" : "Next appointment"}
                              </p>
                              {isMissed && (
                                <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground">
                                  Missed
                                </span>
                              )}
                            </div>
                            <p className="text-sm font-medium">
                              {format(new Date(upcomingAppt.scheduled_at), "EEE MMM d")}
                              {" · "}
                              {upcomingAppt.title}
                              {" · "}
                              {format(new Date(upcomingAppt.scheduled_at), "h:mm a")}
                            </p>
                          </button>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {isMissed ? (
                              <>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => { setEditingAppointment(upcomingAppt); setApptDialogClientId(client.id); }}
                                >
                                  Reschedule
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => archiveClient(client.id)}
                                >
                                  Archive client
                                </Button>
                              </>
                            ) : (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => markAppointmentAttended(upcomingAppt.id, client.id)}
                              >
                                Mark as attended
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                      {stats.map((s) => (
                        <div key={s.label} className="rounded-md border p-2">
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.label}</p>
                          <p className="text-sm font-semibold truncate">{s.value}</p>
                        </div>
                      ))}
                    </div>


                    <Tabs defaultValue="overview" className="w-full" value={(client as unknown as { _activeTab?: string })._activeTab ?? undefined} onValueChange={(v) => setClients((cs) => cs.map((x) => (x.id === client.id ? ({ ...x, _activeTab: v } as typeof x) : x)))}>
                      <TabsList className="grid w-full grid-cols-6">
                        <TabsTrigger value="overview">Overview</TabsTrigger>
                        <TabsTrigger value="medical">Medical</TabsTrigger>
                        <TabsTrigger value="progress">Progress</TabsTrigger>
                        <TabsTrigger value="macros">Macros / MPG</TabsTrigger>
                        <TabsTrigger value="mealplan">Meal Plan</TabsTrigger>
                        <TabsTrigger value="messages" className="relative">
                          Messages
                          {hasUnreadFromClient(client) && (
                            <span aria-label="Unread message" className="absolute top-1 right-1 h-2 w-2 rounded-full bg-destructive" />
                          )}
                        </TabsTrigger>
                      </TabsList>


                      <TabsContent value="overview" className="space-y-4 pt-3">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-3">
                            {client.system_mode !== "own_practice" ? (
                              <div className="flex items-center gap-2">
                                <Label className="text-xs">Phase</Label>
                                <Select value={client.phase} onValueChange={(v) => setPhase(client.id, v as Phase)}>
                                  <SelectTrigger className="h-8 w-[280px]"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {PHASE_OPTIONS.map((p) => (
                                      <SelectItem key={p.value} value={p.value}>
                                        {p.value === "phase2_extended" ? "Phase 2 Extended" : p.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <Label className="text-xs">Plan Format</Label>
                                <Select
                                  value={client.plan_format ?? "food_list"}
                                  onValueChange={(v) => setPlanFormat(client.id, v as "food_list" | "recipe" | "food_list_generated")}
                                >
                                  <SelectTrigger className="h-8 w-[320px]"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="food_list">
                                      Meal Plan — Practitioner builds the food list manually.
                                    </SelectItem>
                                    <SelectItem value="food_list_generated">
                                      Meal Plan Generator — Macro calculator and AI generator build the plan.
                                    </SelectItem>
                                    <SelectItem value="recipe">
                                      Recipe Plan — Practitioner assigns specific recipes from the library.
                                    </SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            )}
                            {client.system_mode === "own_practice" && (
                              <div className="flex items-center gap-2">
                                <Label className="text-xs">Meals per day</Label>
                                <Select
                                  value={String((client as unknown as { meals_per_day?: number }).meals_per_day ?? 3)}
                                  onValueChange={(v) => setMealsPerDay(client.id, Number(v))}
                                >
                                  <SelectTrigger className="h-8 w-20"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="3">3</SelectItem>
                                    <SelectItem value="4">4</SelectItem>
                                    <SelectItem value="5">5</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            )}
                            {client.system_mode !== "own_practice" && (
                              <div className="flex items-center gap-2">
                                <Label className="text-xs">Batch cooking</Label>
                                <Select
                                  value={client.batch_cooking_mode ?? "3-day"}
                                  onValueChange={(v) => setBatchCookingMode(client.id, v as "3-day" | "off")}
                                >
                                  <SelectTrigger className="h-8 w-[120px]"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="3-day">3-day</SelectItem>
                                    <SelectItem value="off">Off</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            )}
                            <Button variant="outline" size="sm"
                              onClick={() => { navigator.clipboard.writeText(portalLink); toast.success("Portal link copied"); }}>
                              Copy portal link
                            </Button>
                            {client.system_mode !== "own_practice" && (
                              <MbPdfImport clientId={client.id} onSaved={load} hasUpload={!!client.mb_pdf_path} />
                            )}
                            {client.system_mode === "own_practice" && client.plan_format === "food_list" && (
                              <FoodListDocImport
                                clientId={client.id}
                                existingList={(client as unknown as { food_list?: unknown }).food_list}
                                mealsPerDay={Number((client as unknown as { meals_per_day?: number }).meals_per_day ?? 3)}
                                onSaved={load}
                              />
                            )}
                            {client.system_mode === "own_practice" && client.plan_format === "recipe" && (
                              <RecipesDocImport clientId={client.id} mealsPerDay={Number((client as unknown as { meals_per_day?: number }).meals_per_day ?? 3)} onSaved={load} />
                            )}
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
                                {isCustom && client.phase2_strict_started_at && (
                                  <span className="ml-2">
                                    Strict period: <span className="font-medium text-foreground">14 days</span>
                                  </span>
                                )}
                              </div>
                            );
                          })()}
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
                              <MealsOverviewSection recipes={recipesList} />
                            </>
                          );
                        })()}



                        <div className="flex justify-start">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => { setEditingAppointment(appointments[client.id] ?? null); setApptDialogClientId(client.id); }}
                          >
                            {appointments[client.id] ? "Edit Next Appointment" : "Book Next Appointment"}
                          </Button>
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

                      <TabsContent value="macros" className="pt-3 space-y-6">
                        <MacrosTab
                          client={client as unknown as Parameters<typeof MacrosTab>[0]["client"]}
                          latestWeightKg={(() => {
                            const w = list.find((ci) => ci.weight_kg != null)?.weight_kg;
                            return w != null ? Number(w) : null;
                          })()}
                          onChanged={(patch) => {
                            setClients((cs) => cs.map((x) => (x.id === client.id ? ({ ...x, ...patch } as typeof x) : x)));
                          }}
                          onGoToProfile={() => setClients((cs) => cs.map((x) => (x.id === client.id ? ({ ...x, _activeTab: "overview" } as typeof x) : x)))}
                        />
                        {client.system_mode === "own_practice" && client.plan_format === "food_list_generated" && (
                          <>
                            <MacroAllocationSection
                              clientId={client.id}
                              macros={(client as unknown as { macros?: { calories: number; protein_g: number; carbs_g: number; fat_g: number } | null }).macros ?? null}
                              mealsPerDay={Number((client as unknown as { meals_per_day?: number }).meals_per_day ?? 3)}
                              allocation={(client as unknown as { macro_allocation?: Record<string, { calories: number; protein_g: number; carbs_g: number; fat_g: number }> | null }).macro_allocation ?? null}
                              onClientPatched={(patch) => {
                                setClients((cs) => cs.map((x) => (x.id === client.id ? ({ ...x, ...patch } as typeof x) : x)));
                              }}
                            />
                            <FoodListPlanGenerator
                              clientId={client.id}
                              macros={(client as unknown as { macros?: { calories: number; protein_g: number; carbs_g: number; fat_g: number } | null }).macros ?? null}
                              mealsPerDay={Number((client as unknown as { meals_per_day?: number }).meals_per_day ?? 3)}
                              foodExclusions={(client as unknown as { food_exclusions?: string[] | null }).food_exclusions ?? null}
                              existingList={(client as unknown as { food_list?: unknown }).food_list}
                              macroAllocation={(client as unknown as { macro_allocation?: Record<string, { calories: number; protein_g: number; carbs_g: number; fat_g: number }> | null }).macro_allocation ?? null}
                              onSaved={load}
                              onClientPatched={(patch) => {
                                setClients((cs) => cs.map((x) => (x.id === client.id ? ({ ...x, ...patch } as typeof x) : x)));
                              }}
                            />
                          </>
                        )}
                      </TabsContent>

                      <TabsContent value="mealplan" className="pt-3">
                        {client.system_mode === "own_practice" ? (
                          (client.plan_format === "food_list" || client.plan_format === "food_list_generated") ? (
                            generatingPlans[client.id] ? (
                              <div className="rounded-md border p-6 bg-card text-center space-y-2">
                                <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                                <p className="text-sm text-muted-foreground">Generating meal plan…</p>
                              </div>
                            ) : (
                              <div className="space-y-3">
                                <CustomFoodListEditor
                                  clientId={client.id}
                                  initialList={(client as unknown as { food_list?: unknown }).food_list}
                                  initialNotes={(client as unknown as { food_list_notes?: unknown }).food_list_notes}
                                  initialMealsPerDay={(client as unknown as { meals_per_day?: number }).meals_per_day ?? 3}
                                  planFormat={client.plan_format as "food_list" | "food_list_generated"}
                                  macros={(client as unknown as { macros?: { calories: number; protein_g: number; carbs_g: number; fat_g: number } | null }).macros ?? null}
                                  onGoToMacros={() => {
                                    setClients((cs) => cs.map((x) => (x.id === client.id ? ({ ...x, _activeTab: "macros" } as typeof x) : x)));
                                    setTimeout(() => {
                                      document.getElementById("generate-meal-plan-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
                                    }, 150);
                                  }}
                                />
                              </div>
                            )
                          ) : client.plan_format === "recipe" ? (
                            <RecipePlanAssignments
                              clientId={client.id}
                              mealsPerDay={(client as unknown as { meals_per_day?: number }).meals_per_day ?? 3}
                              macros={(client as unknown as { macros?: { calories: number; protein_g: number; carbs_g: number; fat_g: number } | null }).macros ?? null}
                            />

                          ) : (
                            <p className="text-sm text-muted-foreground">No meal plan tools available for this plan format.</p>
                          )
                        ) : (client.phase === "phase2_strict" || client.phase === "phase2_extended") ? (() => {
                          const cats = categoriesForPhase(client.phase2_food_list, client.phase, client.phase3_mb_fat_oil, client as unknown as Record<string, unknown>);
                          const isCustomised = Array.isArray(client.phase2_food_list);
                          const isExtended = client.phase === "phase2_extended";
                          if (!isCustomised && cats.length === 0) {
                            return (
                              <div className="rounded-md border p-6 text-center space-y-2">
                                <p className="text-sm font-medium">No meal plan uploaded yet</p>
                                <p className="text-xs text-muted-foreground">
                                  Upload this client's MB PDF to populate their Phase 2 personal food list.
                                </p>
                              </div>
                            );
                          }
                          const heading = isExtended
                            ? "Phase 2 Extended — Personal Food List"
                            : "Phase 2 Strict — Personal Food List";
                          const helper = isExtended
                            ? "Same food list as Phase 2 Strict, with treat meals allowed. Remove sections or items — changes save instantly."
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
                                  value={client.food_limits ?? {}}
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
                          const parsedGroups: { title: string; field: keyof Client }[] = [
                            { title: "Fish", field: "phase3_mb_fish" },
                            { title: "Seafood", field: "phase3_mb_seafood" },
                            { title: "Meat", field: "phase3_mb_meat" },
                            { title: "Cheese", field: "phase3_mb_cheese" },
                            { title: "Legumes", field: "phase3_mb_legumes" },
                            { title: "Vegetables", field: "phase3_mb_vegetables" },
                            { title: "Veg / Lettuce", field: "phase3_mb_veg_lettuce" },
                            { title: "Sprouts", field: "phase3_mb_sprouts" },
                            { title: "Oils (Cold-Pressed)", field: "phase3_mb_fat_oil" },
                          ];
                          const populated = parsedGroups
                            .map((g) => ({
                              title: g.title,
                              items: ((client[g.field] as string) ?? "")
                                .split(",")
                                .map((s) => s.trim())
                                .filter(Boolean),
                            }))
                            .filter((g) => g.items.length > 0);
                          if (populated.length === 0) {
                            return (
                              <div className="rounded-md border p-6 text-center space-y-2">
                                <p className="text-sm font-medium">No meal plan uploaded yet</p>
                                <p className="text-xs text-muted-foreground">
                                  Upload this client's MB PDF to populate their Phase 3 extended food list.
                                </p>
                              </div>
                            );
                          }
                          return (
                            <div className="space-y-3">
                              <div>
                                <p className="text-sm font-medium">Phase 3 — Extended Personal Food List</p>
                                <p className="text-xs text-muted-foreground">Parsed from this client's MB PDF.</p>
                              </div>
                              <div className="space-y-3">
                                {populated.map((cat) => (
                                  <div key={cat.title} className="border rounded-md p-3 space-y-2">
                                    <p className="text-sm font-medium">{cat.title}</p>
                                    <div className="flex flex-wrap gap-1.5">
                                      {cat.items.map((item) => (
                                        <span key={item} className="inline-flex items-center rounded-full bg-secondary text-secondary-foreground text-xs px-2.5 py-1">
                                          {item}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })() : null}
                      </TabsContent>
                      <TabsContent value="messages" className="pt-3">
                        <PractitionerMessages clientId={client.id} clientName={client.name} onRead={() => markPractitionerRead(client.id)} />
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

      <AlertDialog open={!!archiveConfirmId} onOpenChange={(o) => { if (!o) setArchiveConfirmId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Archive {clients.find((c) => c.id === archiveConfirmId)?.name ?? "client"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They will be hidden from your client list but their data will be kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => archiveConfirmId && archiveClient(archiveConfirmId)}>
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!reactivateConfirmId} onOpenChange={(o) => { if (!o) setReactivateConfirmId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Reactivate {clients.find((c) => c.id === reactivateConfirmId)?.name ?? "client"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They will be moved back to your active client list.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => reactivateConfirmId && reactivateClient(reactivateConfirmId)}>
              Reactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {apptDialogClientId && practitionerId && (
        <AppointmentDialog
          open={!!apptDialogClientId}
          onOpenChange={(o) => { if (!o) { setApptDialogClientId(null); setEditingAppointment(null); } }}
          clientId={apptDialogClientId}
          practitionerId={practitionerId}
          appointment={editingAppointment}
          onSaved={() => { void loadRef.current(); }}
        />
      )}
    </main>
  );
}
