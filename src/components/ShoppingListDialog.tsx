import { useMemo, useState } from "react";
import { Share2, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  aggregateShopping,
  shoppingShareText,
  type ShoppingEntry,
} from "@/lib/shopping-list";

interface Props {
  entries: ShoppingEntry[];
  /** Line shown under the button and used as the share heading, e.g. "Next 7 days". */
  periodLabel: string;
  buttonLabel?: string;
  emptyMessage?: string;
}

export default function ShoppingListDialog({
  entries,
  periodLabel,
  buttonLabel = "Create shopping list",
  emptyMessage = "Your shopping list will appear once your plan is set.",
}: Props) {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const groups = useMemo(() => aggregateShopping(entries), [entries]);
  const shareText = useMemo(
    () => shoppingShareText(`Shopping List — ${periodLabel}`, groups),
    [groups, periodLabel],
  );

  const onShare = async () => {
    try {
      if (navigator.share) await navigator.share({ title: "Shopping List", text: shareText });
      else {
        await navigator.clipboard.writeText(shareText);
        toast.success("Copied to clipboard");
      }
    } catch {
      try {
        await navigator.clipboard.writeText(shareText);
        toast.success("Copied to clipboard");
      } catch {
        toast.error("Could not share");
      }
    }
  };

  return (
    <>
      <Button variant="default" onClick={() => setOpen(true)}>
        <ShoppingBag className="h-4 w-4" /> {buttonLabel}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader className="flex flex-row items-center justify-between">
            <div>
              <DialogTitle>Shopping List</DialogTitle>
              <p className="text-xs text-muted-foreground mt-1">{periodLabel}</p>
            </div>
            <Button size="sm" variant="outline" onClick={onShare}>
              <Share2 className="h-4 w-4" /> Share
            </Button>
          </DialogHeader>
          <div className="max-h-[65vh] overflow-y-auto space-y-4">
            {groups.length === 0 && (
              <p className="text-sm text-muted-foreground">{emptyMessage}</p>
            )}
            {groups.map(([cat, items]) => (
              <div key={cat} className="space-y-2">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{cat}</p>
                <ul className="space-y-1">
                  {items.map((it) => {
                    const isChecked = !!checked[it.key];
                    return (
                      <li key={it.key} className="flex items-start gap-2">
                        <Checkbox
                          id={`sl-${it.key}`}
                          checked={isChecked}
                          onCheckedChange={(v) =>
                            setChecked((p) => ({ ...p, [it.key]: !!v }))
                          }
                          className="mt-1"
                        />
                        <Label
                          htmlFor={`sl-${it.key}`}
                          className={`text-sm flex-1 cursor-pointer ${isChecked ? "line-through text-muted-foreground" : ""}`}
                        >
                          <span className="font-medium">{it.name}</span>
                          <span className="text-muted-foreground"> — {it.qty}</span>
                        </Label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
