import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_PDF_BYTES } from "../src/pdf";
import { SITE } from "./fixtures";
import { callTool, mockFetch } from "./helpers";
import { makePdf } from "./pdf-fixture";

afterEach(() => {
  vi.restoreAllMocks();
});

const PDF_URL = `${SITE}/paper.pdf`;
const PDF = makePdf(
  [
    ["Intermittent fasting study", "Results (primary outcome) improved."],
    ["Second page discussion."],
  ],
  "Fasting Report",
);

describe("PDF extraction", () => {
  it("returns the text of each page as Markdown with the document title", async () => {
    mockFetch({ [PDF_URL]: { body: PDF, contentType: "application/pdf" } });
    const { text, isError } = await callTool("scrape", { url: PDF_URL });
    expect(isError).toBe(false);
    expect(text).toContain("# Fasting Report\n");
    expect(text).toContain(`URL: ${PDF_URL}\nStatus: 200\nType: PDF, 2 page(s)`);
    expect(text).toMatch(/## Page 1\n\nIntermittent fasting study\s+Results \(primary outcome\) improved\./);
    expect(text).toContain("## Page 2\n\nSecond page discussion.");
  });

  it("returns plain text with format=text", async () => {
    mockFetch({ [PDF_URL]: { body: PDF, contentType: "application/pdf" } });
    const { text } = await callTool("scrape", { url: PDF_URL, format: "text" });
    expect(text).not.toContain("## Page");
    expect(text).toContain("Second page discussion.");
  });

  it("detects PDFs served as octet-stream by their extension", async () => {
    mockFetch({ [PDF_URL]: { body: PDF, contentType: "application/octet-stream" } });
    const { text } = await callTool("scrape", { url: PDF_URL });
    expect(text).toContain("Type: PDF, 2 page(s)");
  });

  it("explains PDFs without a text layer", async () => {
    mockFetch({ [PDF_URL]: { body: makePdf([[]]), contentType: "application/pdf" } });
    const { text, isError } = await callTool("scrape", { url: PDF_URL });
    expect(isError).toBe(false);
    expect(text).toContain("no extractable text layer");
  });

  it("reports a broken PDF instead of failing", async () => {
    mockFetch({ [PDF_URL]: { body: "%PDF-1.4 this is not really a pdf", contentType: "application/pdf" } });
    const { text, isError } = await callTool("scrape", { url: PDF_URL });
    expect(isError).toBe(false);
    expect(text).toContain("Could not extract text from this PDF");
  });

  it("rejects PDFs above the size limit before downloading them", async () => {
    mockFetch({
      [PDF_URL]: {
        body: PDF,
        contentType: "application/pdf",
        headers: { "Content-Length": String(MAX_PDF_BYTES + 1) },
      },
    });
    const { text, isError } = await callTool("scrape", { url: PDF_URL });
    expect(isError).toBe(true);
    expect(text).toContain("larger than 10 MB");
  });

  it("extracts PDFs in batch_scrape", async () => {
    mockFetch({ [PDF_URL]: { body: PDF, contentType: "application/pdf" } });
    const { text } = await callTool("batch_scrape", { urls: [PDF_URL] });
    expect(text).toContain("## [1] # Fasting Report");
    expect(text).toContain("Second page discussion.");
  });

  it("still skips PDFs in crawl", async () => {
    mockFetch({
      [`${SITE}/`]: `<html><body><a href="/file">file</a></body></html>`,
      [`${SITE}/file`]: { body: PDF, contentType: "application/pdf" },
    });
    const { text } = await callTool("crawl", { url: `${SITE}/`, maxDepth: 1 });
    expect(text).toContain(`${SITE}/file: Unsupported content type "application/pdf"`);
  });
});
