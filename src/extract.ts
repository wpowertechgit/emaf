import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { cleanImageUrl, isBadgeUrl } from "./images";
import { normalizeUrl, resolveHttpUrl } from "./util";

export interface ExtractedPage {
  title: string;
  markdown: string;
  text: string;
  html: string;
  links: string[];
}

function createTurndown(): TurndownService {
  const service = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "_",
  });
  service.use(gfm);
  service.remove(["script", "style", "noscript", "iframe", "template", "canvas", "svg"] as never);
  return service;
}

const turndown = createTurndown();

function ownRows(table: Element): Element[] {
  return Array.from(table.querySelectorAll("tr")).filter((tr) => tr.closest("table") === table);
}

/**
 * linkedom does not implement HTMLTableElement.rows, which the GFM table rules
 * rely on. Turndown clones the tree before converting, so the getter is added
 * to the element prototype rather than to individual elements. Tables without
 * rows are dropped because the plugin cannot handle them.
 */
function prepareTables(root: Element): void {
  for (const table of Array.from(root.querySelectorAll("table"))) {
    if (ownRows(table).length === 0) {
      table.remove();
      continue;
    }
    const proto = Object.getPrototypeOf(table) as object;
    if (!("rows" in proto)) {
      Object.defineProperty(proto, "rows", {
        configurable: true,
        get(this: Element) {
          return ownRows(this);
        },
      });
    }
  }
}

function wrapFragment(fragmentHtml: string): string {
  return `<!doctype html><html><head></head><body>${fragmentHtml}</body></html>`;
}

/**
 * Converts an HTML document into Markdown, plain text and cleaned HTML, and
 * collects the absolute http(s) links found on the page.
 */
export function extractPage(html: string, pageUrl: string, onlyMainContent: boolean): ExtractedPage {
  const { document } = parseHTML(html);

  // Make links and images absolute so the Markdown stays usable. Output links
  // keep their fragment (footnotes, section anchors); the collected link list
  // is fragment-free because crawl and map use it to deduplicate pages.
  const links = new Set<string>();
  for (const a of Array.from(document.querySelectorAll("a[href]"))) {
    const href = a.getAttribute("href") ?? "";
    const abs = resolveHttpUrl(href, pageUrl);
    if (abs) {
      a.setAttribute("href", abs);
      links.add(normalizeUrl(href, pageUrl) as string);
    }
  }
  for (const img of Array.from(document.querySelectorAll("img"))) {
    let src: string;
    try {
      src = new URL(img.getAttribute("src") ?? "", pageUrl).href;
    } catch {
      img.remove();
      continue;
    }
    if (!img.getAttribute("src") || isBadgeUrl(src)) {
      const parentLink = img.closest("a");
      img.remove();
      // Drop links that only wrapped badges, so no empty [](url) remains.
      if (parentLink && !(parentLink.textContent ?? "").trim() && !parentLink.querySelector("img")) {
        parentLink.remove();
      }
      continue;
    }
    img.setAttribute("src", cleanImageUrl(src));
    img.removeAttribute("srcset");
  }
  for (const el of Array.from(
    document.querySelectorAll("script, style, noscript, iframe, template, canvas, svg"),
  )) {
    el.remove();
  }

  const title = (document.querySelector("title")?.textContent ?? "").trim();
  let contentHtml: string | null = null;

  if (onlyMainContent) {
    try {
      const { document: readable } = parseHTML(document.toString());
      const article = new Readability(readable as unknown as Document, {
        keepClasses: false,
      }).parse();
      if (article?.content && (article.textContent ?? "").trim().length > 200) {
        contentHtml = article.content;
      }
    } catch {
      contentHtml = null;
    }
    if (contentHtml === null) {
      // Readability found nothing useful: fall back to the body minus page chrome.
      for (const el of Array.from(
        document.querySelectorAll(
          "nav, header, footer, aside, form, [role=navigation], [role=banner], [role=contentinfo], [aria-hidden=true]",
        ),
      )) {
        el.remove();
      }
    }
  }

  if (contentHtml === null) {
    contentHtml = document.body ? document.body.innerHTML : document.toString();
  }

  const { document: contentDoc } = parseHTML(wrapFragment(contentHtml));
  const root = contentDoc.body;
  prepareTables(root);
  const markdown = turndown
    .turndown(root as unknown as HTMLElement)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const text = (root.textContent ?? "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();

  return { title, markdown, text, html: contentHtml, links: Array.from(links) };
}
