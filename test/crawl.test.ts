import { afterEach, describe, expect, it, vi } from "vitest";
import { CRAWL_SITE, SITE } from "./fixtures";
import { callTool, mockFetch } from "./helpers";

afterEach(() => {
  vi.restoreAllMocks();
});

function crawledUrls(text: string): string[] {
  return Array.from(text.matchAll(/^URL: (.+)$/gm), (m) => m[1]);
}

describe("crawl", () => {
  it("fetches only the start page with maxDepth 0", async () => {
    const mock = mockFetch(CRAWL_SITE);
    const { text } = await callTool("crawl", { url: `${SITE}/`, maxDepth: 0 });
    expect(mock.requested).toEqual([`${SITE}/`]);
    expect(crawledUrls(text)).toEqual([`${SITE}/`]);
    expect(text.startsWith(`Crawled 1 page(s) starting from ${SITE}/.`)).toBe(true);
  });

  it("follows links breadth-first up to maxDepth and stays on the same host", async () => {
    const mock = mockFetch(CRAWL_SITE);
    const { text } = await callTool("crawl", { url: `${SITE}/`, maxDepth: 1 });
    expect(mock.unexpected).toEqual([]);
    expect(crawledUrls(text)).toEqual([`${SITE}/`, `${SITE}/docs/`, `${SITE}/blog/`]);
    expect(mock.requested).not.toContain("https://external.test/partner");
  });

  it("does not fetch links found at the maximum depth", async () => {
    const mock = mockFetch(CRAWL_SITE);
    await callTool("crawl", { url: `${SITE}/`, maxDepth: 2, limit: 40 });
    expect(mock.unexpected).toEqual([]);
    expect(mock.requested).not.toContain(`${SITE}/docs/deep`);
    expect(mock.requested).not.toContain(`${SITE}/docs/missing`);
    expect(mock.requested).toContain(`${SITE}/docs/intro`);
  });

  it("skips binary file extensions", async () => {
    const mock = mockFetch(CRAWL_SITE);
    await callTool("crawl", { url: `${SITE}/docs/`, maxDepth: 1 });
    expect(mock.unexpected).toEqual([]);
    expect(mock.requested).not.toContain(`${SITE}/files/manual.pdf`);
  });

  it("only follows URLs under pathPrefix", async () => {
    const mock = mockFetch(CRAWL_SITE);
    const { text } = await callTool("crawl", {
      url: `${SITE}/docs/`,
      maxDepth: 3,
      pathPrefix: "/docs/",
      limit: 40,
    });
    expect(mock.unexpected).toEqual([]);
    expect(crawledUrls(text)).toEqual([
      `${SITE}/docs/`,
      `${SITE}/docs/intro`,
      `${SITE}/docs/advanced`,
      `${SITE}/docs/deep`,
    ]);
    for (const url of mock.requested) {
      expect(new URL(url).pathname.startsWith("/docs/"), url).toBe(true);
    }
  });

  it("lists failed pages separately", async () => {
    mockFetch(CRAWL_SITE);
    const { text } = await callTool("crawl", {
      url: `${SITE}/docs/advanced`,
      maxDepth: 1,
      pathPrefix: "/docs/",
    });
    expect(text.split("\n")[0]).toBe(`Crawled 2 page(s) starting from ${SITE}/docs/advanced, 1 failed.`);
    expect(crawledUrls(text)).toEqual([`${SITE}/docs/advanced`, `${SITE}/docs/`]);
    expect(text).toContain(`## Failed\n- ${SITE}/docs/missing: HTTP 404`);
  });

  it("stops at the page limit", async () => {
    const mock = mockFetch(CRAWL_SITE);
    const { text } = await callTool("crawl", { url: `${SITE}/`, maxDepth: 3, limit: 4 });
    expect(mock.requested).toHaveLength(4);
    expect(crawledUrls(text)).toHaveLength(4);
  });

  it("clamps the limit to 40 pages", async () => {
    const pages: Record<string, string> = {};
    const links = Array.from({ length: 60 }, (_, i) => `<a href="/p${i}">p${i}</a>`).join("");
    pages[`${SITE}/`] = `<html><head><title>Hub</title></head><body>${links}</body></html>`;
    for (let i = 0; i < 60; i++) {
      pages[`${SITE}/p${i}`] = `<html><head><title>p${i}</title></head><body>page ${i}</body></html>`;
    }
    const mock = mockFetch(pages);
    await callTool("crawl", { url: `${SITE}/`, maxDepth: 1, limit: 500 });
    expect(mock.requested).toHaveLength(40);
  });

  it("truncates each page to maxCharsPerPage", async () => {
    mockFetch(CRAWL_SITE);
    const { text } = await callTool("crawl", { url: `${SITE}/`, maxDepth: 0, maxCharsPerPage: 200 });
    expect(text).toMatch(/\[\.\.\. truncated, \d+ more characters\]/);
  });

  it("does not fetch the same page twice", async () => {
    const mock = mockFetch(CRAWL_SITE);
    await callTool("crawl", { url: `${SITE}/`, maxDepth: 3, limit: 40 });
    expect(new Set(mock.requested).size).toBe(mock.requested.length);
  });
});
