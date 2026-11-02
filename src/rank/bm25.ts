import { tokenize } from "./tokenize";

export interface Bm25Options {
  /** Term frequency saturation. */
  k1?: number;
  /** Document length normalization. */
  b?: number;
}

/**
 * Okapi BM25 scores of every document against the query. The corpus for the
 * inverse document frequency is the given document list.
 */
export function bm25Scores(
  queryTokens: string[],
  docTokens: string[][],
  { k1 = 1.2, b = 0.75 }: Bm25Options = {},
): number[] {
  const n = docTokens.length;
  if (n === 0) return [];
  const queryTerms = Array.from(new Set(queryTokens));
  if (queryTerms.length === 0) return docTokens.map(() => 0);

  const avgLength = docTokens.reduce((sum, d) => sum + d.length, 0) / n || 1;
  const docFreq = new Map<string, number>();
  const termFreqs = docTokens.map((tokens) => {
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const term of tf.keys()) docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
    return tf;
  });

  // The "+1" variant of the IDF stays positive for terms present in most documents.
  const idf = new Map(
    queryTerms.map((term) => {
      const df = docFreq.get(term) ?? 0;
      return [term, Math.log(1 + (n - df + 0.5) / (df + 0.5))];
    }),
  );

  return termFreqs.map((tf, i) => {
    const lengthNorm = k1 * (1 - b + (b * docTokens[i].length) / avgLength);
    let score = 0;
    for (const term of queryTerms) {
      const f = tf.get(term);
      if (!f) continue;
      score += (idf.get(term) ?? 0) * ((f * (k1 + 1)) / (f + lengthNorm));
    }
    return score;
  });
}

export interface Ranked<T> {
  item: T;
  score: number;
}

/** Ranks items by BM25 against the query, highest first. Items scoring zero are dropped. */
export function rankBm25<T>(query: string, items: T[], text: (item: T) => string, options?: Bm25Options): Ranked<T>[] {
  const scores = bm25Scores(
    tokenize(query),
    items.map((item) => tokenize(text(item))),
    options,
  );
  return items
    .map((item, i) => ({ item, score: scores[i] }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
}
