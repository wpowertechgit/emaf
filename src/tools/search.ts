import { searchWeb } from "../clients/websearch";
import type { ToolContext } from "../context";
import { extractPage } from "../extract";
import { fetchPage } from "../fetch";
import { ToolError, clampNumber, errorMessage, truncate } from "../util";
import type { Tool } from "./types";

async function search(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) throw new ToolError("`query` must be a non-empty string.");
  const limit = clampNumber(args.limit, 5, 1, 20);
  const scrapeResults = args.scrapeResults === true;
  const maxCharsPerResult = clampNumber(args.maxCharsPerResult, 5000, 200, 50_000);

  const { engine, results } = await searchWeb(ctx.env, ctx.budget, query, limit);

  let pages: (string | null)[] = results.map(() => null);
  if (scrapeResults) {
    const settled = await Promise.allSettled(results.map((r) => fetchPage(r.url, ctx)));
    pages = settled.map((outcome, index) => {
      if (outcome.status === "rejected") {
        return `(could not fetch: ${errorMessage(outcome.reason)})`;
      }
      const page = outcome.value;
      const body = page.isHtml ? extractPage(page.body, page.url, true).markdown : page.body;
      return truncate(body, maxCharsPerResult) || `(empty page at ${results[index].url})`;
    });
  }

  const lines = [`Search results for "${query}" (${engine}):`];
  results.forEach((r, index) => {
    lines.push(`\n${index + 1}. ${r.title || r.url}\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ""}`);
    if (pages[index]) lines.push(`\n${pages[index]}\n`);
  });
  return lines.join("\n");
}

export const searchTool: Tool = {
  definition: {
    name: "search",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    description:
      "Raw web search: returns result titles, URLs and snippets, optionally with each result's full Markdown. " +
      "For questions, fact-checking or 'look into X', prefer `research`, which ranks relevant passages across web and academic sources.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query." },
        limit: { type: "number", description: "Number of results. Defaults to 5, maximum 20." },
        scrapeResults: {
          type: "boolean",
          description: "Also fetch each result and include its Markdown. Defaults to false.",
        },
        maxCharsPerResult: {
          type: "number",
          description: "When scraping, truncate each result to this many characters. Defaults to 5000.",
        },
      },
      required: ["query"],
    },
  },
  handler: search,
};
