import { CRAWL_CONCURRENCY, MAX_CRAWL_PAGES, SKIP_EXTENSIONS } from "../config";
import type { ToolContext } from "../context";
import { extractPage } from "../extract";
import { fetchPage } from "../fetch";
import { clampNumber, errorMessage, requireHttpUrl, truncate } from "../util";
import type { Tool } from "./types";

async function crawl(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const start = requireHttpUrl(args.url);
  const limit = clampNumber(args.limit, 10, 1, MAX_CRAWL_PAGES);
  const maxDepth = clampNumber(args.maxDepth, 2, 0, 10);
  const pathPrefix = typeof args.pathPrefix === "string" ? args.pathPrefix : "";
  const maxCharsPerPage = clampNumber(args.maxCharsPerPage, 8000, 200, 50_000);

  start.hash = "";
  const seen = new Set<string>([start.href]);
  let frontier: string[] = [start.href];
  const results: { url: string; title: string; markdown: string }[] = [];
  const errors: string[] = [];

  const shouldFollow = (candidate: string): boolean => {
    const u = new URL(candidate);
    if (u.host !== start.host) return false;
    if (pathPrefix && !u.pathname.startsWith(pathPrefix)) return false;
    if (SKIP_EXTENSIONS.test(u.pathname)) return false;
    return true;
  };

  for (let depth = 0; depth <= maxDepth && frontier.length > 0; depth++) {
    const nextFrontier: string[] = [];
    for (let i = 0; i < frontier.length && results.length + errors.length < limit; i += CRAWL_CONCURRENCY) {
      const remaining = limit - results.length - errors.length;
      const batch = frontier.slice(i, i + Math.min(CRAWL_CONCURRENCY, remaining));
      const settled = await Promise.allSettled(batch.map((u) => fetchPage(u, ctx)));

      settled.forEach((outcome, index) => {
        const pageUrl = batch[index];
        if (outcome.status === "rejected") {
          errors.push(`${pageUrl}: ${errorMessage(outcome.reason)}`);
          return;
        }
        const page = outcome.value;
        if (!page.isHtml) {
          errors.push(`${pageUrl}: not an HTML page`);
          return;
        }
        if (page.status >= 400) {
          errors.push(`${pageUrl}: HTTP ${page.status}`);
          return;
        }
        const extracted = extractPage(page.body, page.url, true);
        results.push({
          url: page.url,
          title: extracted.title,
          markdown: truncate(extracted.markdown, maxCharsPerPage),
        });
        if (depth < maxDepth) {
          for (const link of extracted.links) {
            if (!seen.has(link) && shouldFollow(link)) {
              seen.add(link);
              nextFrontier.push(link);
            }
          }
        }
      });
    }
    frontier = nextFrontier;
  }

  const parts = [
    `Crawled ${results.length} page(s) starting from ${start.href}` +
      (errors.length ? `, ${errors.length} failed.` : "."),
  ];
  for (const r of results) {
    parts.push(`\n---\n\n# ${r.title || r.url}\nURL: ${r.url}\n\n${r.markdown}`);
  }
  if (errors.length) {
    parts.push(`\n---\n\n## Failed\n${errors.map((e) => `- ${e}`).join("\n")}`);
  }
  return parts.join("\n");
}

export const crawlTool: Tool = {
  definition: {
    name: "crawl",
    description: `Read several pages of one specific website: crawls breadth-first from a starting URL, staying on the same host, and returns the Markdown of each page. Use for documentation sites or sections (pathPrefix). Limited to ${MAX_CRAWL_PAGES} pages per call.`,
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Absolute http(s) URL to start from." },
        limit: {
          type: "number",
          description: `Maximum pages to fetch. Defaults to 10, maximum ${MAX_CRAWL_PAGES}.`,
        },
        maxDepth: {
          type: "number",
          description: "Maximum link depth from the start URL. Defaults to 2.",
        },
        pathPrefix: {
          type: "string",
          description:
            "Only follow URLs whose path starts with this prefix (for example /docs/). Defaults to no restriction.",
        },
        maxCharsPerPage: {
          type: "number",
          description: "Truncate each page's Markdown to this many characters. Defaults to 8000.",
        },
      },
      required: ["url"],
    },
  },
  handler: crawl,
};
