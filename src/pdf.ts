/** PDFs above this size are rejected before parsing to stay within Worker memory. */
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

export interface PdfText {
  title: string;
  totalPages: number;
  /** Text per page, whitespace-normalized. */
  pages: string[];
}

function normalize(text: string): string {
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Extracts the text layer of a PDF with unpdf (a serverless build of pdf.js).
 * The module is loaded on first use, so requests without PDFs do not pay for
 * initializing it.
 */
export async function extractPdfText(bytes: Uint8Array): Promise<PdfText> {
  const { getDocumentProxy, extractText, getMeta } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const [{ totalPages, text }, meta] = await Promise.all([
    extractText(pdf, { mergePages: false }),
    getMeta(pdf).catch(() => ({ info: {} as Record<string, unknown> })),
  ]);
  const info = (meta.info ?? {}) as Record<string, unknown>;
  const title = typeof info.Title === "string" ? info.Title.trim() : "";
  return { title, totalPages, pages: text.map(normalize) };
}

const NO_TEXT_LAYER =
  "(This PDF has no extractable text layer. It is probably a scanned document; text extraction needs OCR, which EMAF does not do.)";

/**
 * Renders extracted PDF text: Markdown with one section per page, or plain
 * text with pages separated by blank lines for format "text".
 */
export function renderPdf(pdf: PdfText, format: string): string {
  if (!pdf.pages.some((p) => p.length > 0)) return NO_TEXT_LAYER;
  if (format === "text") return pdf.pages.filter(Boolean).join("\n\n");
  return pdf.pages
    .map((text, i) => (text ? `## Page ${i + 1}\n\n${text}` : ""))
    .filter(Boolean)
    .join("\n\n");
}

/** Converts fetched PDF bytes into the standard tool output header and content. */
export async function pdfOutput(bytes: Uint8Array, url: string, status: number, format: string): Promise<string> {
  let pdf: PdfText;
  try {
    pdf = await extractPdfText(bytes);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return `URL: ${url}\nStatus: ${status}\nType: PDF\n\n(Could not extract text from this PDF: ${reason})`;
  }
  const title = pdf.title ? `# ${pdf.title}\n` : "";
  return `${title}URL: ${url}\nStatus: ${status}\nType: PDF, ${pdf.totalPages} page(s)\n\n${renderPdf(pdf, format)}`;
}
