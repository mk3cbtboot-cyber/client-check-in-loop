// Metabolic Balance programme guidance.
// Phase-specific sections swap with the practitioner's Phase selector; the
// treat-meal guidelines appear from Phase 2 Extended onward; the remaining
// sections are permanent and shown on every phase.
// Display only — no writes. Shared by the client My Plan tab and the
// practitioner Client Plan mirror.
import { Card } from "@/components/ui/card";

type Para = string;

const PHASE_CONTENT: Record<string, { title: string; paras: Para[] }> = {
  phase2_strict: {
    title: "Phase 2 — Strict Conversion",
    paras: [
      "You should stay on Phase 2 / Strict Conversion Phase for a minimum of 14 days. From the beginning of Phase 2 all 8 Rules apply. Please be very accurate in the first 14 days and use only items from your personal food list in the amounts indicated. No substitutions are allowed, i.e. a type of lettuce with another that is not listed in the plan.",
      "Using Your Meal Plan: Your meal plan serves as a flexible template filled with foods from your personal food list. To ensure variety and meet your body's nutritional needs, try to include a broad range of items from your list.",
      "While you typically follow the plan's suggestions for breakfast, lunch, and dinner, you can swap lunch and dinner if you prefer. However, remember that portion sizes differ: Swapping lunch for dinner: Add 10g to both the protein and vegetables/lettuce. Swapping dinner for lunch: Subtract 10g from both the protein and vegetables/lettuce. For example, if lunch calls for 115g of fish and dinner for 80g of cheese, swapping them would mean having 70g of cheese for lunch and 125g of fish for dinner.",
      "Practical Tips for Success: Eat mindfully, savoring the foods that are best suited for your body. You may even discover new foods or cooking methods you haven't tried before.",
      "Please keep in mind that both physical and emotional stress can negatively affect your willpower. During this time, you can replace intense physical activity with moments of quality self-care.",
      "Avoid Temptations: To stay on track, it may help to avoid situations that could challenge your focus, such as family gatherings or dinner invitations during the first 14 days.",
      "After the first two weeks of the Strict Conversion Phase, you can begin to add workouts back into your routine. When you include exercise in your day, it's important to adjust your nutrition to support your activity levels — add 20-30 grams of extra protein and carbohydrates to one of your meals that day, ideally your post-workout meal.",
      "Keeping a personal progress log can be a powerful way to track your journey. Consider reflecting daily on: What was important today? What went well today?",
      "Embracing Your New Lifestyle: Slow down, savor your meals, and enjoy every bite. Whenever possible, choose local and organic foods to further enhance your new, healthy lifestyle.",
    ],
  },
  phase2_extended: {
    title: "Phase 2 Extended — Oils and Treat Meals",
    paras: [
      "If you are still working towards a desired weight goal, you will stay in Phase 2 extended, where you will add in oils and the occasional treat meal. If you have achieved your desired weight goal you can proceed to Phase 3.",
      "It's very important whether you're working towards a desired goal or moving to Phase 3 that you add in the oils. Aim for 3 tbsp daily of good quality oils — consult with your coach to determine which oils to use. Ideally 1 tbsp per meal will support stable blood sugars.",
      "Treat meals can be introduced only after the first 16 days, at the earliest. As you approach or reach your goal, allow yourself to indulge in what you truly crave. Choose mindfully, savor each bite, and enjoy the moment — free from any guilt. Follow the 8 Treat Meal Guidelines below to make the most of each experience.",
      "Notice your heightened sense of smell and taste, your feelings of fullness, or perhaps even a newfound dislike for some of your former favorite foods. Embrace your body's messages, and don't hesitate to stop eating if needed.",
    ],
  },
  phase3: {
    title: "Phase 3 — Relaxed Conversion",
    paras: [
      "Congratulations — you have reached an important milestone! Your food list and meal plan have now been extended. In addition, you gradually add new foods, which are not on your personal food list, to see how well you tolerate them. The 8 Rules remain unchanged and still apply. You may now enjoy an occasional Treat Meal, limited to once per week.",
      "Introduce no more than one new food per day. When trying a new food, pay close attention to how your body responds. Do you feel energized, or are there any digestive issues? If a food suits you well, it can become a permanent part of your plan.",
      "As you reach the end of Phase 3, keep tuning into your body's natural signals:",
      "Gradually introduce larger portions. Begin by adding a starch, like wild rice or potatoes, to your lunch.",
      "You may increase the amount of food you consume at lunch by 10g every week (5g carbohydrate + 5g protein). Carefully observe your hunger and satiety during this time.",
      "You may wish to note in a diary how new foods made you feel and how they affected your weight.",
      "It's crucial to continue working closely with your coach during Phase 3.",
    ],
  },
  phase4: {
    title: "Phase 4 — Maintenance",
    paras: [
      "Congratulations — you did it! You have reached your target weight and improved your well-being. The idea of Phase 4 is to maintain your success for the long-term. The 8 Rules will continue to apply in everyday life.",
      "In addition: stay active throughout your day — take the stairs, walk instead of drive, park further away. Incorporate regular workouts (strength training, cardio, or yoga) 2-4 times per week. Prioritize quality sleep — getting to bed before midnight supports metabolism and recovery. Spend time in fresh air and sunlight. Take time for mindfulness practices like meditation or deep breathing.",
      "Stay mindful of your carbohydrate intake, focusing on options with a low Glycemic Load (GL). Whenever possible, stick to the foods from your personal list, and continue your daily exercise routine. The more you adhere to the 8 Rules, the easier it will be to maintain your target weight and enjoy lasting success.",
      "Remember, you're always welcome to start your plan again whenever you feel ready for a fresh boost.",
    ],
  },
};

