export const MB_FOODS = {
  fish: ["Anchovies","Carp","Catfish","Comber","Flounder","Herring","Kipper (in Water)","Pikeperch","Sea Bass","Sole","Trout","Wild Pacific Salmon"],
  seafood: ["Clams","Shrimps","Squid/Octopus","Tiny Shrimps"],
  poultry: ["Chicken Breast","Duck Breast"],
  meat: ["Beef Fillet","Ham (cooked)","Lamb Loin","Rabbit","Veal","Venison"],
  cheese: ["Cottage Cheese","Feta Cheese (Sheep)","Fresh Mozzarella","Goat Cream Cheese (Chèvre)","Paneer","Ricotta","Sheep's Cream Cheese"],
  legumes: ["Chickpeas","Lima Beans","Red Lentils","Urad Beans","White Beans","Yellow Lentils"],
  yogurt: ["Natural Yogurt 3.8%"],
  milkProducts: ["Cow Milk 3.8%"],
  vegetables: ["Artichokes","Avocado","Black Olives","Button Mushrooms","Carrots","Cauliflower","Celeriac","Fennel","Garden Radish","Green Cabbage","Horseradish","Kale","Kohlrabi","Leek","Okra","Pickles (fresh dill/sugar free)","Pumpkin","Red Bell Pepper","Rutabaga","Savoy Cabbage","Sorrel","Spinach","Swiss Chard","Turnips","White Asparagus","Zucchini"],
  vegLettuce: ["Bibb/Boston/Butter Lettuce","Cucumber","Dandelion Leaves","Frisee Lettuce","Mâché (Lamb's Lettuce)","Oak Leaf Lettuce","Radicchio","Red Leaf Lettuce","Romaine Lettuce"],
  fruit: ["Apple (1)","Gooseberries (100g)","Mango (160g)","Papaya (170g)","Peach (1)","Prunes/Dried (40g)"],
  bread: ["100% Rye Crackers (10g)","100% Sourdough Rye Bread (25g)"],
  starch: ["Rolled Oats (50g)"],
  oils: [],
};


export type MealType = "breakfast" | "lunch" | "dinner";

export interface OptionDef {
  id: number;
  label: string;
  components: { key: string; label: string; qty: string; sources: (keyof typeof MB_FOODS)[]; optional?: boolean }[];
  fixed?: { label: string; qty: string }[]; // ingredients with no choice (e.g. eggs)
}

