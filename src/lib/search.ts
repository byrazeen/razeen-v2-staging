/**
 * Search for the customer who already knows the perfume's name.
 *
 * The old store matched the English brand+name only, so anyone typing عود in
 * Arabic got nothing. Normalising both sides — and carrying aliases per product
 * — is the minimum for that journey to work at all.
 */
export function normalizeArabic(input: string): string {
  return input
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[ً-ْـ]/g, "")   // harakat + tatweel
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ؤئ]/g, "ء")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface Searchable { title: string; aliases?: string[]; }

/** Higher is better. 0 means no match. */
export function scoreMatch(query: string, item: Searchable): number {
  const q = normalizeArabic(query);
  if (!q) return 0;
  const haystacks = [item.title, ...(item.aliases ?? [])].map(normalizeArabic);
  let score = 0;
  for (const hay of haystacks) {
    if (hay === q) score = Math.max(score, 100);
    else if (hay.includes(q)) score = Math.max(score, 60);
    else {
      const tokens = q.split(" ").filter(Boolean);
      const hit = tokens.filter((t) => t.length >= 2 && hay.includes(t)).length;
      if (hit > 0) score = Math.max(score, 20 * hit);
    }
  }
  return score;
}

export function search<T extends Searchable>(query: string, items: T[], limit = 12): T[] {
  return items
    .map((item) => ({ item, score: scoreMatch(query, item) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.item);
}
