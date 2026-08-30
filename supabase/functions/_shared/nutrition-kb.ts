// Nutrition coaching knowledge base retrieval.
// Strictly a "why underneath the plan" grounding layer: the client's own plan
// data and practitioner notes always take precedence over anything here.
// Only wired into the Custom (recipe / food-list) branches — never MB.

export type KbIndexRow = { slug: string; title: string; summary: string; keywords: string[] };
export type KbArticle = KbIndexRow & { body: string };

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "have", "has", "had", "are", "was", "were", "you",
  "your", "yours", "can", "could", "should", "would", "what", "when", "why", "how", "does", "did",
  "not", "but", "from", "about", "into", "there", "their", "them", "they", "will", "just", "much",
  "more", "some", "any", "get", "got", "been", "being", "than", "then", "its", "it's", "i'm", "i've",
  "me", "my", "mine", "am", "is", "be", "do", "on", "in", "of", "to", "at", "as", "if", "or", "so",
  "eat", "eating", "food", "foods", "meal", "meals", "plan", "day", "days", "week",
]);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^['-]+|['-]+$/g, ""))
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/** Always-in-prompt index of what the knowledge base can explain. */
export function buildKbIndexBlock(rows: KbIndexRow[]): string {
  if (!rows.length) return "";
  const lines = rows.map((r) => `- ${r.title}: ${r.keywords.join(", ")}`);
  return `NUTRITION KNOWLEDGE BASE — TOPICS AVAILABLE (background reference only):\n${lines.join("\n")}`;
}

/**
 * Keyword/token scoring of the message against the index.
 * Returns slugs of the best 1-2 matches (empty when nothing meaningfully matches).
 */
export function scoreKbMatches(rows: KbIndexRow[], message: string, limit = 2): string[] {
  const msg = tokens(message);
  if (!msg.length) return [];
  const msgSet = new Set(msg);
  const scored = rows.map((r) => {
    let score = 0;
    for (const kw of r.keywords) {
      const kwTokens = tokens(kw);
      if (!kwTokens.length) continue;
      const hits = kwTokens.filter((t) => msgSet.has(t)).length;
      if (hits === kwTokens.length) score += 3 * kwTokens.length;
      else score += hits * 1.5;
    }
    for (const t of tokens(r.title)) if (msgSet.has(t)) score += 2;
    const summarySet = new Set(tokens(r.summary));
    for (const t of msgSet) if (summarySet.has(t)) score += 0.5;
    return { slug: r.slug, score };
  });
  return scored
    .filter((s) => s.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.slug);
}

/** The precedence rule that must sit above any injected KB body. */
export const KB_PRECEDENCE_RULE =
  "PRECEDENCE: the client's own plan data and practitioner notes above are always authoritative. " +
  "The reference material below is general nutrition education only — use it solely to explain the reasoning behind the plan. " +
  "Never use it to suggest foods, portions, or changes that are not in the client's plan, and never let it contradict the plan or a practitioner note. " +
  "If it conflicts with the plan or a practitioner note, follow the plan and say nothing about the conflict.";

export function buildKbBlock(articles: KbArticle[]): string {
  if (!articles.length) return "";
  const parts = articles.map((a) => `--- ${a.title} ---\n${a.summary}\n\n${a.body}`);
  return `${KB_PRECEDENCE_RULE}\n\nBACKGROUND REFERENCE MATERIAL (general nutrition education):\n${parts.join("\n\n")}`;
}

type AdminLike = {
  from: (t: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

/** Loads the index, picks the best 1-2 articles for the message, and returns index + full bodies. */
export async function retrieveKb(
  admin: AdminLike,
  message: string,
  limit = 2,
): Promise<{ indexBlock: string; kbBlock: string; matchedSlugs: string[] }> {
  try {
    const { data: idx } = await admin
      .from("nutrition_coaching_kb")
      .select("slug, title, summary, keywords");
    const rows: KbIndexRow[] = Array.isArray(idx)
      ? idx.map((r: any) => ({
          slug: String(r.slug),
          title: String(r.title),
          summary: String(r.summary ?? ""),
          keywords: Array.isArray(r.keywords) ? r.keywords.map(String) : [],
        }))
      : [];
    if (!rows.length) return { indexBlock: "", kbBlock: "", matchedSlugs: [] };

    const indexBlock = buildKbIndexBlock(rows);
    let slugs = scoreKbMatches(rows, message, limit);

    // Trigram fallback when keyword scoring finds nothing.
    if (!slugs.length) {
      const { data: m } = await admin.rpc("match_nutrition_kb", { _q: message, _limit: limit });
      const hits = Array.isArray(m) ? m.filter((r: any) => Number(r.score) >= 0.12) : [];
      if (hits.length) {
        return {
          indexBlock,
          kbBlock: buildKbBlock(
            hits.map((r: any) => ({
              slug: String(r.slug), title: String(r.title),
              summary: String(r.summary ?? ""), body: String(r.body ?? ""), keywords: [],
            })),
          ),
          matchedSlugs: hits.map((r: any) => String(r.slug)),
        };
      }
      return { indexBlock, kbBlock: "", matchedSlugs: [] };
    }

    const { data: full } = await admin
      .from("nutrition_coaching_kb")
      .select("slug, title, summary, body, keywords")
      .in("slug", slugs);
    const byslug = new Map<string, any>((Array.isArray(full) ? full : []).map((r: any) => [String(r.slug), r]));
    const articles: KbArticle[] = slugs
      .map((s) => byslug.get(s))
      .filter(Boolean)
      .map((r: any) => ({
        slug: String(r.slug), title: String(r.title),
        summary: String(r.summary ?? ""), body: String(r.body ?? ""),
        keywords: Array.isArray(r.keywords) ? r.keywords.map(String) : [],
      }));
    return { indexBlock, kbBlock: buildKbBlock(articles), matchedSlugs: articles.map((a) => a.slug) };
  } catch (e) {
    console.error("nutrition_kb: retrieval failed", e);
    return { indexBlock: "", kbBlock: "", matchedSlugs: [] };
  }
}
