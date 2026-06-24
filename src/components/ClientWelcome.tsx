import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

interface Props {
  open: boolean;
  clientName: string;
  planFormat?: string;
  practitionerDisplayName?: string;
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

const FOOD_LIST_FIRST_STEPS = [
  "View your meal plan on the Home tab and your approved foods are listed by meal",
  "Use Generate Recipes to get meal ideas built from your personal food list",
  "Tap I Ate This when you've eaten a meal to log your progress",
  "Track your water intake daily",
  "Complete your check-ins so your practitioner can see how you're going",
];

export default function ClientWelcome({
  open,
  clientName,
  planFormat,
  practitionerDisplayName,
  onDismiss,
}: Props) {
  const firstName = (clientName || "").trim().split(/\s+/)[0] || "there";
  const practitioner = practitionerDisplayName?.trim() || "your nutritionist";
  const isFoodList = planFormat === "food_list";
  const isRecipe = planFormat === "recipe";

  const customBody = isRecipe
    ? `The old saying that a journey of a thousand miles starts with a single step is never more true than right now. Congratulations, ${firstName}, on taking your first step out of your comfort zone and moving towards taking control of your health and fitness. This app has been built to help you put your personal meal plan, created by ${practitioner}, into practice. Your practitioner has created a set of personalised recipes to make it as easy as possible to follow your plan and reach your goals. It will also help you track your progress and stay connected to your nutritionist between appointments, so you can stay on track and give yourself the best chance of success.`
    : `The old saying that a journey of a thousand miles starts with a single step is never more true than right now. Congratulations, ${firstName}, on taking your first step out of your comfort zone and moving towards taking control of your health and fitness. This app has been built to help you put your personal meal plan, created by ${practitioner}, into practice. The recipe generator will help you create meals that make it easier to follow your plan and reach your goals. It will also help you track your progress and stay connected to your nutritionist between appointments, so you can stay on track and give yourself the best chance of success.`;

  const customFirstSteps = isRecipe
    ? [
        "View your meal plan on the Home tab and your approved foods are listed by meal",
        "Open a meal slot on the Home tab and tap a recipe to see the full ingredients and method.",
        "Tap I Ate This when you've eaten a meal to log your progress",
        "Track your water intake daily",
        "Complete your check-ins so your practitioner can see how you're going",
      ]
    : FOOD_LIST_FIRST_STEPS;

  const isCustom = isFoodList || isRecipe;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onDismiss(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">
            {isCustom ? `Welcome to Tenacia, ${firstName}.` : `Welcome, ${firstName}`}
          </DialogTitle>
          {!isCustom && (
            <DialogDescription className="text-base">
              Your Metabolic Balance™ journey starts here.
            </DialogDescription>
          )}
        </DialogHeader>

        {isCustom ? (
          <div className="space-y-5 text-sm">
            <p>{customBody}</p>

            <div>
              <h3 className="font-semibold mb-2">What to do first:</h3>
              <ul className="list-disc pl-5 space-y-1">
                {customFirstSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>
            </div>

            <p>Your plan is built around you and for you. Let's get to work.</p>
          </div>
        ) : (
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
        )}

        <DialogFooter>
          <Button onClick={onDismiss} className="w-full sm:w-auto">Get Started</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