const TREAT_MEAL_GUIDELINES = [
  "You may enjoy a Treat Meal once a week. As always start your Treat Meal with a little bite of your protein portion.",
  "Drink water before and after your Treat Meal.",
  "If the meal lasts longer than one hour, please take a break of at least 15 minutes, during which you may only drink water. Then continue your meal again with some bites of protein.",
  "If you are eating out, take a few nuts or some cheese with you — so you have a protein appetizer on the go.",
  "For the remaining meals that day please omit fruit and additional starchy foods such as bread.",
  "Avoid rich, heavy sauces and carbohydrate-laden side dishes.",
  "If you enjoy chocolate, always opt for a minimum of 70% cocoa content, eat only a small amount and slowly savor the smell, texture and taste.",
  "Limit your consumption of alcoholic beverages and remember to drink plenty of water alongside any alcohol.",
];

const REASONS: { heading: string; body: string }[] = [
  {
    heading: "1, 2, 3 & 6 — Meal timing",
    body: "Eat exactly three meals a day, each lasting a maximum of one hour. After the end of one meal and before beginning the next meal, take a break of at least five hours (maximum seven). Ideally, at least twice a week, extend the overnight break between meals to 14 hours. During the five hour break between meals, and particularly during the night, insulin levels drop very low, allowing for fat to be burned easily. If you snack between meals, insulin remains constantly elevated, which encourages your body to synthesize fat rather than build muscle, and can block the production of hormones that protect the body from inflammation and aging.",
  },
  {
    heading: "4 — Protein first",
    body: "Always begin each meal with one or two bites of protein. When the stomach receives protein first, the pancreas reacts by secreting the hormone glucagon — the antagonist of insulin. This results in a lower insulin level, which stimulates fat burning, blocks fat synthesis, and prevents hunger.",
  },
  {
    heading: "5 — One protein per meal",
    body: "Eat only one type of protein per meal, from a different protein group for each of your three meals. The critical factor for metabolism isn't the overall quantity of protein consumed, but the spectrum of essential amino acids it contains — the eight essential amino acids are especially important since the body can't synthesize them. The ideal amino acid ratio is found in egg yolk (Biological Value of 100). Combining different protein foods is not recommended, as it can actually lower their overall Biological Value and lead to over-acidification of the body.",
  },
  {
    heading: "7 — Water",
    body: "If you drink less than the amount of water stated on your plan (in general: a minimum of 35ml of water per kg of body weight), you will lose weight more slowly. Water cleanses the body, supports all biological processes, and helps remove waste products.",
  },
  {
    heading: "8 — Fruit",
    body: "There's an old English proverb: 'An apple a day keeps the doctor away.' In addition to being both cholesterol and uric acid lowering, apple provides valuable fiber (pectin and cellulose) that helps with efficient excretion of waste products, plus vitamins, minerals, and trace elements.",
  },
];

