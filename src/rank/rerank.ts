import type { Budget } from "../budget";
import { EMBEDDING_MODEL } from "../config";
import type { AiBinding } from "../env";

/** bge-base-en-v1.5 accepts 512 tokens; ~350 words keeps passages safely inside. */
const MAX_WORDS_PER_INPUT = 350;

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

function clip(text: string): string {
  const w = text.split(/\s+/);
  return w.length > MAX_WORDS_PER_INPUT ? w.slice(0, MAX_WORDS_PER_INPUT).join(" ") : text;
}

/**
 * Orders passages by embedding cosine similarity to the query using one
 * batched Workers AI call. Returns the new order as indices into `passages`.
 */
export async function rerankByEmbedding(
  ai: AiBinding,
  budget: Budget,
  query: string,
  passages: string[],
): Promise<{ order: number[]; similarities: number[] }> {
  budget.take();
  const result = (await ai.run(EMBEDDING_MODEL, { text: [query, ...passages.map(clip)] })) as {
    data?: number[][];
  };
  const vectors = result?.data;
  if (!Array.isArray(vectors) || vectors.length !== passages.length + 1) {
    throw new Error("unexpected embedding response shape");
  }
  const [queryVector, ...passageVectors] = vectors;
  const similarities = passageVectors.map((v) => cosine(queryVector, v));
  const order = similarities
    .map((s, i) => ({ s, i }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.i);
  return { order, similarities };
}
