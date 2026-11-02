/** English stopwords plus common question and filler words. */
export const STOPWORDS = new Set(
  (
    "a about above after again against all also am an and any are as at be because been before being below " +
    "between both but by can could did do does doing done down during each either else ever every few for " +
    "from further get gets got had has have having he her here hers herself him himself his how however i if " +
    "in into is it its itself just know known let like many may me might more most much must my myself near " +
    "need no nor not now of off on once one only or other our ours ourselves out over own per please same " +
    "shall she should so some such than that the their theirs them themselves then there these they this " +
    "those through to too under until up upon us use used using very via want was we well were what when " +
    "where whether which while who whom whose why will with within without would yes yet you your yours " +
    "yourself yourselves exist exists existing anything something someone thing things way ways really " +
    "look looking find tell explain show give"
  ).split(" "),
);

/**
 * A light English stemmer: folds plural and common verb endings so that
 * "caches", "caching" and "cached" match "cache". Deliberately conservative.
 */
export function stem(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith("sses")) return word.slice(0, -2);
  if (word.endsWith("ing") && word.length > 5) return trimDouble(word.slice(0, -3));
  if (word.endsWith("ed") && word.length > 4) return trimDouble(word.slice(0, -2));
  if (word.endsWith("es") && /(?:ch|sh|x|z)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s") && !/(?:ss|us|is)$/.test(word)) return word.slice(0, -1);
  if (word.endsWith("e") && word.length > 4) return word.slice(0, -1);
  return word;
}

function trimDouble(word: string): string {
  // "running" -> "runn" -> "run"; keep "ll", "ss" and "zz" pairs.
  return /([^aeiouslz])\1$/.test(word) ? word.slice(0, -1) : word.endsWith("e") ? word.slice(0, -1) : word;
}

/** Lowercased words without diacritics, in order, including stopwords. */
export function words(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0);
}

/** Tokens used for ranking: stopwords and single characters removed, stemmed. */
export function tokenize(text: string): string[] {
  return words(text)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
    .map(stem);
}