const EXPERT_TIPS = [
  "Raw Weight Matters: The amounts in your meal plan reflect the raw weight of foods.",
  "Cooked Beans & Lentils: If using cooked beans or lentils, double the amount stated in your plan.",
  "Frozen Foods: Use the same weight for frozen fruits and vegetables as fresh ones. For frozen meat, poultry, or fish, add 25g to the stated raw weight to account for water loss during thawing.",
  "You can mix vegetables or lettuce for variety — for example, substitute 10g of onions for 10g of spinach if both are on your personal food list.",
  "Add flavor using fresh or dried herbs and spices, as long as they are free of additives and sugar.",
  "Moderate salt is essential due to your increased water intake — choose unrefined options like sea salt, Himalayan salt, or Rock salt for valuable minerals.",
  "Presentation matters — taking the time to set the table and make your food visually appealing enhances the eating experience.",
  "If you have a favorite restaurant, don't hesitate to speak with the chef about preparing dishes that align with your food plan. Most are happy to accommodate.",
  "Keep your routine flexible by preparing meals ahead of time. A meal prepared the night before can make your day hassle-free.",
];

const ADDITIONAL_INFO: { heading: string; body: string }[] = [
  {
    heading: "Water",
    body: "In general you can go by a minimum of 35ml of water per kg of body weight / ½ fl.oz per lb of body weight. Please adjust your water intake once you've lost weight, together with your coach.",
  },
  {
    heading: "Vegetables",
    body: "Enjoy your vegetables al dente (firm to the bite) or raw, depending on the kind of vegetable. Additive-free frozen vegetables are fine. Note: the vegetables and lettuce section on your meal plan is one category and can be mixed.",
  },
  {
    heading: "Herbs and Spices",
    body: "Use fresh or dried herbs in moderate quantities. One tbsp of pure apple cider or balsamic vinegar is fine for a salad dressing. No oil for the first 14 days of the Strict Conversion Phase. Garlic and ginger are always allowed even if not indicated on your list.",
  },
  { heading: "Bread", body: "Bread is optional — you don't need to eat it if you don't want to." },
  {
    heading: "Fruits",
    body: "Enjoy your fruits with meals or as a dessert right after. If possible, choose organic apples, ideally older or more traditional varieties such as Granny Smith. Frozen fruit is fine if free from added sugar and additives. Canned fruit is not allowed.",
  },
  {
    heading: "Tea and Coffee",
    body: "Please drink tea or coffee only with meals. Forgo milk and sugar as well as artificial sweeteners, and don't use any flavored tea or coffee.",
  },
  {
    heading: "Alcohol, Soft Drinks and Fruit Juices",
    body: "Not allowed in the Strict Conversion Phase.",
  },
  {
    heading: "Vitamins",
    body: "Vitamins are lost during cooking — if possible, eat some fruit and vegetables raw or lightly steamed. Consult with your coach as to whether a multivitamin and/or mineral supplement is advisable for you.",
  },
];

const TREAT_PHASES = new Set(["phase2_extended", "phase3", "phase4"]);

export function MbProgramGuide({ phase }: { phase: string | null | undefined }) {
  const p = String(phase ?? "");
  if (p === "phase1") return null;
  const phaseContent = PHASE_CONTENT[p];

  return (
    <div className="space-y-4">
      {phaseContent && (
        <Card className="p-6 space-y-2">
          <p className="font-medium">{phaseContent.title}</p>
          <div className="space-y-2 text-sm text-muted-foreground">
            {phaseContent.paras.map((t, i) => (
              <p key={i}>{t}</p>
            ))}
          </div>
        </Card>
      )}

      {TREAT_PHASES.has(p) && (
        <Card className="p-6 space-y-2">
          <p className="font-medium">8 Guidelines for Treat Meals</p>
          <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
            {TREAT_MEAL_GUIDELINES.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ol>
        </Card>
      )}

      <Card className="p-6 space-y-3">
        <p className="font-medium">The Reasons Behind the 8 Rules</p>
        <div className="space-y-3 text-sm text-muted-foreground">
          {REASONS.map((r) => (
            <p key={r.heading}>
              <span className="font-medium text-foreground">{r.heading}:</span> {r.body}
            </p>
          ))}
        </div>
      </Card>

      <Card className="p-6 space-y-2">
        <p className="font-medium">Expert Tips for Everyday Life</p>
        <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
          {EXPERT_TIPS.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      </Card>

      <Card className="p-6 space-y-3">
        <p className="font-medium">Additional Information About the Meal Plan</p>
        <div className="space-y-2 text-sm text-muted-foreground">
          {ADDITIONAL_INFO.map((r) => (
            <p key={r.heading}>
              <span className="font-medium text-foreground">{r.heading}:</span> {r.body}
            </p>
          ))}
        </div>
      </Card>
    </div>
  );
}

export default MbProgramGuide;
