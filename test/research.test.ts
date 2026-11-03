import { afterEach, describe, expect, it, vi } from "vitest";
import { Budget } from "../src/budget";
import type { AiBinding } from "../src/env";
import { researchTool } from "../src/tools/research";
import { QUESTION, RESEARCH_ROUTES } from "./api-fixtures";
import { callTool, mockFetch, testEnv } from "./helpers";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Source blocks in output order: "## [n] Title". */
function sourceTitles(text: string): string[] {
  return Array.from(text.matchAll(/^## \[\d+\] (.+)$/gm), (m) => m[1]);
}

function sourceBlock(text: string, title: string): string {
  const start = text.indexOf(`] ${title}\n`);
  if (start === -1) return "";
  const next = text.indexOf("\n## [", start);
  return text.slice(start, next === -1 ? undefined : next);
}

describe("research", () => {
  it("combines web, OpenAlex and arXiv sources without touching the network", async () => {
    const mock = mockFetch(RESEARCH_ROUTES);
    const { text, isError } = await callTool("research", { question: QUESTION });
    expect(isError).toBe(false);
    expect(mock.unexpected).toEqual([]);

    const openAlexUrl = new URL(mock.requested.find((u) => u.startsWith("https://api.openalex.org/")) ?? "");
    expect(openAlexUrl.searchParams.get("search")).toBe("intermittent fasting improve insulin sensitivity");
    expect(openAlexUrl.searchParams.get("select")).toContain("abstract_inverted_index");
    const arxivUrl = new URL(mock.requested.find((u) => u.startsWith("https://export.arxiv.org/")) ?? "");
    expect(arxivUrl.searchParams.get("search_query")).toBe(
      "all:intermittent AND all:fasting AND all:improve AND all:insulin",
    );
    // PDFs are not fetched; their snippet is used instead.
    expect(mock.requested).not.toContain("https://files.test/report.pdf");

    expect(text).toContain("Searched: web (DuckDuckGo; 2 queries, 3 page(s) read), OpenAlex (3 works), arXiv (2 preprints)");
    expect(text).toContain("Ranking: BM25\n");
  });

  it("reports paper metadata and marks preprints as not peer reviewed", async () => {
    mockFetch(RESEARCH_ROUTES);
    const { text } = await callTool("research", { question: QUESTION });

    const paper = sourceBlock(text, "Intermittent fasting and insulin sensitivity: a randomized trial");
    expect(paper).toContain(
      "Type: paper · Date: 2023-05-04 · Venue: Journal of Metabolism · Citations: 1,234 · DOI: 10.1000/fasting.2023",
    );
    expect(paper).toContain("Authors: Ada Lovelace, Alan Turing, Grace Hopper et al.");
    expect(paper).toContain("URL: https://doi.org/10.1000/fasting.2023");

    const preprint = sourceBlock(text, "Fasting Windows and Insulin Response: A Data-Driven Analysis");
    expect(preprint).toContain("Type: preprint, NOT peer reviewed · Date: 2024-01-02 · Venue: arXiv");
    expect(preprint).toContain("Journal reference: Metabolic Data 12 (2024) 1-9");
    expect(preprint).toContain("URL: https://arxiv.org/abs/2401.00001v1");
    expect(preprint).toContain("improved insulin sensitivity & lower glucose variability");

    expect(sourceBlock(text, "Modeling time restricted eating")).toContain("Type: preprint, NOT peer reviewed");
  });

  it("ranks relevant passages and leaves out irrelevant ones", async () => {
    mockFetch(RESEARCH_ROUTES);
    const { text } = await callTool("research", { question: QUESTION });
    const titles = sourceTitles(text);
    expect(titles).toContain("Fasting and insulin");
    expect(titles).not.toContain("Gardening");
    expect(titles).not.toContain("Soil erosion in alpine meadows");
    expect(text).not.toContain("Hydration and sleep");
    expect(sourceBlock(text, "Fasting and insulin")).toContain(
      "Section: What studies say about fasting > Insulin sensitivity\n> Several trials report",
    );
    expect(text).toContain("Type: web page (search snippet only, page not read)");
  });

  it("keeps one copy of passages repeated across sources", async () => {
    mockFetch(RESEARCH_ROUTES);
    const { text } = await callTool("research", { question: QUESTION });
    const occurrences = text.split("In this randomized controlled trial intermittent fasting").length - 1;
    expect(occurrences).toBe(1);
    // The arXiv copy of the OpenAlex paper is merged by title.
    expect(sourceTitles(text).filter((t) => t.startsWith("Intermittent fasting and insulin sensitivity"))).toHaveLength(1);
  });

  it("searches only the web with sources=web", async () => {
    const mock = mockFetch(RESEARCH_ROUTES);
    const { text } = await callTool("research", { question: QUESTION, sources: "web" });
    expect(mock.requested.some((u) => u.includes("openalex") || u.includes("arxiv"))).toBe(false);
    expect(text).not.toContain("Type: paper");
  });

  it("searches only academic sources with sources=academic", async () => {
    const mock = mockFetch(RESEARCH_ROUTES);
    const { text } = await callTool("research", { question: QUESTION, sources: "academic", depth: "quick" });
    expect(mock.requested.every((u) => u.includes("openalex") || u.includes("arxiv"))).toBe(true);
    expect(text).toContain("Type: paper");
    expect(text).not.toContain("Type: web page");
  });

  it("continues with the remaining sources when one API fails", async () => {
    mockFetch({ ...RESEARCH_ROUTES, "https://api.openalex.org/works?*": { body: "boom", status: 500 } });
    const { text, isError } = await callTool("research", { question: QUESTION });
    expect(isError).toBe(false);
    expect(text).toContain("- OpenAlex failed: OpenAlex: HTTP 500.");
    expect(text).toContain("Type: preprint, NOT peer reviewed");
    expect(text).toContain("Type: web page");
  });

  it("degrades to search snippets when the subrequest budget runs low", async () => {
    const mock = mockFetch(RESEARCH_ROUTES);
    const budget = new Budget(5);
    const text = await researchTool.handler({ question: QUESTION }, { env: testEnv(), budget });
    // 2 web searches + OpenAlex + arXiv leave one subrequest for pages.
    expect(budget.used).toBe(5);
    expect(mock.requested).toHaveLength(5);
    expect(text).toContain("Subrequest budget is low: read 1 of 3 planned pages");
    expect(text).toContain("Subrequests used: 5 of 5");
  });

  it("stays within maxChars", async () => {
    mockFetch(RESEARCH_ROUTES);
    const { text } = await callTool("research", { question: QUESTION, maxChars: 2000 });
    expect(text.length).toBeLessThanOrEqual(2000 + 200);
    expect(text).toMatch(/more relevant passage\(s\) omitted to stay within 2000 characters/);
  });

  it("reranks the top passages with embeddings when an AI binding is configured", async () => {
    const mock = mockFetch(RESEARCH_ROUTES);
    const run = vi.fn(async (_model: string, inputs: Record<string, unknown>) => {
      const texts = inputs.text as string[];
      // The query and the gardening-free arXiv preprint point the same way; everything else is orthogonal.
      return { data: texts.map((t, i) => (i === 0 || t.includes("wearable glucose") ? [1, 0] : [0, 1])) };
    });
    const ai: AiBinding = { run };
    const budget = new Budget();
    const text = await researchTool.handler({ question: QUESTION }, { env: testEnv({ AI: ai }), budget });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toBe("@cf/baai/bge-base-en-v1.5");
    expect(sourceTitles(text)[0]).toBe("Fasting Windows and Insulin Response: A Data-Driven Analysis");
    expect(text).toContain("Ranking: BM25, then embedding rerank of the top");
    // Fetches count as external subrequests, the AI call against the Cloudflare services pool.
    expect(budget.used).toBe(mock.requested.length);
    expect(budget.usedInternal).toBe(1);
  });

  it("falls back to BM25 when the embedding call fails", async () => {
    mockFetch(RESEARCH_ROUTES);
    const ai: AiBinding = {
      run: async () => {
        throw new Error("daily neuron limit reached");
      },
    };
    const text = await researchTool.handler({ question: QUESTION }, { env: testEnv({ AI: ai }), budget: new Budget() });
    expect(text).toContain("Embedding rerank failed, using BM25 only: daily neuron limit reached");
    expect(text).toContain("Ranking: BM25\n");
  });

  it("reads URLs from the client's own web search instead of searching itself", async () => {
    const mock = mockFetch(RESEARCH_ROUTES);
    const { text, isError } = await callTool("research", {
      question: QUESTION,
      urls: ["https://health.test/fasting", "https://garden.test/tomatoes", "https://health.test/fasting#dup"],
    });
    expect(isError).toBe(false);
    expect(mock.unexpected).toEqual([]);
    expect(mock.requested.some((u) => u.includes("duckduckgo"))).toBe(false);
    expect(mock.requested).toContain("https://health.test/fasting");
    expect(mock.requested.filter((u) => u === "https://health.test/fasting")).toHaveLength(1);
    expect(text).toContain("Searched: web (2 URL(s) provided, 2 page(s) read), OpenAlex");
    // The page title comes from the fetched page, since there is no search result title.
    expect(sourceTitles(text)).toContain("Fasting and insulin");
    expect(sourceTitles(text)).not.toContain("Gardening");
  });

  it("leaves out reference lists, which match every keyword but say nothing", async () => {
    const citations = Array.from(
      { length: 12 },
      (_, i) =>
        `${i + 1}. Author A, Author B, et al. Intermittent fasting and insulin sensitivity in adults. J Metab. 20${10 + i};${i}:1-9. doi: 10.1000/x${i}. [PubMed](https://pubmed.test/${i})`,
    ).join("\n");
    const page = `<html><head><title>Review page</title></head><body><main>
      <h1>Review</h1>
      <p>Intermittent fasting improved insulin sensitivity in the pooled trials of this review, with the largest effect in adults with prediabetes and a smaller effect in healthy adults.</p>
      <h2>References</h2><p>${citations.replace(/\n/g, "<br>")}</p>
      <h2>Notes</h2><p>${citations.replace(/\n/g, "<br>")}</p>
      <div>${citations.replace(/\n/g, "<br>")}</div>
    </main></body></html>`;
    mockFetch({ ...RESEARCH_ROUTES, "https://review.test/page": page });
    const { text } = await callTool("research", { question: QUESTION, urls: ["https://review.test/page"] });
    expect(text).toContain("pooled trials of this review");
    expect(text).not.toContain("Section: Review > References");
    expect(text).not.toContain("doi: 10.1000/x3");
  });

  it("suggests passing urls when its own web search fails", async () => {
    mockFetch({ ...RESEARCH_ROUTES, "https://html.duckduckgo.com/html/": "<html></html>" });
    const { text } = await callTool("research", { question: QUESTION });
    expect(text).toContain("pass the result URLs as `urls`");
  });

  it("validates its arguments", async () => {
    mockFetch({});
    expect((await callTool("research", {})).text).toBe("Error: `question` must be a non-empty string.");
    expect((await callTool("research", { question: "x", depth: "huge" })).text).toContain("`depth` must be one of");
    expect((await callTool("research", { question: "x", sources: "books" })).text).toContain("`sources` must be one of");
    expect((await callTool("research", { question: "x", urls: "https://a.test" })).text).toContain(
      "`urls` must be an array",
    );
    expect((await callTool("research", { question: "x", urls: ["ftp://a.test/f"] })).text).toContain(
      "Only http and https URLs",
    );
    const tooMany = Array.from({ length: 11 }, (_, i) => `https://a.test/${i}`);
    expect((await callTool("research", { question: "x", urls: tooMany })).text).toContain("at most 10 URLs");
  });
});
