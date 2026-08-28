// Stable content hash of a client's plan instructions.
// Order-independent, whitespace/case-insensitive. Keep in sync with
// src/lib/plan-instructions.ts (planInstructionsHash).

export function planInstructionsHash(raw: unknown): string {
  const texts = (Array.isArray(raw) ? raw : [])
    .map((r) => {
      if (!r || typeof r !== "object") return "";
      const t = (r as Record<string, unknown>).text;
      return typeof t === "string" ? t.replace(/\s+/g, " ").trim().toLowerCase() : "";
    })
    .filter((t) => t.length > 0)
    .sort();
  if (!texts.length) return "";
  const s = texts.join("\n");
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${texts.length}-${h.toString(16)}`;
}
