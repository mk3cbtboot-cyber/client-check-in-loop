// Free-text plan instructions shown to the client.
//
// These are guidance sentences captured from the plan document (preparation
// rules, meal-swap / treat-meal timing, combination frequency rules) or typed
// by the practitioner. They are never enforced by any gate — caps remain the
// only enforced mechanism.

export interface PlanInstruction {
  id: string;
  text: string;
  source: "parsed" | "practitioner";
  origin?: string;
}

const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `pi-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const normalise = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Stable content hash of the instruction list — order-independent and
 * whitespace/case-insensitive. Empty list -> "" (never gates).
 * Keep in sync with supabase/functions/_shared/plan-instructions-hash.ts.
 */
export function planInstructionsHash(raw: unknown): string {
  const texts = (Array.isArray(raw) ? raw : [])
    .map((r) => {
      if (!r || typeof r !== "object") return "";
      const t = (r as Record<string, unknown>).text;
      return typeof t === "string" ? normalise(t) : "";
    })
    .filter((t) => t.length > 0)
    .sort();
  if (!texts.length) return "";
  const s = texts.join("\n");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${texts.length}-${h.toString(16)}`;
}

/** Narrow an unknown jsonb value into the instruction list. */
export function parsePlanInstructions(raw: unknown): PlanInstruction[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r, i): PlanInstruction | null => {
      if (!r || typeof r !== "object") return null;
      const o = r as Record<string, unknown>;
      const text = typeof o.text === "string" ? o.text.replace(/\s+/g, " ").trim() : "";
      if (!text) return null;
      return {
        id: typeof o.id === "string" && o.id ? o.id : `pi-${i}`,
        text,
        source: o.source === "practitioner" ? "practitioner" : "parsed",
        origin: typeof o.origin === "string" && o.origin ? o.origin : undefined,
      };
    })
    .filter((x): x is PlanInstruction => x !== null);
}

export function makeInstruction(
  text: string,
  source: PlanInstruction["source"] = "parsed",
  origin?: string,
): PlanInstruction {
  return { id: uid(), text: text.replace(/\s+/g, " ").trim(), source, ...(origin ? { origin } : {}) };
}

/**
 * Merge newly parsed instructions into the existing list without clobbering
 * practitioner-authored entries. Duplicate text (case/space-insensitive) is
 * dropped so re-importing the same PDF does not stack repeats.
 */
export function mergeInstructions(
  existing: PlanInstruction[],
  incoming: PlanInstruction[],
): PlanInstruction[] {
  const out = [...existing];
  const seen = new Set(out.map((i) => normalise(i.text)));
  for (const item of incoming) {
    const key = normalise(item.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
