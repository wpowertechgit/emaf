import { FETCH_TIMEOUT_MS, USER_AGENT } from "../config";
import type { ToolContext } from "../context";
import { extractPage } from "../extract";
import { fetchPage } from "../fetch";
import { clampNumber, normalizeUrl, requireHttpUrl } from "../util";
import type { Tool } from "./types";

async function fetchSitemapUrls(origin: string, ctx: ToolContext): Promise<string[]> {
  try {
    const response = await ctx.budget.fetch(`${origin}/sitemap.xml`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return [];
    }
    const xml = await response.text();
    const urls: string[] = [];
    for (const match of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
      const decoded = match[1].replace(/&amp;/g, "&");
      const normalized = normalizeUrl(decoded, origin);
      if (normalized) urls.push(normalized);
    }
    return urls;
  } catch {
    return [];
  }
}

async function map(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const url = requireHttpUrl(args.url);
  const sameDomainOnly = args.sameDomainOnly !== false;
  const limit = clampNumber(args.limit, 200, 1, 5000);
  const search = typeof args.search === "string" ? args.search.toLowerCase() : "";

  const [pageResult, sitemapUrls] = await Promise.all([
    fetchPage(url.href, ctx).catch(
      (err: unknown): Error => (err instanceof Error ? err : new Error(String(err))),
    ),
    fetchSitemapUrls(url.origin, ctx),
  ]);

  const found = new Set<string>();
  const notes: string[] = [];
  if (pageResult instanceof Error) {
    notes.push(`Could not fetch the page itself: ${pageResult.message}`);
  } else if (pageResult.isHtml) {
    for (const link of extractPage(pageResult.body, pageResult.url, false).links) found.add(link);
  }
  for (const link of sitemapUrls) found.add(link);
  if (sitemapUrls.length > 0) notes.push(`Included ${sitemapUrls.length} URLs from sitemap.xml.`);

  let urls = Array.from(found);
  if (sameDomainOnly) urls = urls.filter((u) => new URL(u).host === url.host);
  if (search) urls = urls.filter((u) => u.toLowerCase().includes(search));
  urls.sort();

  const total = urls.length;
  urls = urls.slice(0, limit);
  const summary = `Found ${total} URL(s)${total > limit ? `, showing the first ${limit}` : ""}.`;
  return [summary, ...notes, "", ...urls].join("\n");
}

export const mapTool: Tool = {
  definition: {
    name: "map",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    description:
      "List the URLs of one specific website without fetching their content: links on the given page plus entries from /sitemap.xml. Useful to find the right page on a known site before scraping it.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Absolute http(s) URL of the site or page." },
        search: {
          type: "string",
          description: "Only return URLs containing this substring (case-insensitive).",
        },
        sameDomainOnly: {
          type: "boolean",
          description: "Only return URLs on the same host. Defaults to true.",
        },
        limit: { type: "number", description: "Maximum URLs to return. Defaults to 200." },
      },
      required: ["url"],
    },
  },
  handler: map,
};
