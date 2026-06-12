// Parses egg counts from recipe/ingredient strings.
// Handles "2 eggs", "1 egg", "Eggs — 2 large", "Eggs: 2", "2 large eggs", etc.

export function eggsFromString(s: string): number {
  if (!s || !/egg/i.test(s)) return 0;
  // Try patterns in order of specificity.
  // "2 eggs" / "2 large eggs"
  let m = s.match(/(\d+)\s+(?:large|medium|small|extra[\s-]?large|whole|free[\s-]?range|organic)?\s*eggs?\b/i);
  if (m) return parseInt(m[1], 10);
  // "Eggs — 2", "Eggs: 2", "Eggs - 2 large"
  m = s.match(/eggs?\b[^0-9]{0,20}(\d+)/i);
  if (m) return parseInt(m[1], 10);
  // Bare leading number
  m = s.match(/^\s*(\d+)/);
  if (m) return parseInt(m[1], 10);
  return 0;
}

export function eggsFromIngredients(items: Array<string | { label?: string; qty?: string }>): number {
  let total = 0;
  for (const it of items ?? []) {
    if (typeof it === "string") total += eggsFromString(it);
    else {
      const label = it?.label ?? "";
      const qty = it?.qty ?? "";
      if (!/egg/i.test(`${label} ${qty}`)) continue;
      // Prefer qty count, fallback to combined string
      total += eggsFromString(`${qty} ${label}`) || eggsFromString(`${label} ${qty}`);
    }
  }
  return total;
}
