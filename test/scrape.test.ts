import { afterEach, describe, expect, it, vi } from "vitest";
import { ARTICLE_HTML, SHORT_PAGE_HTML, SITE } from "./fixtures";
import { callTool, mockFetch, testEnv } from "./helpers";

const ARTICLE_URL = `${SITE}/docs/start/index.html`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("scrape", () => {
  it("returns the title, URL and status header", async () => {
    mockFetch({ [ARTICLE_URL]: ARTICLE_HTML });
    const { text, isError } = await callTool("scrape", { url: ARTICLE_URL });
    expect(isError).toBe(false);
    expect(text.startsWith(`# Article Title\nURL: ${ARTICLE_URL}\nStatus: 200\n\n`)).toBe(true);
  });

  it("strips navigation, header, footer, scripts and styles", async () => {
    mockFetch({ [ARTICLE_URL]: ARTICLE_HTML });
    const { text } = await callTool("scrape", { url: ARTICLE_URL });
    expect(text).toContain("Getting Started");
    expect(text).not.toContain("Site Logo");
    expect(text).not.toContain("Partner");
    expect(text).not.toContain("Copyright Footer Text");
    expect(text).not.toContain("window.tracking");
    expect(text).not.toContain("color: red");
  });

  it("converts tables to GFM tables", async () => {
    mockFetch({ [ARTICLE_URL]: ARTICLE_HTML });
    const { text } = await callTool("scrape", { url: ARTICLE_URL });
    expect(text).toMatch(/\| Name \| Value \|\n\| --- \| --- \|\n\| timeout \| 20 \|\n\| retries \| 3 \|/);
  });

  it("converts code blocks to fenced blocks", async () => {
    mockFetch({ [ARTICLE_URL]: ARTICLE_HTML });
    const { text } = await callTool("scrape", { url: ARTICLE_URL });
    // Readability drops class attributes, so the language hint is currently lost.
    expect(text).toContain("```\nconst answer: number = 42;\nconsole.log(answer);\n```");
  });

  it("keeps the code block language when Readability is not used", async () => {
    mockFetch({ [ARTICLE_URL]: ARTICLE_HTML });
    const { text } = await callTool("scrape", { url: ARTICLE_URL, onlyMainContent: false });
    expect(text).toContain("```ts\nconst answer: number = 42;\nconsole.log(answer);\n```");
  });

  it("resolves relative links and images against the page URL", async () => {
    mockFetch({ [ARTICLE_URL]: ARTICLE_HTML });
    const { text } = await callTool("scrape", { url: ARTICLE_URL });
    expect(text).toContain(`[setup guide](${SITE}/docs/guide/setup.html)`);
    expect(text).toContain(`[reference](${SITE}/reference)`);
    expect(text).toContain(`![Diagram](${SITE}/docs/start/images/diagram.png)`);
  });

  it("keeps URL fragments in output links", async () => {
    mockFetch({ [ARTICLE_URL]: ARTICLE_HTML });
    const { text } = await callTool("scrape", { url: ARTICLE_URL });
    expect(text).toContain(`[install section](${SITE}/reference#install)`);
    expect(text).toContain(`[1](${ARTICLE_URL}#fn1)`);
  });

  it("lists links without fragments and without duplicates", async () => {
    mockFetch({ [ARTICLE_URL]: ARTICLE_HTML });
    const { text } = await callTool("scrape", { url: ARTICLE_URL, includeLinks: true });
    const links = text.slice(text.indexOf("## Links")).split("\n").filter((l) => l.startsWith("- "));
    expect(links.filter((l) => l === `- ${SITE}/reference`)).toHaveLength(1);
    expect(links.some((l) => l.includes("#"))).toBe(false);
  });

  it("resolves links against the final URL after redirects", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      const response = new Response(ARTICLE_HTML, { headers: { "Content-Type": "text/html" } });
      Object.defineProperty(response, "url", { value: `${SITE}/moved/page.html` });
      return response;
    });
    const { text } = await callTool("scrape", { url: `${SITE}/old` });
    expect(text).toContain(`URL: ${SITE}/moved/page.html`);
    expect(text).toContain(`[setup guide](${SITE}/guide/setup.html)`);
  });

  it("falls back to the body without page chrome when Readability finds too little", async () => {
    mockFetch({ [`${SITE}/short`]: SHORT_PAGE_HTML });
    const { text } = await callTool("scrape", { url: `${SITE}/short` });
    expect(text).toContain("Short body text.");
    for (const chrome of ["Nav Link", "Header Text", "Aside Text", "Footer Text"]) {
      expect(text).not.toContain(chrome);
    }
  });

  it("keeps the whole page when onlyMainContent is false", async () => {
    mockFetch({ [ARTICLE_URL]: ARTICLE_HTML });
    const { text } = await callTool("scrape", { url: ARTICLE_URL, onlyMainContent: false });
    expect(text).toContain("Site Logo");
    expect(text).toContain("Copyright Footer Text");
  });

  it("returns plain text with format=text", async () => {
    mockFetch({ [ARTICLE_URL]: ARTICLE_HTML });
    const { text } = await callTool("scrape", { url: ARTICLE_URL, format: "text" });
    expect(text).toContain("Getting Started");
    expect(text).not.toContain("```");
    expect(text).not.toContain("](");
  });

  it("returns cleaned HTML with format=html", async () => {
    mockFetch({ [ARTICLE_URL]: ARTICLE_HTML });
    const { text } = await callTool("scrape", { url: ARTICLE_URL, format: "html" });
    expect(text).toContain("<table");
    expect(text).not.toContain("<script");
  });

  it("rejects an unknown format", async () => {
    mockFetch({});
    const { text, isError } = await callTool("scrape", { url: ARTICLE_URL, format: "pdf" });
    expect(isError).toBe(true);
    expect(text).toContain("`format` must be one of");
  });

  it("appends all page links with includeLinks", async () => {
    mockFetch({ [ARTICLE_URL]: ARTICLE_HTML });
    const { text } = await callTool("scrape", { url: ARTICLE_URL, includeLinks: true });
    const links = text.slice(text.indexOf("## Links"));
    expect(links).toContain(`- ${SITE}/docs/`);
    expect(links).toContain("- https://external.test/partner");
    expect(links).toContain(`- ${SITE}/reference`);
  });

  it("truncates output to maxChars", async () => {
    mockFetch({ [ARTICLE_URL]: ARTICLE_HTML });
    const { text } = await callTool("scrape", { url: ARTICLE_URL, maxChars: 500 });
    expect(text).toMatch(/^[\s\S]{500}\n\n\[\.\.\. truncated, \d+ more characters\]$/);
  });

  it("warns about HTTP error statuses but still returns the content", async () => {
    mockFetch({ [ARTICLE_URL]: { body: ARTICLE_HTML, status: 404 } });
    const { text, isError } = await callTool("scrape", { url: ARTICLE_URL });
    expect(isError).toBe(false);
    expect(text.startsWith("Warning: the server responded with HTTP 404.")).toBe(true);
    expect(text).toContain("Getting Started");
  });

  it("returns non-HTML text content as-is", async () => {
    mockFetch({ [`${SITE}/notes.txt`]: { body: "plain *text* body", contentType: "text/plain" } });
    const { text } = await callTool("scrape", { url: `${SITE}/notes.txt` });
    expect(text).toBe(`URL: ${SITE}/notes.txt\nStatus: 200\n\nplain *text* body`);
  });

  it("rejects binary content types", async () => {
    mockFetch({ [`${SITE}/logo.png`]: { body: "binary", contentType: "image/png" } });
    const { text, isError } = await callTool("scrape", { url: `${SITE}/logo.png` });
    expect(isError).toBe(true);
    expect(text).toContain('Unsupported content type "image/png"');
  });

  it("explains that render requires the Browser Rendering binding", async () => {
    const mock = mockFetch({});
    const { text, isError } = await callTool("scrape", { url: ARTICLE_URL, render: true }, testEnv());
    expect(isError).toBe(true);
    expect(text).toContain("JavaScript rendering is not enabled");
    expect(mock.requested).toEqual([]);
  });

  it("validates the url argument", async () => {
    mockFetch({});
    expect((await callTool("scrape", {})).text).toBe("Error: `url` must be a non-empty string.");
    expect((await callTool("scrape", { url: "not a url" })).text).toBe("Error: Invalid URL: not a url");
  });
});