export const MB_OPTIONS: Record<MealType, OptionDef[]> = {
  breakfast: [
    { id: 1, label: "Yogurt + Fruit",
      components: [
        { key: "yogurt", label: "Yogurt", qty: "200g", sources: ["yogurt"] },
        { key: "fruit", label: "Fruit", qty: "as listed", sources: ["fruit"] },
      ] },
    { id: 2, label: "Milk + Oatmeal + Fruit",
      components: [
        { key: "milk", label: "Milk", qty: "200ml", sources: ["milkProducts"] },
        { key: "oats", label: "Oatmeal", qty: "50g", sources: ["starch"] },
        { key: "fruit", label: "Fruit", qty: "as listed", sources: ["fruit"] },
      ] },
    { id: 3, label: "Poultry + Veg/Lettuce + Fruit + Bread",
      components: [
        { key: "poultry", label: "Poultry", qty: "85g", sources: ["poultry"] },
        { key: "veg1", label: "Vegetable 1", qty: "95g (combined)", sources: ["vegetables","vegLettuce"] },
        { key: "veg2", label: "Vegetable 2 (optional)", qty: "", sources: ["vegetables","vegLettuce"], optional: true },
        { key: "fruit", label: "Fruit", qty: "as listed", sources: ["fruit"] },
        { key: "bread", label: "Bread", qty: "as listed", sources: ["bread"] },
      ] },
  ],
  lunch: [
    { id: 1, label: "Eggs + Vegetables + Fruit + Bread",
      fixed: [{ label: "Eggs", qty: "2 eggs" }],
      components: [
        { key: "veg1", label: "Vegetable 1", qty: "140g (combined)", sources: ["vegetables"] },
        { key: "veg2", label: "Vegetable 2 (optional)", qty: "", sources: ["vegetables"], optional: true },
        { key: "fruit", label: "Fruit", qty: "as listed", sources: ["fruit"] },
        { key: "bread", label: "Bread", qty: "as listed", sources: ["bread"] },
      ] },
    { id: 2, label: "Legumes + Vegetables + Fruit + Bread",
      components: [
        { key: "legumes", label: "Legumes", qty: "75g", sources: ["legumes"] },
        { key: "veg1", label: "Vegetable 1", qty: "140g (combined)", sources: ["vegetables"] },
        { key: "veg2", label: "Vegetable 2 (optional)", qty: "", sources: ["vegetables"], optional: true },
        { key: "fruit", label: "Fruit", qty: "as listed", sources: ["fruit"] },
        { key: "bread", label: "Bread", qty: "as listed", sources: ["bread"] },
      ] },
    { id: 3, label: "Cheese + Vegetables + Fruit + Bread",
      components: [
        { key: "cheese", label: "Cheese", qty: "85g", sources: ["cheese"] },
        { key: "veg1", label: "Vegetable 1", qty: "140g (combined)", sources: ["vegetables"] },
        { key: "veg2", label: "Vegetable 2 (optional)", qty: "", sources: ["vegetables"], optional: true },
        { key: "fruit", label: "Fruit", qty: "as listed", sources: ["fruit"] },
        { key: "bread", label: "Bread", qty: "as listed", sources: ["bread"] },
      ] },
  ],
  dinner: [
    { id: 1, label: "Fish + Veg/Lettuce + Fruit + Bread",
      components: [
        { key: "fish", label: "Fish or Seafood", qty: "140g", sources: ["fish","seafood"] },
        { key: "veg1", label: "Vegetable 1", qty: "150g (combined)", sources: ["vegetables","vegLettuce"] },
        { key: "veg2", label: "Vegetable 2 (optional)", qty: "", sources: ["vegetables","vegLettuce"], optional: true },
        { key: "fruit", label: "Fruit", qty: "as listed", sources: ["fruit"] },
        { key: "bread", label: "Bread", qty: "as listed", sources: ["bread"] },
      ] },
    { id: 2, label: "Poultry + Vegetables + Fruit + Bread",
      components: [
        { key: "poultry", label: "Poultry", qty: "140g", sources: ["poultry"] },
        { key: "veg1", label: "Vegetable 1", qty: "150g (combined)", sources: ["vegetables"] },
        { key: "veg2", label: "Vegetable 2 (optional)", qty: "", sources: ["vegetables"], optional: true },
        { key: "fruit", label: "Fruit", qty: "as listed", sources: ["fruit"] },
        { key: "bread", label: "Bread", qty: "as listed", sources: ["bread"] },
      ] },
    { id: 3, label: "Meat + Vegetables + Fruit + Bread",
      components: [
        { key: "meat", label: "Meat", qty: "140g", sources: ["meat"] },
        { key: "veg1", label: "Vegetable 1", qty: "150g (combined)", sources: ["vegetables"] },
        { key: "veg2", label: "Vegetable 2 (optional)", qty: "", sources: ["vegetables"], optional: true },
        { key: "fruit", label: "Fruit", qty: "as listed", sources: ["fruit"] },
        { key: "bread", label: "Bread", qty: "as listed", sources: ["bread"] },
      ] },
  ],
};

export const MB_RULES = [
  "Eat only 3 meals a day with no snacks in between.",
  "Leave at least 5 hours between meals.",
  "Do not eat for longer than 60 minutes per meal.",
  "Start every meal with a bite of protein.",
  "Eat only one type of protein per meal.",
  "Eat one piece of fruit with every meal (eaten last).",
  "Drink 2.5+ litres of still water or unsweetened tea per day.",
  "Finish your last meal before 9pm.",
];
