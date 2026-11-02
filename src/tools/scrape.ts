import type { ToolContext } from "../context";
import { extractPage } from "../extract";
import { fetchPage } from "../fetch";
import { ToolError, clampNumber, requireHttpUrl, truncate } from "../util";
import type { Tool } from "./types";

async function scrape(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const url = requireHttpUrl(args.url);
  const format = typeof args.format === "string" ? args.format : "markdown";
  if (!["markdown", "text", "html"].includes(format)) {
    throw new ToolError("`format` must be one of markdown, text, html.");
  }
  const onlyMainContent = args.onlyMainContent !== false;
  const render = args.render === true;
  const includeLinks = args.includeLinks === true;
  const maxChars = clampNumber(args.maxChars, 50_000, 500, 200_000);

  const page = await fetchPage(url.href, ctx, render);
  const header = [`URL: ${page.url}`, `Status: ${page.status}`];

  if (!page.isHtml) {
    return `${header.join("\n")}\n\n${truncate(page.body, maxChars)}`;
  }

  const extracted = extractPage(page.body, page.url, onlyMainContent);
  const content =
    format === "html" ? extracted.html : format === "text" ? extracted.text : extracted.markdown;

  let output = `${extracted.title ? `# ${extracted.title}\n` : ""}${header.join("\n")}\n\n${content}`;
  if (includeLinks && extracted.links.length > 0) {
    output += `\n\n## Links\n${extracted.links.map((l) => `- ${l}`).join("\n")}`;
  }
  if (page.status >= 400) {
    output = `Warning: the server responded with HTTP ${page.status}.\n\n${output}`;
  }
  return truncate(output, maxChars);
}

export const scrapeTool: Tool = {
  definition: {
    name: "scrape",
    description:
      "Read one specific web page (a URL you already have) and return its full content as clean Markdown. " +
      "Use this to read a source in full, for example a result from `research` before quoting it. By default only the main article content is kept (navigation, footers and ads are stripped).",
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
      },
      required: ["url"],
    },
  },
  handler: scrape,
};
