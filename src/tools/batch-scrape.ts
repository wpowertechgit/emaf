import type { ToolContext } from "../context";
import { extractPage } from "../extract";
import { fetchPage } from "../fetch";
import { ToolError, clampNumber, errorMessage, normalizeUrl, requireHttpUrl, truncate } from "../util";
import type { Tool } from "./types";

const MAX_URLS = 20;
/** Workers allow six connections waiting for headers at once; more only queue. */
const CONCURRENCY = 6;

interface PageResult {
  url: string;
  ok: boolean;
  text: string;
}

async function scrapeOne(
  url: string,
  ctx: ToolContext,
  format: string,
  onlyMainContent: boolean,
  maxCharsPerPage: number,
): Promise<PageResult> {
  try {
    const page = await fetchPage(url, ctx);
    if (page.status >= 400) return { url, ok: false, text: `HTTP ${page.status}` };
    if (!page.isHtml) {
      return { url, ok: true, text: `URL: ${page.url}\n\n${truncate(page.body, maxCharsPerPage)}` };
    }
    const extracted = extractPage(page.body, page.url, onlyMainContent);
    const content = format === "text" ? extracted.text : extracted.markdown;
    const title = extracted.title ? `# ${extracted.title}\n` : "";
    return { url, ok: true, text: `${title}URL: ${page.url}\n\n${truncate(content, maxCharsPerPage)}` };
  } catch (err) {
    return { url, ok: false, text: errorMessage(err) };
  }
}

async function batchScrape(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  if (!Array.isArray(args.urls) || args.urls.length === 0) {
    throw new ToolError("`urls` must be a non-empty array of URLs.");
  }
  if (args.urls.length > MAX_URLS) {
    throw new ToolError(`\`urls\` accepts at most ${MAX_URLS} URLs per call.`);
  }
  const format = typeof args.format === "string" ? args.format : "markdown";
  if (!["markdown", "text"].includes(format)) throw new ToolError("`format` must be one of markdown, text.");
  const onlyMainContent = args.onlyMainContent !== false;
  const maxCharsPerPage = clampNumber(args.maxCharsPerPage, 8000, 200, 50_000);
  const maxChars = clampNumber(args.maxChars, 40_000, 2_000, 200_000);

  // Validate everything first so one bad URL fails fast instead of after fetching.
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const value of args.urls) {
    const url = requireHttpUrl(value).href;
    const key = normalizeUrl(url, url) as string;
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(url);
  }

  const affordable = Math.min(urls.length, ctx.budget.remaining);
  const toFetch = urls.slice(0, affordable);
  const skipped = urls.slice(affordable);

  const results: PageResult[] = new Array(toFetch.length);
  let next = 0;
  const worker = async () => {
    while (next < toFetch.length) {
      const index = next++;
      results[index] = await scrapeOne(toFetch[index], ctx, format, onlyMainContent, maxCharsPerPage);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, toFetch.length) }, worker));

  const failed = results.filter((r) => !r.ok);
  const lines = [
    `Scraped ${results.length - failed.length} of ${urls.length} URL(s)` +
      (failed.length ? `, ${failed.length} failed` : "") +
      (skipped.length ? `, ${skipped.length} skipped (subrequest budget)` : "") +
      ".",
  ];
  let output = lines.join("\n");
  let omitted = 0;
  results.forEach((r, i) => {
    if (!r.ok) return;
    const block = `\n\n---\n\n## [${i + 1}] ${r.text}`;
    if (output.length + block.length > maxChars) omitted++;
    else output += block;
  });
  if (omitted) {
    output += `\n\n(${omitted} page(s) omitted to stay within ${maxChars} characters; lower maxCharsPerPage or scrape them separately.)`;
  }
  if (failed.length) output += `\n\n---\n\n## Failed\n${failed.map((r) => `- ${r.url}: ${r.text}`).join("\n")}`;
  if (skipped.length) {
    output += `\n\n## Skipped (subrequest budget exhausted)\n${skipped.map((u) => `- ${u}`).join("\n")}`;
  }
  return output;
}

export const batchScrapeTool: Tool = {
  definition: {
    name: "batch_scrape",
    description:
      `Read several specific web pages at once, possibly from different sites, and return each one as clean Markdown. ` +
      `Use when you already have a list of URLs (for example sources found by \`research\` or \`search\`). ` +
      `For one URL use \`scrape\`; for many pages of one site use \`crawl\`. Up to ${MAX_URLS} URLs per call.`,
    inputSchema: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          items: { type: "string" },
          description: `Absolute http(s) URLs to read, at most ${MAX_URLS}. Duplicates are fetched once.`,
        },
        format: {
          type: "string",
          enum: ["markdown", "text"],
          description: "Output format. Defaults to markdown.",
        },
        onlyMainContent: {
          type: "boolean",
          description: "Keep only the main content of each page. Defaults to true.",
        },
        maxCharsPerPage: {
          type: "number",
          description: "Truncate each page to this many characters. Defaults to 8000.",
        },
        maxChars: {
          type: "number",
          description: "Upper bound for the whole output in characters. Defaults to 40000.",
        },
      },
      required: ["urls"],
    },
  },
  handler: batchScrape,
};
