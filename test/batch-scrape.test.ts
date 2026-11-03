import { afterEach, describe, expect, it, vi } from "vitest";
import { Budget } from "../src/budget";
import { batchScrapeTool } from "../src/tools/batch-scrape";
import { ARTICLE_HTML, CRAWL_SITE, SITE } from "./fixtures";
import { callTool, mockFetch, testEnv } from "./helpers";

afterEach(() => {
  vi.restoreAllMocks();
});

const OTHER = "https://other.test/article";

describe("batch_scrape", () => {
  it("scrapes pages from different sites in input order", async () => {
    const mock = mockFetch({ [`${SITE}/about`]: CRAWL_SITE[`${SITE}/about`], [OTHER]: ARTICLE_HTML });
    const { text, isError } = await callTool("batch_scrape", { urls: [OTHER, `${SITE}/about`] });
    expect(isError).toBe(false);
    expect(mock.unexpected).toEqual([]);
    expect(text.startsWith("Scraped 2 of 2 URL(s).")).toBe(true);
    expect(text.indexOf("## [1] # Article Title")).toBeLessThan(text.indexOf("## [2] # About"));
    expect(text).toContain(`URL: ${OTHER}`);
    expect(text).toContain("| Name | Value |");
    expect(text).not.toContain("Copyright Footer Text");
  });

  it("fetches duplicates, including fragment variants, once", async () => {
    const mock = mockFetch({ [OTHER]: ARTICLE_HTML });
    const { text } = await callTool("batch_scrape", { urls: [OTHER, `${OTHER}#section`, OTHER] });
    expect(mock.requested).toEqual([OTHER]);
    expect(text.startsWith("Scraped 1 of 1 URL(s).")).toBe(true);
  });

  it("lists failures without failing the whole call", async () => {
    mockFetch({
      [OTHER]: ARTICLE_HTML,
      [`${SITE}/missing`]: { body: "nope", status: 404 },
      [`${SITE}/image.png`]: { body: "x", contentType: "image/png" },
    });
    const { text, isError } = await callTool("batch_scrape", {
      urls: [`${SITE}/missing`, OTHER, `${SITE}/image.png`, `${SITE}/down`],
    });
    expect(isError).toBe(false);
    expect(text.startsWith("Scraped 1 of 4 URL(s), 3 failed.")).toBe(true);
    expect(text).toContain(`- ${SITE}/missing: HTTP 404`);
    expect(text).toContain(`- ${SITE}/image.png: Unsupported content type "image/png"`);
    expect(text).toContain(`- ${SITE}/down: Unexpected outbound request in test`);
  });

  it("skips URLs beyond the subrequest budget and says so", async () => {
    const urls = [1, 2, 3, 4].map((i) => `${SITE}/p${i}`);
    const mock = mockFetch(Object.fromEntries(urls.map((u) => [u, `<html><body>page ${u}</body></html>`])));
    const text = await batchScrapeTool.handler({ urls }, { env: testEnv(), budget: new Budget(2) });
    expect(mock.requested).toHaveLength(2);
    expect(text.startsWith("Scraped 2 of 4 URL(s), 2 skipped (subrequest budget).")).toBe(true);
    expect(text).toContain(`## Skipped (subrequest budget exhausted)\n- ${SITE}/p3\n- ${SITE}/p4`);
  });

  it("bounds each page and the whole output", async () => {
    const urls = [1, 2, 3].map((i) => `https://s${i}.test/a`);
    const longPage = `<html><head><title>Long</title></head><body><article>${"<p>Long paragraph of text. ".repeat(400)}</article></body></html>`;
    mockFetch(Object.fromEntries(urls.map((u) => [u, longPage])));
    const { text } = await callTool("batch_scrape", { urls, maxCharsPerPage: 1500, maxChars: 4000 });
    expect(text.length).toBeLessThanOrEqual(4300);
    expect(text).toMatch(/\[\.\.\. truncated, \d+ more characters\]/);
    expect(text).toContain("page(s) omitted to stay within 4000 characters");
  });

  it("returns plain text with format=text", async () => {
    mockFetch({ [OTHER]: ARTICLE_HTML });
    const { text } = await callTool("batch_scrape", { urls: [OTHER], format: "text" });
    expect(text).toContain("Getting Started");
    expect(text).not.toContain("```");
  });

  it("validates its arguments before fetching anything", async () => {
    const mock = mockFetch({});
    expect((await callTool("batch_scrape", {})).text).toBe("Error: `urls` must be a non-empty array of URLs.");
    expect((await callTool("batch_scrape", { urls: Array(21).fill(OTHER) })).text).toContain("at most 20 URLs");
    expect((await callTool("batch_scrape", { urls: [OTHER, "ftp://x.test/f"] })).text).toBe(
      "Error: Only http and https URLs are supported.",
    );
    expect((await callTool("batch_scrape", { urls: [OTHER], format: "html" })).text).toContain("`format` must be");
    expect(mock.requested).toEqual([]);
  });
});
