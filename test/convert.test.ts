import { afterEach, describe, expect, it, vi } from "vitest";
import { Budget } from "../src/budget";
import { aiHtmlToMarkdown, fastHtmlText, htmlTitle, markdownLinks } from "../src/convert";
import type { AiBinding, ToMarkdownResult } from "../src/env";
import { researchTool } from "../src/tools/research";
import { QUESTION, RESEARCH_ROUTES } from "./api-fixtures";
import { ARTICLE_HTML, SITE } from "./fixtures";
import { callTool, mockFetch, testEnv } from "./helpers";

afterEach(() => {
  vi.restoreAllMocks();
});

/** A fake Workers AI binding whose toMarkdown returns `markdown` (or a value from `respond`). */
function fakeAi(respond: (html: string) => ToMarkdownResult | Promise<ToMarkdownResult>) {
  const calls: { html: string; options: unknown }[] = [];
  const ai: AiBinding = {
    run: async () => ({ data: [] }),
    toMarkdown: async (document, options) => {
      const html = await document.blob.text();
      calls.push({ html, options });
      return [await respond(html)];
    },
  };
  return { ai, calls };
}

describe("fastHtmlText", () => {
  const html = `<html><head><title>T</title><style>.x{}</style></head><body>
    <header>Site header</header><nav><a href="/">Home</a></nav>
    <script>var tracking = 1;</script>
    <main><h1>Main title</h1><p>First &amp; foremost&nbsp;it&#8217;s here.</p>
    <h2>Details</h2><ul><li>One</li><li>Two</li></ul></main>
    <aside>Sidebar</aside><form>Subscribe</form><footer>Footer text</footer>
    <!-- comment --></body></html>`;

  it("keeps headings and blocks and drops scripts, styles and page chrome", () => {
    const text = fastHtmlText(html, 10_000);
    expect(text).toBe("# Main title\n\nFirst & foremost it’s here.\n\n## Details\n\nOne\n\nTwo");
  });

  it("caps the output length", () => {
    expect(fastHtmlText(`<body><p>${"word ".repeat(10_000)}</p></body>`, 500)).toHaveLength(500);
  });

  it("reads the title without a DOM", () => {
    expect(htmlTitle("<head><title> A &amp; B\n title </title></head>")).toBe("A & B title");
    expect(htmlTitle("<p>no title</p>")).toBe("");
  });
});

describe("markdownLinks", () => {
  it("collects links, skips images, resolves relative URLs and drops fragments", () => {
    const md = [
      "[Guide](/docs/guide#install) and [again](https://site.test/docs/guide#usage).",
      "![Logo](https://site.test/logo.png)",
      "[![badge](https://img.test/b.svg)](https://ci.test/run)",
      "[mail](mailto:a@b.test)",
    ].join("\n");
    expect(markdownLinks(md, "https://site.test/start")).toEqual([
      "https://site.test/docs/guide",
      "https://ci.test/run",
    ]);
  });
});

