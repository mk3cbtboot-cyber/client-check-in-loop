import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Home, ClipboardCheck, BookOpen, CalendarDays, MessageCircle, Info } from "lucide-react";
import ChatThread, { type ChatMessage } from "@/components/ChatThread";
import ClientWelcome from "@/components/ClientWelcome";

import { MB_FOODS, MB_OPTIONS, MB_RULES, type MealType, type OptionDef } from "@/lib/mb-foods";
import { resolvePhase2Categories } from "@/lib/phase2-food-list";
import { resolvePhase3MbField, PHASE3_MB_DEFAULTS } from "@/lib/phase3-mb-defaults";
import { phaseShort, oilAllowed, recipeBuilderEnabled, type Phase } from "@/lib/phases";
import { getPhaseProgress } from "@/lib/progress";
import MealPlanner, { type WeeklyPlan } from "@/components/MealPlanner";
import MealRecipeSection from "@/components/MealRecipeSection";


interface ClientState {
  id: string;
  name: string;
  phase: Phase;
  food_limits: Record<string, number>;
  food_limit_counts: Record<string, number>;
  water_today_litres: number;
  meal_streak: number;
  water_streak: number;
  mb_pdf_path: string | null;
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
  weight_unit: "kg" | "lbs";
  length_unit: "cm" | "in";
  height_cm: number | null;
  phase2_strict_started_at: string | null;
  phase2_strict_mode: "mb_standard" | "practitioner_custom";
  phase2_food_list: unknown;
  food_fish: string;
  food_seafood: string;
  food_milk_products: string;
  food_yogurt: string;
  food_nuts: string;
  food_meat: string;
  food_poultry: string;
  food_cheese: string;
  food_legumes: string;
  food_pumpkin_seeds: string;
  food_sunflower_seeds: string;
  food_vegetables: string;
  food_veg_lettuce: string;
  food_starch: string;
  food_bread: string;
  food_fruit: string;
  system_mode: "mb" | "own_practice";
  gender: "female" | "male" | "unspecified" | null;
  batch_cooking_mode: "3-day" | "off";
  welcome_seen: boolean;
  practitioner_first_name?: string;
  phase4_start_date?: string | null;
  phase4_appointments?: Array<{ id: string; title: string; scheduled_at: string; status: string | null }>;
  phase3_lunch_protein_bonus: number;
  phase3_lunch_carb_bonus: number;
  phase3_portions_confirmed: boolean;
  phase3_lunch_prompt_last_dismissed_on: string | null;
}


type TabKey = "home" | "checkin" | "plan" | "planner" | "messages";

