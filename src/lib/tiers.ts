export type PractitionerTier = "metabolic_rx" | "practitioner_rx" | "custom_rx";

export const TIERS: { value: PractitionerTier; label: string; short: string; description: string; details: string[] }[] = [
  {
    value: "metabolic_rx",
    label: "Metabolic Rx",
    short: "MB",
    description: "Metabolic Balance® only.",
    details: [
      "MB food lists, meal formats and recipe generator",
      "Custom plan formats hidden",
    ],
  },
  {
    value: "practitioner_rx",
    label: "Practitioner Rx",
    short: "MB + Custom",
    description: "Metabolic Balance® plus your own custom plans.",
    details: [
      "All MB features",
      "Switch any client between MB and Custom",
    ],
  },
  {
    value: "custom_rx",
    label: "Custom Rx",
    short: "Custom",
    description: "Your own custom protocols only.",
    details: [
      "MB-specific options and toggle hidden",
      "All clients use Custom plans",
    ],
  },
];

export function tierLabel(t: PractitionerTier | null | undefined): string {
  return TIERS.find((x) => x.value === t)?.label ?? "";
}

export function tierShowsMb(t: PractitionerTier | null | undefined): boolean {
  return t === "metabolic_rx" || t === "practitioner_rx";
}

export function tierShowsCustom(t: PractitionerTier | null | undefined): boolean {
  return t === "custom_rx" || t === "practitioner_rx";
}

export function tierShowsToggle(t: PractitionerTier | null | undefined): boolean {
  return t === "practitioner_rx";
}

export function defaultSystemMode(t: PractitionerTier | null | undefined): "mb" | "own_practice" {
  return t === "custom_rx" ? "own_practice" : "mb";
}
