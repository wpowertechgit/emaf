import { afterEach, describe, expect, it, vi } from "vitest";
import { CRAWL_SITE, SITE, SITEMAP_XML } from "./fixtures";
import { callTool, mockFetch } from "./helpers";

afterEach(() => {
  vi.restoreAllMocks();
});

function urlLines(text: string): string[] {
  return text.split("\n").filter((line) => line.startsWith("http"));
}

describe("map", () => {
  it("combines page links and sitemap entries, sorted and deduplicated", async () => {
    const mock = mockFetch({
      [`${SITE}/docs/`]: CRAWL_SITE[`${SITE}/docs/`],
      [`${SITE}/sitemap.xml`]: { body: SITEMAP_XML, contentType: "application/xml" },
    });
    const { text, isError } = await callTool("map", { url: `${SITE}/docs/` });
    expect(isError).toBe(false);
    expect(mock.unexpected).toEqual([]);
    expect(text).toContain("Included 3 URLs from sitemap.xml.");
    expect(urlLines(text)).toEqual([
      `${SITE}/`,
      `${SITE}/about`,
      `${SITE}/blog/`,
      `${SITE}/docs/`,
      `${SITE}/docs/advanced`,
      `${SITE}/docs/intro`,
      `${SITE}/files/manual.pdf`,
      `${SITE}/search?q=a&page=2`,
      `${SITE}/sitemap-only`,
    ]);
  });

  it("lists URLs without fragments", async () => {
    mockFetch({
      [`${SITE}/page`]: `<html><body><a href="/a#x">x</a><a href="/a#y">y</a><a href="#top">top</a></body></html>`,
      [`${SITE}/sitemap.xml`]: { body: "Not found", status: 404 },
    });
    const { text } = await callTool("map", { url: `${SITE}/page` });
    expect(urlLines(text)).toEqual([`${SITE}/a`, `${SITE}/page`]);
  });

  it("includes other hosts when sameDomainOnly is false", async () => {
    mockFetch({
      [`${SITE}/docs/`]: CRAWL_SITE[`${SITE}/docs/`],
      [`${SITE}/sitemap.xml`]: SITEMAP_XML,
    });
    const { text } = await callTool("map", { url: `${SITE}/docs/`, sameDomainOnly: false });
    const urls = urlLines(text);
    expect(urls).toContain("https://external.test/partner");
    expect(urls).toContain("https://elsewhere.test/from-sitemap");
  });

  it("filters by a case-insensitive substring", async () => {
    mockFetch({
      [`${SITE}/docs/`]: CRAWL_SITE[`${SITE}/docs/`],
      [`${SITE}/sitemap.xml`]: SITEMAP_XML,
    });
    const { text } = await callTool("map", { url: `${SITE}/docs/`, search: "DOCS/" });
    expect(urlLines(text)).toEqual([`${SITE}/docs/`, `${SITE}/docs/advanced`, `${SITE}/docs/intro`]);
  });

  it("applies the limit and reports the total", async () => {
    mockFetch({
      [`${SITE}/docs/`]: CRAWL_SITE[`${SITE}/docs/`],
      [`${SITE}/sitemap.xml`]: SITEMAP_XML,
    });
    const { text } = await callTool("map", { url: `${SITE}/docs/`, limit: 2 });
    expect(text.startsWith("Found 9 URL(s), showing the first 2.")).toBe(true);
    expect(urlLines(text)).toHaveLength(2);
  });

  it("works without a sitemap", async () => {
    mockFetch({
      [`${SITE}/docs/`]: CRAWL_SITE[`${SITE}/docs/`],
      [`${SITE}/sitemap.xml`]: { body: "Not found", status: 404 },
    });
    const { text } = await callTool("map", { url: `${SITE}/docs/` });
    expect(text).not.toContain("sitemap.xml");
    expect(urlLines(text)).toContain(`${SITE}/docs/intro`);
    expect(urlLines(text)).not.toContain(`${SITE}/sitemap-only`);
  });

  it("still returns sitemap URLs when the page itself fails", async () => {
    mockFetch({
      [`${SITE}/sitemap.xml`]: SITEMAP_XML,
    });
    const { text, isError } = await callTool("map", { url: `${SITE}/broken` });
    expect(isError).toBe(false);
    expect(text).toContain("Could not fetch the page itself");
    expect(urlLines(text)).toEqual([`${SITE}/search?q=a&page=2`, `${SITE}/sitemap-only`]);
  });
});
