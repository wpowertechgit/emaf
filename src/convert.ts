import type { Budget } from "./budget";
import type { AiBinding, ToMarkdownResult } from "./env";
import { extractPage } from "./extract";
import { cleanMarkdownImages } from "./images";
import { normalizeUrl } from "./util";

/**
 * HTML conversion that fits the Workers Free CPU limit (10 ms per request).
 *
 * Readability and Turndown parse a full DOM and take tens to hundreds of
 * milliseconds on real pages (about 550 ms for a 650 KB Wikipedia article).
 * When the Workers AI binding is present, Markdown Conversion does the work on
 * Cloudflare's side, where it does not count as this Worker's CPU time.
 * Without it, research uses fastHtmlText, a single pass of regular
 * expressions that takes a few milliseconds on the same pages.
 */

/** Only the start of very large documents is converted. */
const MAX_HTML_CHARS = 400_000;

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** The page title from <title>, without a DOM. */
export function htmlTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1]).replace(/\s+/g, " ").trim() : "";
}

/**
 * Converts HTML to plain text blocks with Markdown headings, enough for
 * passage chunking and ranking. Drops scripts, styles and page chrome
 * (nav, header, footer, aside, forms). Links and tables are not preserved.
 */
export function fastHtmlText(html: string, maxChars: number): string {
  let h = html.length > MAX_HTML_CHARS ? html.slice(0, MAX_HTML_CHARS) : html;
  const body = h.search(/<body[\s>]/i);
  if (body > 0) h = h.slice(body);
  h = h
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|svg|template|iframe|nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<h([1-6])\b[^>]*>/gi, (_m, level: string) => `\n\n${"#".repeat(Number(level))} `)
    .replace(/<\/(?:p|div|section|article|main|li|tr|h[1-6]|blockquote|pre|table|ul|ol|dd|dt|figcaption)>|<br\s*\/?>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");
  const text = decodeEntities(h)
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

/**
 * Converts HTML with Workers AI Markdown Conversion. Returns null when the
 * binding lacks the method, the budget is exhausted, or the conversion fails,
 * so callers can fall back to local extraction.
 */
export async function aiHtmlToMarkdown(
  ai: AiBinding | undefined,
  budget: Budget,
  html: string,
  pageUrl: string,
  format: "markdown" | "text" = "markdown",
): Promise<string | null> {
  if (!ai?.toMarkdown || !budget.tryTakeInternal()) return null;
  try {
    const input = html.length > MAX_HTML_CHARS ? html.slice(0, MAX_HTML_CHARS) : html;
    const response = await ai.toMarkdown(
      { name: "page.html", blob: new Blob([input], { type: "text/html" }) },
      { conversionOptions: { html: { hostname: pageUrl }, output: { format } } },
    );
    const result: ToMarkdownResult | undefined = Array.isArray(response) ? response[0] : response;
    if (!result || result.format === "error" || typeof result.data !== "string" || !result.data.trim()) return null;
    return format === "markdown" ? cleanMarkdownImages(result.data) : result.data.trim();
  } catch {
    return null;
  }
}

/** Absolute http(s) link targets in Markdown, fragment-free and deduplicated, for crawl and map. */
export function markdownLinks(markdown: string, pageUrl: string): string[] {
  // Every "](target)" is a link or an image; image sources are the targets of "![alt](...)".
  const images = new Set(Array.from(markdown.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)/g), (m) => m[1]));
  const links = new Set<string>();
  for (const m of markdown.matchAll(/\]\(\s*<?([^)\s>]+)/g)) {
    if (images.has(m[1])) continue;
    const normalized = normalizeUrl(m[1], pageUrl);
    if (normalized) links.add(normalized);
  }
  return Array.from(links);
}

export interface ReadablePage {
  title: string;
  /** Markdown, text or HTML, as requested. */
  content: string;
  /** Fragment-free absolute links found on the page (only when requested). */
  links: string[];
  /** "ai" when Workers AI did the conversion, "dom" for local Readability and Turndown. */
  via: "ai" | "dom";
}

/**
 * Converts a fetched HTML page for scrape, batch_scrape and crawl. Workers AI
 * Markdown Conversion is used when it can produce what was asked for, which
 * keeps large pages within the CPU limit; otherwise the local Readability and
 * Turndown pipeline runs as before. Raw HTML output, the whole page
 * (onlyMainContent false) and text with a link list always use the local path.
 */
export async function convertForReading(
  html: string,
  pageUrl: string,
  ai: AiBinding | undefined,
  budget: Budget,
  options: { format: string; onlyMainContent: boolean; needLinks: boolean },
): Promise<ReadablePage> {
  const aiFormat = options.format === "markdown" ? "markdown" : options.format === "text" && !options.needLinks ? "text" : null;
  if (aiFormat && options.onlyMainContent && ai?.toMarkdown) {
    const converted = await aiHtmlToMarkdown(ai, budget, html, pageUrl, aiFormat);
    if (converted !== null) {
      return {
        title: htmlTitle(html),
        content: converted,
        links: options.needLinks ? markdownLinks(converted, pageUrl) : [],
        via: "ai",
      };
    }
  }
  const extracted = extractPage(html, pageUrl, options.onlyMainContent);
  const content =
    options.format === "html" ? extracted.html : options.format === "text" ? extracted.text : extracted.markdown;
  return { title: extracted.title, content, links: extracted.links, via: "dom" };
}
