// Phase 1 — Preparation instructional content.
// Shared by the client portal My Plan tab and the practitioner Client Plan tab.
// Display only — no writes.
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export function MbPhase1Guide() {
  return (
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
  );
}

export default MbPhase1Guide;
