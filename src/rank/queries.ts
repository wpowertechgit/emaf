import { STOPWORDS, words } from "./tokenize";

export interface DerivedQueries {
  /** The input with trailing punctuation removed. */
  natural: string;
  /** Content words only, in original order, at most `maxKeywords`. */
  keywords: string[];
  /** Key phrases: quoted phrases from the input first, then runs of 2-3 content words. */
  phrases: string[];
  /** 2-4 distinct search queries, most general first. */
  queries: string[];
}

/**
 * Derives search queries from a question or description without an LLM:
 * the input itself, a keyword-only variant and a quoted key-phrase variant.
 */
export function deriveQueries(input: string, maxKeywords = 8): DerivedQueries {
  const natural = input.trim().replace(/\s+/g, " ").replace(/[?!.\s]+$/, "");

  const quoted = Array.from(natural.matchAll(/["“”']([^"“”']{3,80})["“”']/g), (m) => m[1].trim());

  const all = words(natural);
  const isContent = (w: string) => w.length > 1 && !STOPWORDS.has(w);
  const keywords: string[] = [];
  for (const w of all) {
    if (isContent(w) && !keywords.includes(w)) keywords.push(w);
    if (keywords.length >= maxKeywords) break;
  }

  // Runs of consecutive content words, split into 2-3 word phrases.
  const runPhrases: string[] = [];
  let run: string[] = [];
  const closeRun = () => {
    for (let i = 0; i + 1 < run.length; i += 3) {
      const piece = run.slice(i, i + 3);
      if (piece.length >= 2) runPhrases.push(piece.join(" "));
    }
    run = [];
  };
  for (const w of all) {
    if (isContent(w)) run.push(w);
    else closeRun();
  }
  closeRun();

  const phrases = Array.from(new Set([...quoted.map((q) => q.toLowerCase()), ...runPhrases])).slice(0, 3);

  const candidates = [
    natural,
    keywords.join(" "),
    phrases.length ? phrases.slice(0, 2).map((p) => `"${p}"`).join(" ") : "",
    quoted.length && keywords.length
      ? `${quoted.map((q) => `"${q}"`).join(" ")} ${keywords.filter((k) => !quoted.join(" ").toLowerCase().includes(k)).slice(0, 3).join(" ")}`.trim()
      : "",
  ];
  const queries: string[] = [];
  for (const q of candidates) {
    const normalized = q.trim();
    if (normalized && !queries.some((existing) => existing.toLowerCase() === normalized.toLowerCase())) {
      queries.push(normalized);
    }
  }
  return { natural, keywords, phrases, queries: queries.slice(0, 4) };
}
