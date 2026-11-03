import { STOPWORDS, words } from "./tokenize";

export interface DerivedQueries {
  /** The input with trailing punctuation removed. */
  natural: string;
  /** Content words only, in original order, at most `maxKeywords`. */
  keywords: string[];
  /**
   * The same content words ordered by how specific they are: names and
   * acronyms first, then ordinary content words, generic words last.
   */
  keyTerms: string[];
  /** Names, acronyms and other capitalized terms, lowercased, in original order. */
  names: string[];
  /** Key phrases: quoted phrases first, then runs of 2-3 content words, specific ones first. */
  phrases: string[];
  /** 2-4 distinct search queries, most general first. */
  queries: string[];
}

/**
 * Words that describe almost any software or question and narrow nothing
 * down in a search: "a self-hosted tool that..." matches thousands of repos.
 */
const GENERIC_TERMS = new Set(
  (
    "tool tools app apps application applications library libraries package packages framework frameworks " +
    "system systems software service services platform solution solutions project projects program programs " +
    "self hosted selfhosted host open source simple easy small lightweight fast quick new best good free " +
    "online local based build builds building create creates make makes allow allows let lets help helps " +
    "support supports feature features thing things user users way ways something kind sort type types"
  ).split(" "),
);

/**
 * True for tokens written like a name: acronyms (RAG, HTTP), mixed case
 * (PostgreSQL, iOS) and capitalized words that do not start the input.
 */
function looksLikeName(token: string, isFirst: boolean): boolean {
  if (!/\p{L}/u.test(token)) return false;
  if (token.length >= 2 && token === token.toUpperCase()) return true;
  if (/\p{Ll}\p{Lu}/u.test(token)) return true;
  return !isFirst && /^\p{Lu}/u.test(token);
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
  const contentWords: string[] = [];
  for (const w of all) {
    if (isContent(w) && !contentWords.includes(w)) contentWords.push(w);
  }
  const keywords = contentWords.slice(0, maxKeywords);

  // Names keep their original casing in the input, which `words` drops.
  const names: string[] = [];
  natural
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .forEach((token, i) => {
      const lower = words(token).join("");
      if (looksLikeName(token, i === 0) && isContent(lower) && !names.includes(lower)) names.push(lower);
    });
  const specificity = (w: string) => (names.includes(w) ? 0 : GENERIC_TERMS.has(w) ? 2 : 1);
  // Sorted before capping, so specific words late in a long description are kept.
  const keyTerms = [...contentWords].sort((a, b) => specificity(a) - specificity(b)).slice(0, maxKeywords);

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

  // Phrases with a name come first, phrases made of generic words last.
  const phraseRank = (p: string) => {
    const parts = p.split(" ");
    if (parts.some((w) => names.includes(w))) return 0;
    return parts.some((w) => GENERIC_TERMS.has(w)) ? 2 : 1;
  };
  const rankedRuns = runPhrases
    .map((p, i) => ({ p, i }))
    .sort((a, b) => phraseRank(a.p) - phraseRank(b.p) || a.i - b.i)
    .map((x) => x.p);
  const phrases = Array.from(new Set([...quoted.map((q) => q.toLowerCase()), ...rankedRuns])).slice(0, 3);

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
  return { natural, keywords, keyTerms, names, phrases, queries: queries.slice(0, 4) };
}
