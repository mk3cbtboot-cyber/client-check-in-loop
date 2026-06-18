import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

interface Props {
  open: boolean;
  clientName: string;
  onDismiss: () => void;
}

const MB_RULES_LIST = [
  "Eat exactly 3 meals a day — nothing more, nothing less",
  "Wait at least 5 hours between meals",
  "Keep each meal under 60 minutes",
  "Always start with 1–2 bites of protein",
  "One protein type per meal",
  "No eating after 9pm",
  "Drink 35ml of water per kg of body weight daily",
  "Eat fruit with your meal or as dessert — never as a snack",
];

const CAPABILITIES = [
  "Generate recipes with step-by-step cooking instructions tailored to your food list",
  "Track your weekly food limits automatically",
  "Log your daily water intake towards your 2.5L target",
  "Build a meal streak and stay motivated",
  "Message your practitioner anytime",
  "Access the 8 Metabolic Balance Rules at any time",
];

export default function ClientWelcome({ open, clientName, onDismiss }: Props) {
  const firstName = (clientName || "").trim().split(/\s+/)[0] || "there";
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onDismiss(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">Welcome, {firstName}</DialogTitle>
          <DialogDescription className="text-base">
            Your Metabolic Balance™ journey starts here.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 text-sm">
          <p>
            The old saying that a journey of a thousand miles starts with a single step is never more true than right now. Congratulations {firstName} on taking your first step out of your comfort zone and moving towards gaining control of your health and fitness. This app has been built to help you with implementing your personal Metabolic Balance™ meal plan. It will help you build meals that follow your plan exactly, track your progress, and stay on course every day.
          </p>

          <div>
            <h3 className="font-semibold mb-2">What you can do</h3>
            <ul className="list-disc pl-5 space-y-1">
              {CAPABILITIES.map((c) => <li key={c}>{c}</li>)}
            </ul>
          </div>

          <div>
            <h3 className="font-semibold mb-2">Your phases</h3>
            <p>
              Your plan has 4 phases. Phase 1 (Preparation) lasts 2 days, then you
              move into Phase 2 (Strict Conversion) for a minimum of 14 days. Your
              practitioner will guide you through each phase.
            </p>
          </div>

          <Separator />

          <div>
            <h3 className="font-semibold mb-2">The 8 Metabolic Balance Rules</h3>
            <ol className="list-decimal pl-5 space-y-1">
              {MB_RULES_LIST.map((r) => <li key={r}>{r}</li>)}
            </ol>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={onDismiss} className="w-full sm:w-auto">Get Started</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
