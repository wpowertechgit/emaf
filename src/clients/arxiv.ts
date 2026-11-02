import type { Budget } from "../budget";
import { getText } from "./http";
import type { Paper } from "./openalex";

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? decodeXml(m[1]) : "";
}

/** Parses an arXiv API Atom feed into papers. All arXiv entries are preprints. */
export function parseArxivAtom(xml: string): Paper[] {
  const papers: Paper[] = [];
  for (const [, entry] of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const title = tag(entry, "title");
    // The feed reports query errors as a single entry with an "Error" title.
    if (!title || title === "Error") continue;
    const id = tag(entry, "id");
    const alternate = entry.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/)?.[1];
    papers.push({
      title,
      url: (alternate ?? id).replace(/^http:\/\//, "https://"),
      abstract: tag(entry, "summary"),
      date: tag(entry, "published").slice(0, 10),
      authors: Array.from(entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g), (m) => decodeXml(m[1])),
      venue: "arXiv",
      citations: null,
      doi: tag(entry, "arxiv:doi"),
      preprint: true,
      origin: "arXiv",
      journalRef: tag(entry, "arxiv:journal_ref") || undefined,
    });
  }
  return papers;
}

/**
 * arXiv API search over all fields, requiring every term. arXiv asks for at
 * most one request every three seconds, so callers make a single call.
 */
export async function searchArxiv(budget: Budget, terms: string[], maxResults: number): Promise<Paper[]> {
  const cleaned = terms.map((t) => t.replace(/[^\p{L}\p{N}\s-]/gu, " ").trim()).filter(Boolean);
  if (cleaned.length === 0) return [];
  const searchQuery = cleaned.map((t) => (/\s/.test(t) ? `all:"${t}"` : `all:${t}`)).join(" AND ");
  const url = new URL("https://export.arxiv.org/api/query");
  url.searchParams.set("search_query", searchQuery);
  url.searchParams.set("start", "0");
  url.searchParams.set("max_results", String(maxResults));
  url.searchParams.set("sortBy", "relevance");
  const xml = await getText(budget, url.href, { service: "arXiv", headers: { Accept: "application/atom+xml" } });
  return xml ? parseArxivAtom(xml) : [];
}