export default function ClientPortal() {
  const { token } = useParams<{ token: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = (searchParams.get("tab") as TabKey) || "home";
  const [tab, setTab] = useState<TabKey>(["home", "checkin", "plan", "planner", "messages"].includes(initialTab) ? initialTab : "home");
  const [weeklyPlan, setWeeklyPlan] = useState<WeeklyPlan | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [unreadMessages, setUnreadMessages] = useState<number>(0);


  const [loading, setLoading] = useState(true);
  const [archived, setArchived] = useState(false);
  const [client, setClient] = useState<ClientState | null>(null);
  const [welcomeOpen, setWelcomeOpen] = useState(false);

  // Home/recipe builder state
  const [meal, setMeal] = useState<MealType | null>(null);
  const [option, setOption] = useState<OptionDef | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [oil, setOil] = useState<string>("none");
  // For batch_cooking_mode === "off": which option id is expanded per meal tab.
  const [expandedOptionId, setExpandedOptionId] = useState<Record<MealType, number | null>>({
    breakfast: null, lunch: null, dinner: null,
  });
  
  const [generating, setGenerating] = useState(false);
  type RecipeOption = { recipe_title: string; recipe: string[]; method: string[]; notes: string[] };
  const [recipeOptions, setRecipeOptions] = useState<RecipeOption[]>([]);
  const [confirmedRecipe, setConfirmedRecipe] = useState<RecipeOption | null>(null);
  const [loggingIdx, setLoggingIdx] = useState<number | null>(null);
  // Per-slot regeneration counter, keyed by `${meal}:${option.label}`. Max 1 regeneration.
  const [regenCounts, setRegenCounts] = useState<Record<string, number>>({});
  const slotKey = meal && option ? `${meal}:${option.label}` : "";
  const regenCount = slotKey ? (regenCounts[slotKey] ?? 0) : 0;
  const regenLimitReached = regenCount >= 1;
  const [lastIngredients, setLastIngredients] = useState<Array<{ label: string; qty: string }>>([]);
  const [eggLogConfirm, setEggLogConfirm] = useState<{ idx: number; recipe: RecipeOption; eggsInMeal: number; eggsUsed: number; eggsMax: number } | null>(null);

  // Check-in state
  const [feeling, setFeeling] = useState<number>(3);
  const [waterLitres, setWaterLitres] = useState<number>(0);
  const [notes, setNotes] = useState("");
  const [submittingCheckin, setSubmittingCheckin] = useState(false);
  const [checkinDone, setCheckinDone] = useState(false);


  // Phase 2 Strict daily progress
  const [weightInput, setWeightInput] = useState<string>("");
  const [weightUnit, setWeightUnit] = useState<"kg" | "lbs">("kg");
  const [lengthUnit, setLengthUnit] = useState<"cm" | "in">("cm");
  const [latestWeightKg, setLatestWeightKg] = useState<number | null>(null);
  const initialRatings = {
    general_wellbeing: 3, fatigue: 3, sleep: 3, headache: 3, pain: 3,
    joint_pain: 3, acid_reflux: 3, digestion: 3, allergy_skin: 3,
  };
  const [ratings, setRatings] = useState<Record<string, number>>(initialRatings);
  const setRating = (k: string, v: number) => setRatings((r) => ({ ...r, [k]: v }));

  // Weekly Phase 2 Strict measurements (stored in cm internally)
  
  const [waistInput, setWaistInput] = useState<string>("");
  const [hipInput, setHipInput] = useState<string>("");
  const [chestInput, setChestInput] = useState<string>("");
  const [thighInput, setThighInput] = useState<string>("");

  const toCm = (v: string) => {
    if (!v) return undefined;
    const n = Number(v);
    if (!isFinite(n)) return undefined;
    return lengthUnit === "in" ? Math.round(n * 2.54 * 100) / 100 : n;
  };

  const refresh = async () => {
    if (!token) return;
    const { data } = await supabase.functions.invoke("client-portal-data", { body: { token } });
    if (data?.valid) {
      setArchived(false);
      setClient(data.client);
      setWaterLitres(Number(data.client.water_today_litres) || 0);
      setWeightUnit(data.client.weight_unit || "kg");
      setLengthUnit(data.client.length_unit || "cm");
      setLatestWeightKg(data.client.latest_weight_kg ?? null);
      if (data.client.welcome_seen === false && data.client.phase !== "phase4") setWelcomeOpen(true);
    } else if (data?.archived) {
      setArchived(true);
    }
  };

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    const originalTitle = document.title;
    document.title = "Metabolic Rx Meal Planner";
    return () => {
      document.title = originalTitle;
    };
  }, []);

  // Always refetch client data (incl. fresh gender) when entering the check-in tab
  useEffect(() => {
    if (tab === "checkin") refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);


  // Load this week's confirmed meal plan (used to restrict the recipe builder)
  useEffect(() => {
    if (!token) return;
    (async () => {
      const { data } = await supabase.functions.invoke("weekly-meal-plan", { body: { token, action: "get" } });
      setWeeklyPlan(data?.plan ?? null);
    })();
  }, [token]);

  const loadMessages = async () => {
    if (!token) return;
    const { data } = await supabase.functions.invoke("client-messages", { body: { token, action: "list" } });
    if (Array.isArray(data?.messages)) setMessages(data.messages as ChatMessage[]);
    setUnreadMessages(0);
  };
  const fetchUnread = async () => {
    if (!token) return;
    const { data } = await supabase.functions.invoke("client-messages", { body: { token, action: "unread_count" } });
    if (typeof data?.unread === "number") setUnreadMessages(data.unread);
  };
  const sendMessage = async (body: string) => {
    if (!token) return;
    setSendingMessage(true);
    try {
      const { data, error } = await supabase.functions.invoke("client-messages", { body: { token, action: "send", body } });
      if (error) throw error;
      if (Array.isArray(data?.messages)) setMessages(data.messages as ChatMessage[]);
      setUnreadMessages(0);
    } catch (e) {
      toast.error("Couldn't send message. Please try again.");
    } finally {
      setSendingMessage(false);
    }
  };
  useEffect(() => {
    if (tab !== "messages" || !token) return;
    void loadMessages();
    const id = window.setInterval(() => void loadMessages(), 5000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, token]);

  // Poll unread count when not on the messages tab.
  useEffect(() => {
    if (!token) return;
    if (tab === "messages") return;
    void fetchUnread();
    const id = window.setInterval(() => void fetchUnread(), 20000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, token]);


  const changeTab = (t: TabKey) => {
    setTab(t);
    const next = new URLSearchParams(searchParams);
    if (t === "home") next.delete("tab");
    else next.set("tab", t);
    setSearchParams(next, { replace: true });
    // Re-fetch latest client state (incl. phase3_mode + MB fields) when opening My Plan
    if (t === "plan") void refresh();
  };

  const addWater = async () => {
    const { data, error } = await supabase.functions.invoke("client-portal-water", { body: { token } });
    if (error || data?.error) return toast.error("Could not log water");
    setClient((c) => (c ? { ...c, water_today_litres: data.water_today_litres, water_streak: data.water_streak ?? c.water_streak } : c));
    setWaterLitres(Number(data.water_today_litres) || 0);
    if (data?.just_hit_target) {
      toast.success("You hit your water target today! 💧 Keep the streak going.");
    }
  };

  const setWaterAmount = async (litres: number) => {
    const safe = Math.max(0, Math.min(20, Number(litres) || 0));
    setWaterLitres(safe);
    const { data } = await supabase.functions.invoke("client-portal-water", { body: { token, set_litres: safe } });
    if (data?.water_today_litres !== undefined) {
      setClient((c) => (c ? { ...c, water_today_litres: data.water_today_litres, water_streak: data.water_streak ?? c.water_streak } : c));
      if (data?.just_hit_target) {
        toast.success("You hit your water target today! 💧 Keep the streak going.");
      }
    }
  };

  const updateWeightUnit = async (unit: "kg" | "lbs") => {
    setWeightUnit(unit);
    setClient((c) => (c ? { ...c, weight_unit: unit } : c));
    await supabase.functions.invoke("update-client-prefs", { body: { token, weight_unit: unit } });
  };

  const updateLengthUnit = async (unit: "cm" | "in") => {
    setLengthUnit(unit);
    setClient((c) => (c ? { ...c, length_unit: unit } : c));
    await supabase.functions.invoke("update-client-prefs", { body: { token, length_unit: unit } });
  };

  const dismissWelcome = async () => {
    setWelcomeOpen(false);
    setClient((c) => (c ? { ...c, welcome_seen: true } : c));
    if (token) {
      await supabase.functions.invoke("update-client-prefs", { body: { token, welcome_seen: true } });
    }
  };

  // Phase 3 weekly lunch portion prompt
  const [lunchPromptStep, setLunchPromptStep] = useState<"initial" | "confirm" | null>("initial");
  const mondayOfDate = (d: Date): string => {
    const dt = new Date(d);
    const day = (dt.getUTCDay() + 6) % 7;
    dt.setUTCDate(dt.getUTCDate() - day);
    return dt.toISOString().slice(0, 10);
  };
  const showLunchPrompt = (() => {
    if (!client || client.phase !== "phase3") return false;
    if (client.phase3_portions_confirmed) return false;
    const thisMonday = mondayOfDate(new Date());
    const last = client.phase3_lunch_prompt_last_dismissed_on;
    if (!last) return true;
    return last < thisMonday;
  })();
  const sendLunchAction = async (action: "accept" | "confirm" | "defer") => {
    if (!token) return;
    const { data } = await supabase.functions.invoke("update-client-prefs", { body: { token, phase3_lunch_action: action } });
    const updated = data?.client;
    setClient((c) => (c ? {
      ...c,
      phase3_lunch_protein_bonus: updated?.phase3_lunch_protein_bonus ?? c.phase3_lunch_protein_bonus,
      phase3_lunch_carb_bonus: updated?.phase3_lunch_carb_bonus ?? c.phase3_lunch_carb_bonus,
      phase3_portions_confirmed: updated?.phase3_portions_confirmed ?? c.phase3_portions_confirmed,
      phase3_lunch_prompt_last_dismissed_on: updated?.phase3_lunch_prompt_last_dismissed_on ?? c.phase3_lunch_prompt_last_dismissed_on,
    } : c));
    setLunchPromptStep("initial");
    if (action === "accept") {
      const p = (updated?.phase3_lunch_protein_bonus ?? 0);
      const cb = (updated?.phase3_lunch_carb_bonus ?? 0);
      toast.success(`Lunch portions updated — protein +${p}g, carbs +${cb}g from your original plan.`);
    } else if (action === "confirm") {
      toast.success("Lunch portions locked in.");
    }
  };




  const pickOption = (m: MealType, o: OptionDef) => {
    setOption(o);
    setMeal(m);
    setPicks({});
    setOil("none");
    setRecipeOptions([]); setConfirmedRecipe(null);
  };

  const OIL_OPTIONS = [
    { value: "none", label: "None" },
    { value: "Cold-Pressed Olive Oil", label: "Cold-Pressed Olive Oil" },
    { value: "Cold-Pressed Flaxseed Oil", label: "Cold-Pressed Flaxseed Oil" },
    { value: "Cold-Pressed Coconut Oil", label: "Cold-Pressed Coconut Oil" },
    { value: "Avocado Oil", label: "Avocado Oil" },
    { value: "Ghee (clarified butter)", label: "Ghee (clarified butter)" },
  ];

  // Phase 3 additional foods, grouped per MB_FOODS category.
  // Each user-facing category maps to one or more recipe-builder source keys.
  // Practitioner Custom mapping: each user-facing category maps to one or more recipe-builder source keys.
  const phase3CustomMap: Record<string, (keyof typeof MB_FOODS)[]> = {
    phase3_meat: ["meat", "poultry"],
    phase3_fish: ["fish", "seafood"],
    phase3_vegetables: ["vegetables", "vegLettuce"],
    phase3_fruit: ["fruit"],
    phase3_starches: ["starch"],
    phase3_bread: ["bread"],
    phase3_dairy: ["cheese", "yogurt", "milkProducts"],
    phase3_other: ["fish","seafood","poultry","meat","cheese","yogurt","milkProducts","vegetables","vegLettuce","fruit","bread","starch","legumes"],
  };

  // MB Standard mapping. phase3_mb_fat_oil sources into the new "oils" key,
  // which the Meal Planner injects as an optional Oil component when oils are allowed.
  const phase3MbMap: Record<string, (keyof typeof MB_FOODS)[]> = {
    phase3_mb_fish: ["fish"],
    phase3_mb_seafood: ["seafood"],
    phase3_mb_cheese: ["cheese"],
    phase3_mb_legumes: ["legumes"],
    phase3_mb_vegetables: ["vegetables", "vegLettuce"],
    phase3_mb_fat_oil: ["oils"],
  };

  const parseList = (s: string | undefined | null) =>
    (s ?? "").split(",").map((x) => x.trim()).filter((x) => x.length > 0);

  const phase2ParsedGroups: { title: string; field: keyof ClientState }[] = [
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

  const categoriesFromFields = (groups: { title: string; field: keyof ClientState }[]) =>
    groups
      .map((g) => ({ title: g.title, items: parseList(client?.[g.field] as string | undefined) }))
      .filter((g) => g.items.length > 0);

  const phase3ExtrasForSources = (sources: (keyof typeof MB_FOODS)[]): string[] => {
    if (!client) return [];
    if (client.phase !== "phase3" && client.phase !== "phase4") return [];
    const isMb = client.phase3_mode === "mb_standard";
    const map = isMb ? phase3MbMap : phase3CustomMap;
    const sourceSet = new Set(sources);
    const out: string[] = [];
    for (const [field, cats] of Object.entries(map)) {
      if (!cats.some((c) => sourceSet.has(c))) continue;
      const raw = (client as unknown as Record<string, string>)[field];
      // MB Standard falls back to defaults extracted from the standard MB Phase 3 list
      // when the practitioner hasn't yet populated the field from the client's PDF.
      const items = isMb ? resolvePhase3MbField(field, raw) : parseList(raw);
      out.push(...items);
    }
    return out;
  };


  const foodLimits = (client?.food_limits ?? {}) as Record<string, number>;
  const foodLimitCounts = (client?.food_limit_counts ?? {}) as Record<string, number>;

  const filteredSources = (sources: (keyof typeof MB_FOODS)[]) => {
    const items = [...sources.flatMap((s) => MB_FOODS[s]), ...phase3ExtrasForSources(sources)];
    const seen = new Set<string>();
    return items.filter((i) => {
      if (seen.has(i)) return false;
      seen.add(i);
      return true;
    });
  };


  // Weekly-plan lock: if the client has confirmed a weekly plan, restrict recipe
  // builder picks to the foods they actually selected for that meal+component.
  const weekConfirmed = !!weeklyPlan?.confirmed_at;
  const lockedSelectionsForMeal = (m: MealType | null): Record<string, string> => {
    if (!m || !weeklyPlan) return {};
    return ((weeklyPlan as any)[`${m}_selections`] as Record<string, string>) ?? {};
  };
  const lockedMealIdFor = (m: MealType | null): number | null => {
    if (!m || !weeklyPlan) return null;
    return ((weeklyPlan as any)[`${m}_meal_id`] as number | null) ?? null;
  };
  const restrictedItems = (sources: (keyof typeof MB_FOODS)[], componentKey: string): string[] => {
    const base = filteredSources(sources);
    if (!weekConfirmed) return base;
    const lockedPrimary = lockedSelectionsForMeal(meal)[componentKey];
    const lockedAlt = meal && weeklyPlan
      ? ((weeklyPlan as any)[`${meal}_selections_alt`] as Record<string, string> | undefined)?.[componentKey]
      : undefined;
    const allowed = [lockedPrimary, lockedAlt].filter(Boolean) as string[];
    if (!allowed.length) return base;
    return base.filter((i) => allowed.includes(i));
  };
  const optionsForMeal = (m: MealType): OptionDef[] => {
    if (!weekConfirmed) return MB_OPTIONS[m];
    const lockedId = lockedMealIdFor(m);
    const altId = weeklyPlan ? ((weeklyPlan as any)[`${m}_meal_id_alt`] as number | null) : null;
    const ids = [lockedId, altId].filter((v): v is number => typeof v === "number");
    if (!ids.length) return MB_OPTIONS[m];
    return MB_OPTIONS[m].filter((o) => ids.includes(o.id));
  };

  // Auto-apply locked picks when the user enters the recipe builder after confirming the week
  useEffect(() => {
    if (!weekConfirmed || !meal || !option) return;
    const locked = lockedSelectionsForMeal(meal);
    if (!Object.keys(locked).length) return;
    setPicks((prev) => {
      const next = { ...prev };
      for (const c of option.components) {
        if (locked[c.key] && !next[c.key]) next[c.key] = locked[c.key];
      }
      return next;
    });
  }, [weekConfirmed, meal, option, weeklyPlan]);


  const generate = async () => {
    if (!option || !meal) return;
    for (const c of option.components) {
      if (!c.optional && !picks[c.key]) return toast.error(`Choose: ${c.label}`);
    }
    const veg1 = option.components.find((c) => c.key === "veg1");
    const veg2 = option.components.find((c) => c.key === "veg2");
    const bothVeg = veg1 && veg2 && picks["veg1"] && picks["veg2"];
    let veg1Qty = veg1?.qty ?? "";
    let veg2Qty = veg2?.qty ?? "";
    if (bothVeg) {
      const m = (veg1!.qty || "").match(/(\d+(?:\.\d+)?)\s*g/i);
      if (m) {
        const half = Math.round(parseFloat(m[1]) / 2);
        veg1Qty = `${half}g`;
        veg2Qty = `${half}g`;
      }
    }
    const ingredients = [
      ...(option.fixed ?? []).map((f) => ({ label: f.label, qty: f.qty })),
      ...option.components.filter((c) => picks[c.key]).map((c) => {
        let qty = c.qty || "see option";
        if (c.key === "veg1") qty = veg1Qty || qty;
        if (c.key === "veg2") qty = veg2Qty || "see option";
        return { label: `${c.label}: ${picks[c.key]}`, qty };
      }),
      ...(picks["starch_extra"] ? [{ label: `Starches: ${picks["starch_extra"]}`, qty: "as advised" }] : []),
      ...(picks["legumes_extra"] ? [{ label: `Legumes: ${picks["legumes_extra"]}`, qty: "as advised" }] : []),
    ];
    const isRegen = recipeOptions.length > 0 || confirmedRecipe !== null;
    if (isRegen && regenLimitReached) {
      toast.error("Regeneration limit reached for this meal option.");
      return;
    }
    setGenerating(true);
    setRecipeOptions([]);
    setConfirmedRecipe(null);
    try {
      const { data, error } = await supabase.functions.invoke("generate-mb-recipe", {
        body: { token, meal_type: meal, option_label: option.label, ingredients, oil: oilAllowed(client!.phase) ? oil : "none" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const opts: RecipeOption[] = Array.isArray(data?.options) ? data.options : [];
      if (opts.length === 0) throw new Error("No recipes returned");
      setRecipeOptions(opts);
      setLastIngredients(ingredients);
      if (isRegen) setRegenCounts((r) => ({ ...r, [slotKey]: (r[slotKey] ?? 0) + 1 }));
    } catch (e: any) {
      toast.error(e.message ?? "Failed to generate");
    } finally {
      setGenerating(false);
    }
  };

  const isP2Strict = client?.phase === "phase2_strict";
  const isRatingsMode = !!client && client.phase !== "phase1";
  const daysSinceP2Start = (() => {
    if (!isP2Strict || !client?.phase2_strict_started_at) return 0;
    const start = new Date(client.phase2_strict_started_at).getTime();
    return Math.floor((Date.now() - start) / (1000 * 60 * 60 * 24));
  })();
  const strictTotalDays = 14;
  const isAlwaysWeeklyPhase = client?.phase === "phase2_extended" || client?.phase === "phase3" || client?.phase === "phase4";
  const isWeeklyMode = (isP2Strict && daysSinceP2Start >= strictTotalDays) || isAlwaysWeeklyPhase;
  const ratingsTitle = isP2Strict
    ? (isWeeklyMode ? "Weekly Progress — Phase 2" : "Daily Progress — Phase 2")
    : `Weekly Progress — ${phaseShort(client?.phase ?? "")}`;
  const ratingsSubtitle = isWeeklyMode
    ? (isP2Strict
        ? `You're past Day ${strictTotalDays} — please complete this once per week. Rate each area from 1 (best) to 5 (worst).`
        : "Please complete this once per week. Rate each area from 1 (best) to 5 (worst).")
    : "Rate each area from 1 (best) to 5 (worst).";
  const phaseProgress = getPhaseProgress(client?.phase, client?.phase2_strict_started_at);
  const renderGender = client?.gender ?? null;

  useEffect(() => {
    if (tab === "checkin" && client) {
      console.log("[ClientPortal] Check-in form gender from backend:", renderGender);
    }
  }, [tab, client, renderGender]);

  const submitCheckin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingCheckin(true);
    try {
      const body: Record<string, unknown> = { token, notes, water_litres: waterLitres };
      if (isRatingsMode) {
        if (weightInput) {
          const w = Number(weightInput);
          const kg = weightUnit === "lbs" ? Math.round(w * 0.45359237 * 100) / 100 : w;
          body.weight_kg = kg;
        }
        Object.assign(body, ratings);
        if (isWeeklyMode) {
          body.is_weekly = true;

          const waist = toCm(waistInput); if (waist !== undefined) body.waist_cm = waist;
          const includeHip = renderGender !== "male";
          const includeChest = renderGender !== "female";
          if (includeChest) {
            const chest = toCm(chestInput); if (chest !== undefined) body.chest_cm = chest;
          }
          if (includeHip) {
            const hip = toCm(hipInput); if (hip !== undefined) body.hip_cm = hip;
          }
          const thigh = toCm(thighInput); if (thigh !== undefined) body.upper_thigh_cm = thigh;
        }
      } else {
        body.feeling = feeling;
      }
      const { data, error } = await supabase.functions.invoke("submit-checkin", { body });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setClient((c) => (c ? { ...c, water_today_litres: waterLitres } : c));
      setCheckinDone(true);
    } catch (err: any) {
      toast.error(err.message ?? "Failed to submit");
    } finally {
      setSubmittingCheckin(false);
    }
  };

  if (loading) return <main className="min-h-screen flex items-center justify-center">Loading…</main>;
  if (archived) return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <Card className="p-6 text-center max-w-md space-y-2">
        <p className="font-medium">Your programme is currently inactive.</p>
        <p className="text-sm text-muted-foreground">Please contact your practitioner.</p>
      </Card>
    </main>
  );
  if (!client) return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <Card className="p-6 text-center max-w-md"><p>Invalid link.</p></Card>
    </main>
  );

  // Eggs limit/used now sourced from food_limits / food_limit_counts where needed.
  const waterTarget = 2.5;

  // My Plan categories — uses practitioner-customised list when set, otherwise defaults.
  const planCategories = (() => {
    return resolvePhase2Categories(client.phase2_food_list);
  })();

  // Phase 4 — check-in is only open in the 7 days before each scheduled check-in appointment.
  const phase4CheckinState: {
    enabled: boolean;
    inWindow: boolean;
    nextOpensAt: Date | null;
    nextAppointmentTitle: string | null;
    nextAppointmentAt: Date | null;
  } = (() => {
    if (client.phase !== "phase4") {
      return { enabled: false, inWindow: true, nextOpensAt: null, nextAppointmentTitle: null, nextAppointmentAt: null };
    }
    const now = new Date();
    const appts = (client.phase4_appointments ?? [])
      .filter((a) => /check-?in/i.test(a.title) && a.status !== "attended")
      .map((a) => ({ ...a, at: new Date(a.scheduled_at) }))
      .filter((a) => !isNaN(a.at.getTime()))
      .sort((a, b) => a.at.getTime() - b.at.getTime());
    // Find an appointment whose window contains now: [scheduled - 7d, scheduled]
    const current = appts.find((a) => {
      const opens = new Date(a.at.getTime() - 7 * 24 * 60 * 60 * 1000);
      return now >= opens && now <= a.at;
    });
    if (current) {
      return { enabled: true, inWindow: true, nextOpensAt: null, nextAppointmentTitle: current.title, nextAppointmentAt: current.at };
    }
    const upcoming = appts.find((a) => a.at.getTime() > now.getTime());
    if (upcoming) {
      return {
        enabled: true, inWindow: false,
        nextOpensAt: new Date(upcoming.at.getTime() - 7 * 24 * 60 * 60 * 1000),
        nextAppointmentTitle: upcoming.title,
        nextAppointmentAt: upcoming.at,
      };
    }
    return { enabled: true, inWindow: false, nextOpensAt: null, nextAppointmentTitle: null, nextAppointmentAt: null };
  })();
  const phase4CheckinHidden = client.phase === "phase4" && !phase4CheckinState.inWindow;
  const fmtDate = (d: Date) => d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });



  return (
    <main className="min-h-screen bg-background pb-24">
      <ClientWelcome open={welcomeOpen} clientName={client.name} onDismiss={dismissWelcome} />
      <header className="border-b">
        <div className="max-w-5xl mx-auto p-4 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Hi {client.name}</h1>
            <p className="text-xs text-muted-foreground">Metabolic Balance · {phaseShort(client.phase)}</p>
          </div>
          <button
            type="button"
            onClick={() => setWelcomeOpen(true)}
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            aria-label="Show welcome"
          >
            <Info className="h-3.5 w-3.5" /> Show welcome
          </button>
        </div>
      </header>


      {tab === "home" && client.phase === "phase4" && (
        <section className="max-w-3xl mx-auto p-4 pb-0 space-y-4">
          <Card className="p-6 space-y-3">
            <h2 className="text-lg font-semibold">Congratulations {client.name.split(/\s+/)[0]}!!</h2>
            <p className="text-sm leading-relaxed">
              You've reached your goal and have made it to Phase 4. Everything you've learned on your Metabolic Balance™ journey is yours to keep.
              This app is here to support you as you move forward on your own. You will have access to all the features of the app. The only difference
              is when you ask questions the answers will be generated by {client.practitioner_first_name ?? "your practitioner"}'s AI Assistant and they
              will not be forwarded to {client.practitioner_first_name ?? "your practitioner"}. If you have any pressing concerns that you need help with
              you will see that you can book a 15 or 30 minute appointment with your practitioner. Again congratulations on achieving your goal and keep
              applying what you have learned through this process.
            </p>
          </Card>
        </section>
      )}

      {tab === "home" && (
        <section className="max-w-5xl mx-auto p-4 space-y-6">
          {client.phase !== "phase4" && (
            <>
          {/* Trackers */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {Object.entries(foodLimits)
              .filter(([, lim]) => Number(lim) > 0)
              .map(([name, lim]) => {
                const used = Number(foodLimitCounts[name] ?? 0);
                const left = Math.max(0, Number(lim) - used);
                const label = name.charAt(0).toUpperCase() + name.slice(1);
                return (
                  <Card key={name} className="p-4">
                    <p className="text-xs uppercase text-muted-foreground">{label}</p>
                    <p className="text-2xl font-semibold">
                      {client.mb_pdf_path ? `${used}/${Number(lim)}` : `${used}`}
                    </p>
                    {client.mb_pdf_path && (
                      <p className="text-xs text-muted-foreground">{left} remaining this week</p>
                    )}
                  </Card>
                );
              })}
            <Card className="p-4">
              <p className="text-xs uppercase text-muted-foreground">Water Today</p>
              <p className="text-2xl font-semibold">{client.water_today_litres.toFixed(2)}L<span className="text-sm text-muted-foreground"> / {waterTarget}L</span></p>
              <Button size="sm" variant="outline" className="mt-2 w-full" onClick={addWater}>+ Glass (250ml)</Button>
            </Card>
            <Card className="p-4">
              <p className="text-xs uppercase text-muted-foreground">Meal Streak</p>
              <p className="text-2xl font-semibold">{client.meal_streak}</p>
              <p className="text-xs text-muted-foreground">consecutive meals logged</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs uppercase text-muted-foreground">Water Streak</p>
              <p className="text-2xl font-semibold">{client.water_streak ?? 0}</p>
              <p className="text-xs text-muted-foreground">consecutive days on target</p>
            </Card>
          </div>



          {client.phase === "phase1" ? (
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Tap 'My Plan' to view your Phase 1 instructions.</p>
            </Card>
          ) : client.system_mode !== "own_practice" && client.phase2_strict_mode === "mb_standard" ? (
            <Card className="p-4 space-y-3">
              <p className="font-medium">The 8 Metabolic Balance Rules</p>
              <ol className="list-decimal list-inside space-y-1 text-sm">
                {MB_RULES.map((r, i) => <li key={i}>{r}</li>)}
              </ol>
            </Card>
          ) : client.system_mode !== "own_practice" && client.phase2_strict_mode === "practitioner_custom" && client.show_8_rules ? (
            <Card className="p-4 space-y-3">
              <p className="font-medium">The 8 Metabolic Balance Rules</p>
              <ol className="list-decimal list-inside space-y-1 text-sm">
                {MB_RULES.map((r, i) => <li key={i}>{r}</li>)}
              </ol>
            </Card>
          ) : null}
            </>
          )}

          {!recipeBuilderEnabled(client.phase) ? (
            <Card className="p-6 text-center">
              <p className="text-sm text-muted-foreground">
                The recipe builder is not available during Phase 1. Focus on the meal structure in your My Plan tab.
              </p>
            </Card>
          ) : client.phase !== "phase4" && client.batch_cooking_mode === "off" && !client.mb_pdf_path ? (
            <Card className="p-6 text-center space-y-4">
              <p className="font-medium">No meal plan uploaded yet</p>
              <p className="text-sm text-muted-foreground">
                Your practitioner will upload your personalised Metabolic Balance plan here.
              </p>
            </Card>
          ) : client.phase !== "phase4" && client.batch_cooking_mode !== "off" && !weekConfirmed ? (
            <Card className="p-6 text-center space-y-4">
              <p className="text-sm text-muted-foreground">
                Before generating recipes, please head to Meal Planner to select your meals for the week and build your shopping list. Your recipe generator will then be loaded with your chosen foods for the week.
              </p>
              <Button onClick={() => changeTab("planner")}>Go to Meal Planner</Button>
            </Card>
          ) : (
            <>
              <Card className="p-3 border-primary/40 bg-primary/5">
                <p className="text-xs text-primary">
                  {(client?.batch_cooking_mode === "off" || client.phase === "phase4")
                    ? "Your meal plan is set — generate a fresh recipe whenever you're ready to cook."
                    : "Your weekly meal plan is set — recipe options are limited to the foods you selected for this week."}
                </p>
              </Card>
              <div className="grid grid-cols-3 gap-2">
                {(["breakfast","lunch","dinner"] as MealType[]).map((m) => (
                  <Button key={m} variant={meal === m ? "default" : "outline"} onClick={() => setMeal(m)}>
                    {m[0].toUpperCase() + m.slice(1)}
                  </Button>
                ))}
              </div>

              {meal && (() => {
                const wp = (weeklyPlan as any) ?? {};
                const primaryId = wp[`${meal}_meal_id`] as number | null;
                const altId = wp[`${meal}_meal_id_alt`] as number | null;
                const primaryDays = Number(wp[`${meal}_primary_days`] ?? 7);
                const primaryLogCount = Number(wp[`${meal}_primary_log_count`] ?? 0);
                const isSplit = altId != null && primaryDays < 7;
                const hidePrimary = isSplit && primaryLogCount >= primaryDays;
                const primaryOption = primaryId != null ? MB_OPTIONS[meal].find((o) => o.id === primaryId) ?? null : null;
                const altOption = altId != null ? MB_OPTIONS[meal].find((o) => o.id === altId) ?? null : null;
                const batchMode = (client.phase === "phase4" ? "off" : (((client as any).batch_cooking_mode ?? "3-day"))) as "3-day" | "off";
                const batchActive = (start: string | null | undefined): boolean => {
                  if (!start) return false;
                  const s = new Date(start + "T00:00:00Z").getTime();
                  const todayIso = new Date().toISOString().slice(0, 10);
                  const t = new Date(todayIso + "T00:00:00Z").getTime();
                  const days = Math.floor((t - s) / 86_400_000);
                  return days >= 0 && days < 3;
                };
                const primaryBatchStart = wp[`${meal}_batch_start_date`] as string | null;
                const altBatchStart = wp[`${meal}_batch_start_date_alt`] as string | null;
                const rawPrimaryLocked: any = wp[`${meal}_locked_recipe`] ?? null;
                const rawAltLocked: any = wp[`${meal}_locked_recipe_alt`] ?? null;
                const primaryLocked: any = batchMode === "off" ? null : (batchActive(primaryBatchStart) ? rawPrimaryLocked : null);
                const altLocked: any = batchMode === "off" ? null : (batchActive(altBatchStart) ? rawAltLocked : null);
                const primarySelections = (wp[`${meal}_selections`] as Record<string, string>) ?? {};
                const altSelections = (wp[`${meal}_selections_alt`] as Record<string, string>) ?? {};


                const isP3Plus = (client.phase as string) === "phase3" || (client.phase as string) === "phase4";
                const isCustomMode = client.phase3_mode !== "mb_standard";
                const buildExtras = (opt: OptionDef) => {
                  const starchExtras = (isP3Plus && isCustomMode) ? parseList(client.phase3_starches) : [];
                  const hasStarchAlready = opt.components.some((c) => c.sources.includes("starch"));
                  const legumesExtras = isP3Plus ? parseList(isCustomMode ? "" : client.phase3_mb_legumes) : [];
                  const hasLegumesAlready = opt.components.some((c) => c.sources.includes("legumes"));
                  return [
                    ...((starchExtras.length > 0 && !hasStarchAlready)
                      ? [{ key: "starch_extra", label: "Starches (optional)", qty: "as advised", sources: ["starch"] as (keyof typeof MB_FOODS)[], optional: true }]
                      : []),
                    ...((legumesExtras.length > 0 && !hasLegumesAlready)
                      ? [{ key: "legumes_extra", label: "Legumes (optional)", qty: "as advised", sources: ["legumes"] as (keyof typeof MB_FOODS)[], optional: true }]
                      : []),
                  ];
                };

                const refetchAll = async () => {
                  const { data } = await supabase.functions.invoke("weekly-meal-plan", { body: { token, action: "get" } });
                  setWeeklyPlan(data?.plan ?? null);
                  await refresh();
                };

                if (batchMode === "off") {
                  const allOptions = MB_OPTIONS[meal];
                  const expandedId = expandedOptionId[meal];
                  return (
                    <div className="space-y-3">
                      {allOptions.map((opt) => {
                        const isExpanded = expandedId === opt.id;
                        return (
                          <div key={opt.id} className="space-y-2">
                            <Card
                              className={`p-4 cursor-pointer transition-colors ${isExpanded ? "border-primary bg-primary/5" : "hover:bg-accent/50"}`}
                              onClick={() =>
                                setExpandedOptionId((prev) => ({
                                  ...prev,
                                  [meal]: isExpanded ? null : opt.id,
                                }))
                              }
                            >
                              <p className="font-medium">{opt.label}</p>
                            </Card>
                            {isExpanded && (
                              <MealRecipeSection
                                key={`${meal}-off-${opt.id}`}
                                token={token!}
                                meal={meal}
                                variant="primary"
                                optionDef={opt}
                                phase={client.phase}
                                foodLimits={foodLimits}
                                foodLimitCounts={foodLimitCounts}
                                lockedRecipe={null}
                                lockedSelections={{}}
                                extraComponents={buildExtras(opt)}
                                filteredSources={filteredSources}
                                onLogged={refetchAll}
                                fullScreenOnSelect
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                }

                return (
                  <div className="space-y-4">
                    {!hidePrimary && primaryOption && (() => {
                      const eggsMaxInner = Number(foodLimits.eggs ?? 0) || null;
                      const eggsUsed = Number(foodLimitCounts.eggs ?? 0);
                      const eggsExhausted = isSplit && eggsMaxInner != null && eggsMaxInner > 0 && eggsUsed >= eggsMaxInner;
                      const block = eggsExhausted
                        ? { reason: `You've used ${eggsUsed} of ${eggsMaxInner} eggs this week — the egg meal is unavailable until next week.` }
                        : null;
                      return (
                        <MealRecipeSection
                          key={`${meal}-primary`}
                          token={token!}
                          meal={meal}
                          variant="primary"
                          optionDef={primaryOption}
                          phase={client.phase}
                          foodLimits={foodLimits}
                          foodLimitCounts={foodLimitCounts}
                          lockedRecipe={primaryLocked}
                          lockedSelections={primarySelections}
                          sectionTitle={isSplit ? `Egg meal (${primaryLogCount}/${primaryDays} this week)` : undefined}
                          extraComponents={buildExtras(primaryOption)}
                          filteredSources={filteredSources}
                          onLogged={refetchAll}
                          blockGeneration={block}
                        />
                      );
                    })()}
                    {isSplit && altOption && (
                      <MealRecipeSection
                        key={`${meal}-alt`}
                        token={token!}
                        meal={meal}
                        variant="alt"
                        optionDef={altOption}
                        phase={client.phase}
                        foodLimits={foodLimits}
                        foodLimitCounts={foodLimitCounts}
                        lockedRecipe={altLocked}
                        lockedSelections={altSelections}
                        sectionTitle="Backup meal"
                        extraComponents={buildExtras(altOption)}
                        filteredSources={filteredSources}
                        onLogged={refetchAll}
                      />
                    )}
                  </div>
                );
              })()}
            </>
          )}
        </section>
      )}




      {tab === "checkin" && phase4CheckinHidden && (
        <section className="max-w-md mx-auto p-4">
          <Card className="p-6 text-center space-y-2">
            <p className="font-medium">Check-in is currently closed</p>
            <p className="text-sm text-muted-foreground">
              {phase4CheckinState.nextOpensAt && phase4CheckinState.nextAppointmentTitle
                ? `Your next check-in opens ${fmtDate(phase4CheckinState.nextOpensAt)} — one week before your ${phase4CheckinState.nextAppointmentTitle}.`
                : "You have no upcoming check-in appointments scheduled."}
            </p>
          </Card>
        </section>
      )}
      {tab === "checkin" && !phase4CheckinHidden && (

        <section className="max-w-md mx-auto p-4">
          {checkinDone ? (
            <Card className="p-6 text-center space-y-3">
              <h2 className="text-lg font-semibold">Thanks!</h2>
              <p className="text-sm text-muted-foreground">Your nutritionist has been notified.</p>
              <Button variant="outline" onClick={() => { setCheckinDone(false); setFeeling(3); setNotes(""); setWeightInput(""); setRatings(initialRatings); setWaistInput(""); setHipInput(""); setThighInput(""); }}>
                Submit another
              </Button>
            </Card>
          ) : isRatingsMode ? (
            <Card className="p-6 space-y-6">
              <div>
                {phaseProgress.label && (
                  <div className="inline-block mb-2 px-2 py-0.5 rounded bg-primary/10 text-primary text-xs font-medium uppercase tracking-wide">
                    {phaseProgress.label}
                  </div>
                )}
                <h2 className="text-lg font-semibold">{ratingsTitle}</h2>
                <p className="text-sm text-muted-foreground">{ratingsSubtitle}</p>
              </div>
              <form onSubmit={submitCheckin} className="space-y-5">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="weight">Weight ({weightUnit})</Label>
                    <div className="flex gap-1">
                      <Button type="button" size="sm" variant={weightUnit === "kg" ? "default" : "outline"} onClick={() => updateWeightUnit("kg")}>kg</Button>
                      <Button type="button" size="sm" variant={weightUnit === "lbs" ? "default" : "outline"} onClick={() => updateWeightUnit("lbs")}>lbs</Button>
                    </div>
                  </div>
                  <Input id="weight" type="number" step="0.1" min={0} value={weightInput} onChange={(e) => setWeightInput(e.target.value)} placeholder={weightUnit === "kg" ? "e.g. 72.4" : "e.g. 159.6"} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="water">Water intake (litres)</Label>
                  <Input id="water" type="number" step="0.25" min={0} max={20} value={waterLitres} onChange={(e) => setWaterAmount(Number(e.target.value))} />
                  <p className="text-xs text-muted-foreground">Synced with your home screen water tracker.</p>
                </div>
                <div className="space-y-4 border-t pt-4">
                  <p className="text-sm font-medium">Body measurements</p>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="waist-main">Waist Circumference ({lengthUnit})</Label>
                      <div className="flex gap-1">
                        <Button type="button" size="sm" variant={lengthUnit === "cm" ? "default" : "outline"} onClick={() => updateLengthUnit("cm")}>cm</Button>
                        <Button type="button" size="sm" variant={lengthUnit === "in" ? "default" : "outline"} onClick={() => updateLengthUnit("in")}>inches</Button>
                      </div>
                    </div>
                    <Input id="waist-main" type="number" step="0.1" min={0} value={waistInput} onChange={(e) => setWaistInput(e.target.value)} placeholder={lengthUnit === "cm" ? "e.g. 82" : "e.g. 32.3"} />
                    <p className="text-xs text-muted-foreground">Measured at navel height.</p>
                  </div>
                  {(() => {
                    const showHip = renderGender !== "male";
                    const showChest = renderGender !== "female";
                    return (
                      <>
                        {showHip && (
                          <div className="space-y-2">
                            <Label htmlFor="hip">Hip Circumference ({lengthUnit})</Label>
                            <Input id="hip" type="number" step="0.1" min={0} value={hipInput} onChange={(e) => setHipInput(e.target.value)} placeholder={lengthUnit === "cm" ? "e.g. 96" : "e.g. 37.8"} />
                          </div>
                        )}
                        {showChest && (
                          <div className="space-y-2">
                            <Label htmlFor="chest">Chest Circumference ({lengthUnit})</Label>
                            <Input id="chest" type="number" step="0.1" min={0} value={chestInput} onChange={(e) => setChestInput(e.target.value)} placeholder={lengthUnit === "cm" ? "e.g. 100" : "e.g. 39.4"} />
                          </div>
                        )}
                      </>
                    );
                  })()}
                  <div className="space-y-2">
                    <Label htmlFor="thigh">Upper Thigh Circumference ({lengthUnit})</Label>
                    <Input id="thigh" type="number" step="0.1" min={0} value={thighInput} onChange={(e) => setThighInput(e.target.value)} placeholder={lengthUnit === "cm" ? "e.g. 56" : "e.g. 22"} />
                  </div>
                </div>
                {([
                  ["general_wellbeing", "General Well-Being"],
                  ["fatigue", "Fatigue"],
                  ["sleep", "Sleep"],
                  ["headache", "Headache"],
                  ["pain", "Pain"],
                  ["joint_pain", "Joint Pain"],
                  ["acid_reflux", "Acid Reflux"],
                  ["digestion", "Digestion"],
                  ["allergy_skin", "Allergy / Skin"],
                ] as [string, string][]).map(([key, label]) => (
                  <div key={key} className="space-y-2">
                    <Label>{label} ({ratings[key]}/5)</Label>
                    <div className="grid grid-cols-5 gap-2">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Button
                          key={n}
                          type="button"
                          variant={ratings[key] === n ? "default" : "outline"}
                          size="sm"
                          onClick={() => setRating(key, n)}
                        >
                          {n}
                        </Button>
                      ))}
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>1 Best</span><span>5 Worst</span>
                    </div>
                  </div>
                ))}

                <div className="space-y-2">
                  <Label htmlFor="notes">Any notes for your nutritionist?</Label>
                  <Textarea id="notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
                <Button type="submit" className="w-full" disabled={submittingCheckin}>
                  {submittingCheckin ? "Submitting…" : "Submit check-in"}
                </Button>
              </form>
            </Card>
          ) : (
            <Card className="p-6 space-y-6">
              <div>
                <h2 className="text-lg font-semibold">Daily check-in</h2>
                <p className="text-sm text-muted-foreground">Let your nutritionist know how you're doing today.</p>
              </div>
              <form onSubmit={submitCheckin} className="space-y-5">
                <div className="space-y-2">
                  <Label>How are you feeling today? ({feeling}/5)</Label>
                  <input
                    type="range" min={1} max={5} value={feeling}
                    onChange={(e) => setFeeling(Number(e.target.value))}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>1 Bad</span><span>5 Great</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="water">How much water did you drink? (litres)</Label>
                  <Input id="water" type="number" step="0.25" min={0} max={20} value={waterLitres} onChange={(e) => setWaterAmount(Number(e.target.value))} />
                  <p className="text-xs text-muted-foreground">Synced with your home screen water tracker.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="notes">Any notes for your nutritionist?</Label>
                  <Textarea id="notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
                <Button type="submit" className="w-full" disabled={submittingCheckin}>
                  {submittingCheckin ? "Submitting…" : "Submit check-in"}
                </Button>
              </form>
            </Card>
          )}
        </section>
      )}

      {tab === "plan" && (
        <section className="max-w-3xl mx-auto p-4 space-y-4">
          <Card className="p-4">
            <p className="text-xs uppercase text-muted-foreground">Client</p>
            <p className="text-lg font-semibold">{client.name}</p>
            <p className="text-sm text-muted-foreground">Current phase: <span className="font-medium text-foreground">{phaseShort(client.phase)}</span></p>
          </Card>
          {!client.mb_pdf_path ? (
            <Card className="p-6 text-center space-y-4">
              <p className="font-medium">No meal plan uploaded yet</p>
              <p className="text-sm text-muted-foreground">
                Your practitioner will upload your personalised Metabolic Balance plan here.
              </p>
            </Card>
          ) : client.phase === "phase1" ? (
            <div className="space-y-4">
              <Card className="p-6 space-y-2">
                <p className="font-medium">Phase 1 — Preparation Phase</p>
                <p className="text-sm text-muted-foreground">
                  During the two-day Preparation Phase, your body is gently prepared for the journey ahead. This phase focuses on cleansing the intestinal tract, which helps reduce hunger and cravings later in the program.
                </p>
              </Card>

              <Card className="p-6 space-y-2 border-destructive/40">
                <p className="font-medium">⚠️ Important Notice</p>
                <p className="text-sm text-muted-foreground">
                  On the first day of Phase 1, complete a thorough intestinal cleanse to support your body's reset process. Speak with your coach or physician about the most suitable method for you. Options may include magnesium citrate oral solution, Epsom salt, or gentler alternatives such as an enema or colonic hydrotherapy. Do not attempt this without guidance.
                </p>
              </Card>

              <Card className="p-6 space-y-3">
                <p className="font-medium">Daily structure</p>
                <div className="text-sm space-y-3 text-muted-foreground">
                  <p><span className="font-medium text-foreground">In the morning:</span> Enjoy half the portion of your usual breakfast. For example, a one-egg vegetable omelette (without cheese) instead of your typical two-egg omelette.</p>
                  <p><span className="font-medium text-foreground">At lunchtime:</span> Homemade vegetable soup with up to 500g (1.1 lb) of fresh or frozen vegetables, served puréed or chunky. Use sugar-free vegetable broth with no additives. No chicken or beef broth. One apple on the side.</p>

                  <Collapsible>
                    <CollapsibleTrigger className="w-full text-left flex items-center justify-between rounded-md border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted/50">
                      <span>How to make your soup</span>
                      <span className="text-xs text-muted-foreground">Show / hide</span>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-3 space-y-3 text-sm text-muted-foreground">
                      <p className="font-medium text-foreground">How to make your vegetable soup</p>
                      <p><span className="font-medium text-foreground">What you need:</span> A large pot, a chopping board, a sharp knife, a digital kitchen scale, a wooden spoon, and a blender or hand/immersion blender (optional, for puréed soup).</p>
                      <p><span className="font-medium text-foreground">Ingredients:</span> Up to 500g of fresh or frozen vegetables from any combination you like — for example carrots, zucchini, spinach, cauliflower, leek, or celery. Use your scale to weigh them raw before cooking. Sugar-free vegetable broth with no additives (check the label — ingredients should be only vegetables, water, and salt). No chicken or beef broth. One apple on the side.</p>
                      <p><span className="font-medium text-foreground">Step 1 — Prepare your vegetables.</span> Wash all vegetables thoroughly under cold running water. Peel any that need peeling (like carrots). Place your pot on the counter with your chopping board beside it. Cut vegetables into rough chunks about 3–4cm (1.5 inches) — they don't need to be perfect, they're going to cook down. Weigh as you go so you don't exceed 500g total.</p>
                      <p><span className="font-medium text-foreground">Step 2 — Heat your pot.</span> Place your pot on the stove over medium heat. Pour in enough vegetable broth to cover the vegetables — roughly 750ml to 1 litre. Turn the heat to medium-high. You'll know it's ready when you see small bubbles forming and steam rising from the surface. This takes about 3–4 minutes.</p>
                      <p><span className="font-medium text-foreground">Step 3 — Add the vegetables.</span> Carefully add your chopped vegetables to the hot broth. Stir gently with your wooden spoon. The broth should cover the vegetables — if not, add a little more broth or water.</p>
                      <p><span className="font-medium text-foreground">Step 4 — Cook the soup.</span> Bring to a boil (you'll see vigorous bubbling), then immediately turn the heat down to low-medium. You want a gentle simmer — small bubbles breaking the surface, not a rolling boil. Put the lid on slightly ajar. Cook for 20–25 minutes. Check at 20 minutes by pressing a carrot piece with your spoon — if it squashes easily, the vegetables are done. If it's still firm, cook for another 5 minutes.</p>
                      <p><span className="font-medium text-foreground">Step 5 — Choose your texture.</span></p>
                      <p><span className="font-medium text-foreground">Chunky:</span> Your soup is ready. Season with a pinch of sea salt and a herb from your plan (thyme, parsley, or dill work well). Serve in a bowl.</p>
                      <p><span className="font-medium text-foreground">Puréed:</span> Remove the pot from the heat. If using a hand/immersion blender, insert it into the pot and blend until smooth — keep it below the surface to avoid splashing. If using a regular blender, let the soup cool for 5 minutes first, then pour in batches and blend. Be careful — hot liquid expands in a blender. Season and serve.</p>
                      <p><span className="font-medium text-foreground">Step 6 — Serve.</span> Ladle into a bowl and eat while warm. Have your apple on the side as part of this meal — not as a separate snack later.</p>
                      <div>
                        <p className="font-medium text-foreground">Important reminders:</p>
                        <ul className="list-disc list-inside space-y-1 mt-1">
                          <li>No oil, no butter, no cream</li>
                          <li>No chicken or beef broth — vegetable broth only, check the label for additives</li>
                          <li>All measurements are raw weight before cooking</li>
                          <li>Frozen vegetables work just as well as fresh — use the same weight</li>
                        </ul>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>

                  <p><span className="font-medium text-foreground">In the evening:</span> Up to 500g (1.1 lb) raw weight of cooked, steamed, or raw vegetables or salad, seasoned with herbs only. No processed or store bought herb and spice blends — use only individual dry or fresh herbs and spices mixed together by you. Also remember no oil, vinegar, or other dressings.</p>
                </div>
              </Card>

              <Card className="p-6 space-y-3">
                <p className="font-medium">Alternative option — eat just one type of food for the entire day</p>
                <p className="text-sm text-muted-foreground">You may choose one of the following instead:</p>
                <ul className="text-sm space-y-1 list-disc list-inside text-muted-foreground">
                  <li><span className="text-foreground font-medium">Fruit Day</span> — up to 1kg (2.2 lbs) of fruit, divided into 3 meals</li>
                  <li><span className="text-foreground font-medium">Vegetable Day</span> — up to 1.5kg (3.3 lbs) of vegetables, divided into 3 meals</li>
                  <li><span className="text-foreground font-medium">Potato Day</span> — up to 1.5kg (3.3 lbs) of potatoes, divided into 3 meals</li>
                  <li><span className="text-foreground font-medium">Rice Day</span> — up to 200g (½ lb) whole-grain brown rice, divided into 3 meals</li>
                </ul>
                <p className="text-sm text-muted-foreground">
                  You can enjoy vegetables raw, steamed, cooked, or puréed. Cook rice and potatoes in plain water only. You may use spices but no butter or oil.
                </p>
              </Card>

              <p className="text-xs text-muted-foreground text-center">
                Your full personal food list will be available when you move to Phase 2.
              </p>
            </div>
          ) : (
            <>
              <Card className="p-6 space-y-3">
                <p className="font-medium">The 8 Metabolic Balance Rules</p>
                <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                  {MB_RULES.map((r, i) => <li key={i}>{r}</li>)}
                </ol>
              </Card>

              <Card className="p-6">
                <p className="text-sm text-muted-foreground">
                  {client.phase === "phase2_strict" && "You are in the Strict Conversion Phase. Follow your personal food list exactly. No oil for the first 14 days. No substitutions."}
                  {client.phase === "phase2_extended" && "You are in the Extended Phase. You may enjoy one treat meal per week. Continue following your personal food list."}
                  {client.phase === "phase3" && (client.phase3_mode === "mb_standard"
                    ? "You are in the Relaxed Conversion Phase. Your personal food list has been expanded as part of your Metabolic Balance plan. You may test new foods gradually using the test and assess method. Treat meals are allowed once per week."
                    : "You are in the Relaxed Conversion Phase. Your food list has been expanded by your practitioner. You may test new foods gradually using the test and assess method. Treat meals are allowed once per week.")}
                  {client.phase === "phase4" && "You are in the Maintenance Phase. Your Phase 3 food list is shown below as a read-only shopping reference. The 8 Rules are now your lifestyle."}
                </p>
              </Card>

              {(client.phase === "phase3" || client.phase === "phase4") ? (() => {
                const groups: { title: string; field: keyof ClientState }[] = [
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
                const populated = groups
                  .map((g) => ({ title: g.title, items: parseList(client[g.field] as string) }))
                  .filter((g) => g.items.length > 0);
                if (client.phase === "phase4") {
                  const phase2Populated = categoriesFromFields(phase2ParsedGroups);
                  const renderReadonlySection = (items: { title: string; items: string[] }[]) => (
                    items.length > 0 ? (
                      <div className="grid gap-4 md:grid-cols-2">
                        {items.map((cat) => (
                          <Card key={cat.title} className="p-4">
                            <p className="font-medium mb-2">{cat.title}</p>
                            <ul className="text-sm space-y-1 list-disc list-inside text-muted-foreground">
                              {cat.items.map((it) => <li key={it}><span className="text-foreground">{it}</span></li>)}
                            </ul>
                          </Card>
                        ))}
                      </div>
                    ) : (
                      <Card className="p-4 text-sm text-muted-foreground">No data available</Card>
                    )
                  );
                  return (
                    <div className="space-y-6">
                      <div className="space-y-3">
                        <p className="font-medium">Phase 2 Food List</p>
                        {renderReadonlySection(phase2Populated)}
                      </div>
                      <div className="space-y-3">
                        <p className="font-medium">Phase 3 Food List</p>
                        {renderReadonlySection(populated)}
                      </div>
                    </div>
                  );
                }
                if (populated.length === 0) {
                  return (
                    <Card className="p-6 text-center space-y-2">
                      <p className="font-medium">No meal plan uploaded yet</p>
                      <p className="text-sm text-muted-foreground">
                        Your practitioner will upload your personalised Metabolic Balance plan here.
                      </p>
                    </Card>
                  );
                }
                return (
                  <div className="space-y-6">
                    <div className="space-y-3">
                      <div className="grid gap-4 md:grid-cols-2">
                        {populated.map((cat) => (
                          <Card key={cat.title} className="p-4">
                            <p className="font-medium mb-2">{cat.title}</p>
                            <ul className="text-sm space-y-1 list-disc list-inside text-muted-foreground">
                              {cat.items.map((it) => <li key={it}><span className="text-foreground">{it}</span></li>)}
                            </ul>
                          </Card>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })() : (

                <div className="grid gap-4 md:grid-cols-2">
                  {planCategories.map((cat) => (
                    <Card key={cat.title} className="p-4">
                      <p className="font-medium mb-2">{cat.title}</p>
                      <ul className="text-sm space-y-1 list-disc list-inside text-muted-foreground">
                        {cat.items.map((it) => <li key={it}><span className="text-foreground">{it}</span></li>)}
                      </ul>
                    </Card>
                  ))}
                </div>
              )}

              <p className="text-xs text-muted-foreground text-center pt-2">
                Quantities and exact selections are managed by your nutritionist. Use the Home tab to build today's meal.
              </p>
            </>
          )}
        </section>
      )}

      {tab === "planner" && client.phase !== "phase4" && (
        <section className="max-w-5xl mx-auto p-4">
          {client.phase === "phase1" ? (
            <Card className="p-6 text-sm text-muted-foreground">
              The Meal Planner unlocks once you begin Phase 2.
            </Card>
          ) : (
            <MealPlanner
              token={token!}
              filteredSources={filteredSources}
              weeklyFoodLimits={foodLimits}
              eggsMaxPerWeek={Number(foodLimits.eggs ?? 0) || null}
              onPlanChanged={(p) => setWeeklyPlan(p)}
              oilAllowed={oilAllowed(client.phase)}
              batchCookingMode={client.batch_cooking_mode ?? "3-day"}
            />

          )}
        </section>
      )}

      {tab === "messages" && client.phase === "phase4" && (
        <section className="max-w-3xl mx-auto p-4 space-y-3">
          <div>
            <h2 className="text-lg font-semibold">Messages</h2>
          </div>
          <ChatThread
            messages={messages.filter((m) => !(typeof m.body === "string" && m.body.includes("[AI-answered")))}
            viewerRole="client"
            onSend={sendMessage}
            sending={sendingMessage}
            placeholder={`Your plan includes AI-powered support. If you'd like to speak with ${client.practitioner_first_name ?? "your practitioner"} directly, you can book a paid 15 or 30-minute appointment.`}
            emptyHint={`Your plan includes AI-powered support. If you'd like to speak with ${client.practitioner_first_name ?? "your practitioner"} directly, you can book a paid 15 or 30-minute appointment.`}
          />
          <div title="Coming soon">
            <Button variant="outline" disabled className="w-full">Book a paid appointment</Button>
          </div>
        </section>
      )}
      {tab === "messages" && client.phase !== "phase4" && (
        <section className="max-w-3xl mx-auto p-4 space-y-3">
          <div>
            <h2 className="text-lg font-semibold">Messages</h2>
            <p className="text-xs text-muted-foreground">Chat with Cheryl. Replies usually arrive within a day or two.</p>
          </div>
          <ChatThread
            messages={messages.filter((m) => !(typeof m.body === "string" && m.body.includes("[AI-answered")))}
            viewerRole="client"
            onSend={sendMessage}
            sending={sendingMessage}
            placeholder="Write a message to Cheryl…"
            emptyHint="Say hello — Cheryl will see your message and reply here."
          />
        </section>
      )}

      {/* Bottom navigation */}
      <nav className="fixed bottom-0 inset-x-0 border-t bg-background">
        {(() => {
          const navItems = ([
            { key: "home", label: "Home", Icon: Home },
            { key: "planner", label: "Meal Planner", Icon: CalendarDays },
            { key: "checkin", label: "Check-in", Icon: ClipboardCheck },
            { key: "plan", label: "My Plan", Icon: BookOpen },
            { key: "messages", label: "Messages", Icon: MessageCircle },
          ] as { key: TabKey; label: string; Icon: typeof Home }[])
            .filter(({ key }) => !(client.phase === "phase4" && key === "planner"))
            .filter(({ key }) => !(phase4CheckinHidden && key === "checkin"));
          return (
        <div className={`max-w-5xl mx-auto grid`} style={{ gridTemplateColumns: `repeat(${navItems.length}, minmax(0, 1fr))` }}>
          {navItems.map(({ key, label, Icon }) => {
            const active = tab === key;
            const showBadge = key === "messages" && unreadMessages > 0;
            return (
              <button
                key={key}
                onClick={() => changeTab(key)}
                className={`flex flex-col items-center justify-center py-3 text-xs gap-1 transition-colors ${active ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
              >
                <span className="relative">
                  <Icon className="h-5 w-5" />
                  {showBadge && (
                    <span
                      aria-label={`${unreadMessages} unread message${unreadMessages === 1 ? "" : "s"}`}
                      className="absolute -top-1 -right-2 min-w-[16px] h-[16px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold flex items-center justify-center"
                    >
                      {unreadMessages > 9 ? "9+" : unreadMessages}
                    </span>
                  )}
                </span>
                {label}
              </button>
            );
          })}
        </div>
          );
        })()}
      </nav>


      <Dialog open={!!eggLogConfirm} onOpenChange={(o) => !o && setEggLogConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Over your weekly egg limit</DialogTitle>
          </DialogHeader>
          {eggLogConfirm && (
            <p className="text-sm text-muted-foreground">
              Adding this meal ({eggLogConfirm.eggsInMeal} eggs) would take you over your
              {" "}<span className="font-medium text-foreground">{eggLogConfirm.eggsMax}-egg</span> weekly limit
              ({eggLogConfirm.eggsUsed} used so far). Consider a different option — tap Regenerate for alternatives.
            </p>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEggLogConfirm(null)}>Cancel</Button>
            <Button
              onClick={async () => {
                if (!eggLogConfirm || !meal || !option) return;
                const c = eggLogConfirm;
                setEggLogConfirm(null);
                setLoggingIdx(c.idx);
                try {
                  const { data, error } = await supabase.functions.invoke("log-mb-meal", {
                    body: { token, meal_type: meal, option_label: option.label, ingredients: lastIngredients, recipe: c.recipe, force: true },
                  });
                  if (error) throw error;
                  if (data?.error) throw new Error(data.error);
                  setConfirmedRecipe(c.recipe);
                  setRecipeOptions([]);
                  toast.success(`Meal logged · ${data?.eggs_used_this_week ?? "?"} of ${data?.eggs_max_per_week ?? "?"} eggs used this week`);
                  await refresh();
                } catch (e: any) {
                  toast.error(e.message ?? "Failed to log meal");
                } finally {
                  setLoggingIdx(null);
                }
              }}
            >
              Log anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