describe("aiHtmlToMarkdown", () => {
  it("returns null without a toMarkdown binding", async () => {
    expect(await aiHtmlToMarkdown(undefined, new Budget(), "<p>x</p>", SITE)).toBeNull();
    expect(await aiHtmlToMarkdown({ run: async () => ({}) }, new Budget(), "<p>x</p>", SITE)).toBeNull();
  });

  it("passes the page URL and output format, cleans badges and counts the call", async () => {
    const { ai, calls } = fakeAi(() => ({
      format: "markdown",
      data: "[![CI](https://img.shields.io/badge/ci-ok-green)](https://ci.test)\n\n# Title\n\nBody text.",
    }));
    const budget = new Budget();
    const markdown = await aiHtmlToMarkdown(ai, budget, "<p>Body text.</p>", `${SITE}/page`);
    expect(markdown).toBe("# Title\n\nBody text.");
    expect(calls[0].options).toEqual({
      conversionOptions: { html: { hostname: `${SITE}/page` }, output: { format: "markdown" } },
    });
    expect(budget.usedInternal).toBe(1);
    expect(budget.used).toBe(0);
  });

  it("returns null on conversion errors and failures", async () => {
    const errored = fakeAi(() => ({ format: "error", error: "unsupported" }));
    expect(await aiHtmlToMarkdown(errored.ai, new Budget(), "<p>x</p>", SITE)).toBeNull();
    const thrown = fakeAi(() => {
      throw new Error("daily limit");
    });
    expect(await aiHtmlToMarkdown(thrown.ai, new Budget(), "<p>x</p>", SITE)).toBeNull();
    const empty = fakeAi(() => ({ format: "markdown", data: "  " }));
    expect(await aiHtmlToMarkdown(empty.ai, new Budget(), "<p>x</p>", SITE)).toBeNull();
  });

  it("does not call the binding when the Cloudflare services budget is exhausted", async () => {
    const { ai, calls } = fakeAi(() => ({ format: "markdown", data: "x" }));
    expect(await aiHtmlToMarkdown(ai, new Budget(45, 0), "<p>x</p>", SITE)).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe("tools with Workers AI conversion", () => {
  const PAGE = `${SITE}/docs/start/index.html`;

  it("scrape uses the AI conversion and the page title", async () => {
    mockFetch({ [PAGE]: ARTICLE_HTML });
    const { ai, calls } = fakeAi(() => ({ format: "markdown", data: "## Converted by AI\n\nBody." }));
    const { text } = await callTool("scrape", { url: PAGE }, testEnv({ AI: ai }));
    expect(calls).toHaveLength(1);
    expect(text).toBe(`# Article Title\nURL: ${PAGE}\nStatus: 200\n\n## Converted by AI\n\nBody.`);
  });

  it("scrape lists links found in the converted Markdown", async () => {
    mockFetch({ [PAGE]: ARTICLE_HTML });
    const { ai } = fakeAi(() => ({ format: "markdown", data: "See [setup](https://site.test/setup#a)." }));
    const { text } = await callTool("scrape", { url: PAGE, includeLinks: true }, testEnv({ AI: ai }));
    expect(text).toContain("## Links\n- https://site.test/setup");
  });

  it("scrape keeps the local pipeline for raw HTML and whole-page output", async () => {
    mockFetch({ [PAGE]: ARTICLE_HTML });
    const { ai, calls } = fakeAi(() => ({ format: "markdown", data: "AI" }));
    const html = await callTool("scrape", { url: PAGE, format: "html" }, testEnv({ AI: ai }));
    const whole = await callTool("scrape", { url: PAGE, onlyMainContent: false }, testEnv({ AI: ai }));
    expect(calls).toHaveLength(0);
    expect(html.text).toContain("<table");
    expect(whole.text).toContain("Site Logo");
  });

  it("scrape falls back to the local pipeline when the conversion fails", async () => {
    mockFetch({ [PAGE]: ARTICLE_HTML });
    const { ai } = fakeAi(() => ({ format: "error", error: "boom" }));
    const { text } = await callTool("scrape", { url: PAGE }, testEnv({ AI: ai }));
    expect(text).toContain("| Name | Value |");
  });

  it("crawl follows links from the converted Markdown", async () => {
    const mock = mockFetch({
      [`${SITE}/`]: "<html><head><title>Home</title></head><body>home</body></html>",
      [`${SITE}/next`]: "<html><head><title>Next</title></head><body>next</body></html>",
    });
    const { ai } = fakeAi((html) => ({
      format: "markdown",
      data: html.includes("home") ? "Go to [next](/next)." : "The end.",
    }));
    const { text } = await callTool("crawl", { url: `${SITE}/`, maxDepth: 1 }, testEnv({ AI: ai }));
    expect(mock.requested).toEqual([`${SITE}/`, `${SITE}/next`]);
    expect(text).toContain("# Next\nURL: https://site.test/next\n\nThe end.");
  });

  it("research converts pages with Workers AI and reports it", async () => {
    mockFetch(RESEARCH_ROUTES);
    const { ai, calls } = fakeAi(() => ({
      format: "markdown",
      data: "## Insulin\n\nIntermittent fasting improves insulin sensitivity in several trials, according to this converted page.",
    }));
    const budget = new Budget();
    const text = await researchTool.handler({ question: QUESTION }, { env: testEnv({ AI: ai }), budget });
    expect(calls.length).toBeGreaterThan(0);
    expect(text).toContain("Page conversion: Workers AI Markdown Conversion");
    expect(text).toContain("according to this converted page");
  });

  it("research uses local text extraction without the binding", async () => {
    mockFetch(RESEARCH_ROUTES);
    const { text } = await callTool("research", { question: QUESTION });
    expect(text).toContain("Page conversion: local text extraction");
  });
});
