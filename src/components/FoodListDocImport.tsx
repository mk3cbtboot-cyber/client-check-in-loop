import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Trash2, Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { customSlotLabel } from "@/lib/meal-slots";

type FoodCategoryKind = "Protein" | "Carbs" | "Veg" | "Fat" | "Other";
interface FoodItem { name: string; portion: string; category: FoodCategoryKind }
type SlotKey = "breakfast" | "morning_snack" | "lunch" | "afternoon_snack" | "dinner";
type FoodList = Record<SlotKey, FoodItem[]>;

const CATEGORIES: FoodCategoryKind[] = ["Protein", "Carbs", "Veg", "Fat", "Other"];
const SLOT_ORDER: SlotKey[] = ["breakfast", "morning_snack", "lunch", "afternoon_snack", "dinner"];

function emptyList(): FoodList {
  return { breakfast: [], morning_snack: [], lunch: [], afternoon_snack: [], dinner: [] };
}

function normalizeList(raw: unknown): FoodList {
  const r = (raw ?? {}) as Partial<Record<SlotKey, unknown>>;
  const slot = (v: unknown): FoodItem[] =>
    Array.isArray(v)
      ? v.map((x) => {
          const o = (x ?? {}) as Record<string, unknown>;
          return {
            name: String(o.name ?? ""),
            portion: String(o.portion ?? ""),
            category: (CATEGORIES.includes(o.category as FoodCategoryKind) ? o.category : "Other") as FoodCategoryKind,
          };
        })
      : [];
  return {
    breakfast: slot(r.breakfast),
    morning_snack: slot(r.morning_snack),
    lunch: slot(r.lunch),
    afternoon_snack: slot(r.afternoon_snack),
    dinner: slot(r.dinner),
  };
}

interface Props {
  clientId: string;
  existingList: unknown;
  mealsPerDay: number;
  onSaved?: () => void;
}

export default function FoodListDocImport({ clientId, existingList, mealsPerDay, onSaved }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewList, setReviewList] = useState<FoodList>(emptyList());
  const [reviewExclusions, setReviewExclusions] = useState<string[]>([]);
  const [confirmReplaceOpen, setConfirmReplaceOpen] = useState(false);

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".pdf") && !lower.endsWith(".docx")) {
      toast.error("Only .docx or .pdf files are supported.");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      toast.error("File too large (max 15MB).");
      return;
    }
    setImporting(true);
    try {
      const data_base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const r = reader.result;
          if (typeof r === "string") resolve(r.split(",")[1] ?? "");
          else reject(new Error("read failed"));
        };
        reader.onerror = () => reject(reader.error ?? new Error("read failed"));
        reader.readAsDataURL(file);
      });
      const { data, error } = await supabase.functions.invoke("parse-foodlist-document", {
        body: { filename: file.name, mime: file.type || (lower.endsWith(".pdf") ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), data_base64 },
      });
      if (error || !data?.ok || !data?.food_list) {
        toast.error("We couldn't extract a food list from this document. Check that the document contains a meal plan with foods listed by meal, then try again. You can also add foods manually using the Add food button.");
        return;
      }
      setReviewList(normalizeList(data.food_list));
      const exc = Array.isArray((data as { exclusions?: unknown }).exclusions)
        ? ((data as { exclusions: unknown[] }).exclusions).map((x) => String(x ?? "").trim()).filter((x) => x.length > 0)
        : [];
      setReviewExclusions(exc);
      setReviewOpen(true);
    } catch (err) {
      console.error(err);
      toast.error("We couldn't extract a food list from this document. Check that the document contains a meal plan with foods listed by meal, then try again. You can also add foods manually using the Add food button.");
    } finally {
      setImporting(false);
    }
  }

  function reviewRemove(slot: SlotKey, idx: number) {
    setReviewList((prev) => ({ ...prev, [slot]: prev[slot].filter((_, i) => i !== idx) }));
  }

  function reviewTotal(): number {
    return (Object.keys(reviewList) as SlotKey[]).reduce((n, k) => n + reviewList[k].length, 0);
  }

  function existingTotal(): number {
    const l = normalizeList(existingList);
    return (Object.keys(l) as SlotKey[]).reduce((n, k) => n + l[k].length, 0);
  }

  function onConfirmReview() {
    if (reviewTotal() === 0) {
      toast.error("Nothing to save.");
      return;
    }
    if (existingTotal() > 0) {
      setConfirmReplaceOpen(true);
      return;
    }
    void doSaveImport();
  }

  async function doSaveImport() {
    setConfirmReplaceOpen(false);
    const { error } = await supabase.from("clients").update({ food_list: reviewList } as never).eq("id", clientId);
    if (error) {
      toast.error("Failed to save food list");
      return;
    }
    setReviewOpen(false);
    toast.success("Food list imported.");
    onSaved?.();
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={handleFileSelected}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={importing}
        onClick={() => fileInputRef.current?.click()}
      >
        {importing ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Upload className="h-3 w-3 mr-1" />}
        {importing ? "Parsing…" : "Upload PDF/Doc"}
      </Button>

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review imported foods</DialogTitle>
            <DialogDescription>
              Review the imported foods below. You can remove anything that doesn't look right and edit further after saving.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {SLOT_ORDER.map((k) => {
              const items = reviewList[k];
              if (!items || items.length === 0) return null;
              return (
                <div key={k} className="rounded-md border p-3">
                  <h4 className="text-sm font-semibold mb-2">{customSlotLabel(k, mealsPerDay)}</h4>
                  <ul className="space-y-1.5">
                    {items.map((it, idx) => (
                      <li key={idx} className="flex items-start justify-between gap-2 rounded border p-2 text-xs">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate">{it.name}</p>
                          <p className="text-muted-foreground">
                            {it.portion || "—"} · <span className="uppercase tracking-wide">{it.category}</span>
                          </p>
                        </div>
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => reviewRemove(k, idx)} aria-label="Remove food">
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            {reviewTotal() === 0 && (
              <p className="text-sm text-muted-foreground">No foods remaining. Cancel and try a different document.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewOpen(false)}>Cancel</Button>
            <Button onClick={onConfirmReview} disabled={reviewTotal() === 0}>Confirm and save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmReplaceOpen} onOpenChange={setConfirmReplaceOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace existing food list?</AlertDialogTitle>
            <AlertDialogDescription>
              This will replace the existing food list for this client. Are you sure?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void doSaveImport()}>Replace</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
