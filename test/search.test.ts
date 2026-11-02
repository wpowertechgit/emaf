import { afterEach, describe, expect, it, vi } from "vitest";
import { ARTICLE_HTML } from "./fixtures";
import { callTool, testEnv } from "./helpers";

afterEach(() => {
  vi.restoreAllMocks();
});

const DDG_HTML = `<html><body>
  <div class="result result--ad">
    <a class="result__a" href="https://ads.test/buy">Sponsored</a>
  </div>
  <div class="result">
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fone.test%2Fa&amp;rut=x">First   Result</a>
    <a class="result__snippet">First   snippet text</a>
  </div>
  <div class="result">
    <a class="result__a" href="https://two.test/b">Second Result</a>
  </div>
</body></html>`;

describe("search", () => {
  it("parses DuckDuckGo HTML results and skips ads", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(DDG_HTML, { headers: { "Content-Type": "text/html" } }));
    const { text, isError } = await callTool("search", { query: "emaf test" });
    expect(isError).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toBe("https://html.duckduckgo.com/html/");
    expect(text).toBe(
      'Search results for "emaf test" (DuckDuckGo):\n' +
        "\n1. First   Result\n   https://one.test/a\n   First snippet text\n" +
        "\n2. Second Result\n   https://two.test/b",
    );
  });

  it("uses Brave when BRAVE_API_KEY is set", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        web: {
          results: [
            { title: "<strong>Brave</strong> hit", url: "https://brave.test/x", description: "a <b>b</b>" },
            { title: "No URL" },
          ],
        },
      }),
    );
    const { text } = await callTool("search", { query: "q", limit: 3 }, testEnv({ BRAVE_API_KEY: "key" }));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("https://api.search.brave.com/res/v1/web/search?q=q&count=3");
    expect(new Headers(init?.headers).get("X-Subscription-Token")).toBe("key");
    expect(text).toBe('Search results for "q" (Brave):\n\n1. Brave hit\n   https://brave.test/x\n   a b');
  });

  it("scrapes results when scrapeResults is true", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith("https://html.duckduckgo.com/")) {
        return new Response(DDG_HTML, { headers: { "Content-Type": "text/html" } });
      }
      if (url === "https://one.test/a") {
        return new Response(ARTICLE_HTML, { headers: { "Content-Type": "text/html" } });
      }
      throw new Error("connection refused");
    });
    const { text } = await callTool("search", { query: "q", scrapeResults: true });
    expect(text).toContain("# Getting Started");
    expect(text).toContain("(could not fetch: connection refused)");
  });

  it("reports when DuckDuckGo returns nothing parseable", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html></html>"));
    const { text, isError } = await callTool("search", { query: "q" });
    expect(isError).toBe(true);
    expect(text).toContain("Set BRAVE_API_KEY");
  });

  it("requires a query", async () => {
    const { text, isError } = await callTool("search", { query: "  " });
    expect(isError).toBe(true);
    expect(text).toBe("Error: `query` must be a non-empty string.");
  });
});
