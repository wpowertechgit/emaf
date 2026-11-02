import { parseHTML } from "linkedom";
import type { Budget } from "../budget";
import { FETCH_TIMEOUT_MS, USER_AGENT } from "../config";
import type { Env } from "../env";
import { ToolError } from "../util";
import { getJson } from "./http";

export interface WebResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResponse {
  engine: "Brave" | "DuckDuckGo";
  results: WebResult[];
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

async function searchBrave(budget: Budget, query: string, limit: number, apiKey: string): Promise<WebResult[]> {
  const endpoint = new URL("https://api.search.brave.com/res/v1/web/search");
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("count", String(limit));
  const data = await getJson<{
    web?: { results?: { title?: string; url?: string; description?: string }[] };
  }>(budget, endpoint.href, {
    service: "Brave Search",
    headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
    timeoutMs: FETCH_TIMEOUT_MS,
  });
  return (data.web?.results ?? [])
    .filter((r) => r.url)
    .slice(0, limit)
    .map((r) => ({
      title: stripTags(r.title ?? ""),
      url: r.url as string,
      snippet: stripTags(r.description ?? ""),
    }));
}

/** Parses the DuckDuckGo HTML endpoint's result page, skipping ads. */
export function parseDuckDuckGo(html: string, limit: number): WebResult[] {
  const { document } = parseHTML(html);
  const results: WebResult[] = [];
  for (const node of Array.from(document.querySelectorAll(".result"))) {
    if (node.classList.contains("result--ad")) continue;
    const anchor = node.querySelector("a.result__a");
    if (!anchor) continue;
    let href = anchor.getAttribute("href") ?? "";
    try {
      const parsed = new URL(href, "https://duckduckgo.com");
      const target = parsed.searchParams.get("uddg");
      href = target ?? parsed.href;
    } catch {
      continue;
    }
    if (!/^https?:\/\//i.test(href)) continue;
    results.push({
      title: (anchor.textContent ?? "").trim(),
      url: href,
      snippet: (node.querySelector(".result__snippet")?.textContent ?? "").replace(/\s+/g, " ").trim(),
    });
    if (results.length >= limit) break;
  }
  return results;
}

async function searchDuckDuckGo(budget: Budget, query: string, limit: number): Promise<WebResult[]> {
  const response = await budget.fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "text/html",
    },
    body: new URLSearchParams({ q: query }).toString(),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new ToolError(`DuckDuckGo returned HTTP ${response.status}.`);
  }
  const results = parseDuckDuckGo(await response.text(), limit);
  if (results.length === 0) {
    throw new ToolError(
      "DuckDuckGo returned no parseable results (it may be rate limiting this server). Set BRAVE_API_KEY for reliable search.",
    );
  }
  return results;
}

/** Web search through Brave when BRAVE_API_KEY is set, DuckDuckGo HTML otherwise. One subrequest. */
export async function searchWeb(env: Env, budget: Budget, query: string, limit: number): Promise<WebSearchResponse> {
  if (env.BRAVE_API_KEY) {
    return { engine: "Brave", results: await searchBrave(budget, query, limit, env.BRAVE_API_KEY) };
  }
  return { engine: "DuckDuckGo", results: await searchDuckDuckGo(budget, query, limit) };
}
