/**
 * Detects passages that match a query's keywords without informing an answer:
 * reference lists, related-article widgets, acknowledgements and the like.
 * BM25 ranks bibliographies highly because every entry repeats the topic.
 */

const NON_CONTENT_HEADING =
  /^(?:references?|bibliography|works cited|literature cited|cited by|citations?|footnotes?|end ?notes|notes|sources|further reading|external links|see also|similar articles|related (?:articles|content|reading)|acknowledge?ments?|funding|conflicts? of interest|competing interests|author contributions|supplementary (?:material|materials|data|information))\b/i;

/** True when any heading on the passage's section path names a non-content section. */
export function isNonContentSection(section: string): boolean {
  if (!section) return false;
  return section
    .split(" > ")
    .some((heading) => NON_CONTENT_HEADING.test(heading.replace(/^[\d.\s]+/, "").trim()));
}

const CITATION_MARKER = /\bdoi\b|\bet al\b|\bpubmed\b|\bpmc\d*\b|\b(?:19|20)\d{2}\s*[;:]|\(\s*(?:19|20)\d{2}[a-z]?\s*\)/gi;

/**
 * True for text dense with citation markers (DOIs, "et al.", journal years,
 * PubMed links), such as a bibliography without a heading. Prose that cites
 * a few sources stays well below the threshold.
 */
export function looksLikeCitationList(text: string): boolean {
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words < 30) return false;
  const markers = text.match(CITATION_MARKER)?.length ?? 0;
  return markers / words > 0.08;
}
