/**
 * Detects passages that match a query's keywords without informing an answer:
 * reference lists, related-article widgets, acknowledgements and the like.
 * BM25 ranks bibliographies highly because every entry repeats the topic.
 */

const NON_CONTENT_HEADING =
  /^(?:references?|bibliography|works cited|literature cited|cited by|citations?|footnotes?|end ?notes|notes|sources|further reading|external links|see also|similar articles|related (?:articles|content|reading|projects|tools)|acknowledge?ments?|funding|conflicts? of interest|competing interests|author contributions|supplementary (?:material|materials|data|information)|community (?:integrations|projects|plugins)|similar (?:projects|tools)|alternatives|sponsors?|backers|contributors|star history|license)\b/i;

/** True when any heading on the passage's section path names a non-content section. */
export function isNonContentSection(section: string): boolean {
  if (!section) return false;
  return section
    .split(" > ")
    .some((heading) => NON_CONTENT_HEADING.test(heading.replace(/^[\d.\s]+/, "").trim()));
}

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;
const MARKDOWN_LINK = /\[[^\]]+\]\([^)\s]+\)/;

/**
 * True for lists whose items mostly link elsewhere, such as "community
 * integrations" or awesome-list sections. They describe other projects, so
 * their keywords say nothing about the page they appear on.
 */
export function looksLikeLinkList(text: string): boolean {
  const lines = text.split("\n").filter((line) => line.trim());
  const linkedItems = lines.filter((line) => LIST_ITEM.test(line) && MARKDOWN_LINK.test(line)).length;
  return linkedItems >= 3 && linkedItems / lines.length >= 0.6;
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
