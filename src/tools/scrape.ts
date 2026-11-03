import { MAX_CACHE_TTL, cacheGet, cacheKey, cachePut } from "../cache";
import type { ToolContext } from "../context";
import { extractPage } from "../extract";
import { fetchPage } from "../fetch";
import { pdfOutput } from "../pdf";
import { ToolError, clampNumber, requireHttpUrl, truncate } from "../util";
import type { Tool } from "./types";

const DEFAULT_CACHE_TTL = 3600;

interface Rendered {
  output: string;
  /** Error pages are not cached, so a transient failure does not stick. */
  cacheable: boolean;
}

async function fetchAndRender(
  url: string,
  ctx: ToolContext,
  options: { format: string; onlyMainContent: boolean; render: boolean; includeLinks: boolean },
): Promise<Rendered> {
  const page = await fetchPage(url, ctx, options.render, { allowPdf: true });
  if (page.pdf) {
    return {
      output: await pdfOutput(page.pdf, page.url, page.status, options.format),
      cacheable: page.status < 400,
    };
  }
  const header = [`URL: ${page.url}`, `Status: ${page.status}`];

  if (!page.isHtml) {
    return { output: `${header.join("\n")}\n\n${page.body}`, cacheable: page.status < 400 };
  }

  const extracted = extractPage(page.body, page.url, options.onlyMainContent);
  const content =
    options.format === "html" ? extracted.html : options.format === "text" ? extracted.text : extracted.markdown;

  let output = `${extracted.title ? `# ${extracted.title}\n` : ""}${header.join("\n")}\n\n${content}`;
  if (options.includeLinks && extracted.links.length > 0) {
    output += `\n\n## Links\n${extracted.links.map((l) => `- ${l}`).join("\n")}`;
  }
  if (page.status >= 400) {
    output = `Warning: the server responded with HTTP ${page.status}.\n\n${output}`;
  }
  return { output, cacheable: page.status < 400 };
}

async function scrape(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const url = requireHttpUrl(args.url);
  const format = typeof args.format === "string" ? args.format : "markdown";
  if (!["markdown", "text", "html"].includes(format)) {
    throw new ToolError("`format` must be one of markdown, text, html.");
  }
  const options = {
    format,
    onlyMainContent: args.onlyMainContent !== false,
    render: args.render === true,
    includeLinks: args.includeLinks === true,
  };
  const maxChars = clampNumber(args.maxChars, 50_000, 500, 200_000);
  const cacheTtl = clampNumber(args.cacheTtl, DEFAULT_CACHE_TTL, 0, MAX_CACHE_TTL);

  const kv = cacheTtl > 0 ? ctx.env.CACHE : undefined;
  const key = kv ? await cacheKey("scrape", { url: url.href, ...options }) : "";
  if (kv) {
    const hit = await cacheGet(kv, ctx.budget, key);
    const ageSeconds = hit ? Math.max(0, Math.round((Date.now() - Date.parse(hit.cachedAt)) / 1000)) : Infinity;
    if (hit && ageSeconds <= cacheTtl) {
      const note = `Cached copy from ${hit.cachedAt} (${ageSeconds}s old). Pass cacheTtl: 0 for a fresh copy.`;
      return truncate(`${note}\n\n${hit.output}`, maxChars);
    }
  }

  const rendered = await fetchAndRender(url.href, ctx, options);
  if (kv && rendered.cacheable) await cachePut(kv, ctx.budget, key, rendered.output, cacheTtl);
  return truncate(rendered.output, maxChars);
}

export const scrapeTool: Tool = {
  definition: {
    name: "scrape",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    description:
      "Read one specific web page (a URL you already have) and return its full content as clean Markdown. " +
      "Use this to read a source in full, for example a result from `research` before quoting it. PDFs are converted to text, page by page. By default only the main article content of HTML pages is kept (navigation, footers and ads are stripped).",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Absolute http(s) URL to fetch." },
        format: {
          type: "string",
          enum: ["markdown", "text", "html"],
          description: "Output format. Defaults to markdown.",
        },
        onlyMainContent: {
          type: "boolean",
          description: "Keep only the main content of the page. Defaults to true.",
        },
        render: {
          type: "boolean",
          description:
            "Render the page in a headless browser before extracting (for JavaScript-heavy sites). Requires the Browser Rendering binding. Defaults to false.",
        },
        includeLinks: {
          type: "boolean",
          description: "Append the list of links found on the page. Defaults to false.",
        },
        maxChars: {
          type: "number",
          description: "Truncate the output to this many characters. Defaults to 50000.",
        },
        cacheTtl: {
          type: "number",
          description:
            "Seconds a cached copy may be old and how long a new copy is cached, when the server has a KV cache. Defaults to 3600; 0 always fetches a fresh copy.",
        },
      },
      required: ["url"],
    },
  },
  handler: scrape,
};
