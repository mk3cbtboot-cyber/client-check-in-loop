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

/** Creation gating: can this tier CREATE new MB clients / convert into MB? */
export function tierCanCreateMb(t: PractitionerTier | null | undefined): boolean {
  return tierShowsMb(t);
}

/** Creation gating: can this tier CREATE new Custom clients / convert into Custom? */
export function tierCanCreateCustom(t: PractitionerTier | null | undefined): boolean {
  return tierShowsCustom(t);
}

export function tierAllowsType(t: PractitionerTier | null | undefined, type: "mb" | "custom"): boolean {
  return type === "mb" ? tierCanCreateMb(t) : tierCanCreateCustom(t);
}

/**
 * Count-aware warning shown before switching practice type.
 * Returns null when the switch restricts nothing the practitioner is using.
 * Never implies data loss — existing clients are grandfathered.
 */
export function tierTransitionWarning(
  next: PractitionerTier,
  counts: { mb: number; custom: number },
): string | null {
  const label = tierLabel(next);
  if (!tierCanCreateMb(next) && counts.mb > 0) {
    return `Switching to ${label}. You have ${counts.mb} Metabolic Balance client${counts.mb === 1 ? "" : "s"}; they stay fully accessible and editable, but you will not be able to create new MB clients. No data is deleted.`;
  }
  if (!tierCanCreateCustom(next) && counts.custom > 0) {
    return `Switching to ${label}. You have ${counts.custom} Custom client${counts.custom === 1 ? "" : "s"}; they stay fully accessible and editable, but you will not be able to create new Custom clients. No data is deleted.`;
  }
  return null;
}

export function defaultSystemMode(t: PractitionerTier | null | undefined): "mb" | "own_practice" {
  return t === "custom_rx" ? "own_practice" : "mb";
}

