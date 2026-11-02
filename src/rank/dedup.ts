import { words } from "./tokenize";

const SHINGLE_SIZE = 3;

function shingles(text: string): Set<string> {
  const w = words(text);
  const out = new Set<string>();
  if (w.length < SHINGLE_SIZE) {
    if (w.length) out.add(w.join(" "));
    return out;
  }
  for (let i = 0; i <= w.length - SHINGLE_SIZE; i++) out.add(w.slice(i, i + SHINGLE_SIZE).join(" "));
  return out;
}

/**
 * Overlap of two shingle sets relative to the smaller one. Using the smaller
 * set catches a passage that is quoted inside a longer one (syndicated copies,
 * abstracts repeated on landing pages).
 */
function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const s of small) if (large.has(s)) shared++;
  return shared / small.size;
}

/**
 * Keeps the first occurrence of each near-duplicate group, preserving order.
 * Pass items in rank order so the best-ranked copy survives.
 */
export function dedupeNearDuplicates<T>(items: T[], text: (item: T) => string, threshold = 0.6): T[] {
  const kept: { item: T; shingles: Set<string> }[] = [];
  for (const item of items) {
    const s = shingles(text(item));
    if (kept.some((k) => overlap(k.shingles, s) >= threshold)) continue;
    kept.push({ item, shingles: s });
  }
  return kept.map((k) => k.item);
}
