import { FETCH_TIMEOUT_MS, USER_AGENT } from "./config";
import type { ToolContext } from "./context";
import { MAX_PDF_BYTES } from "./pdf";
import { ToolError } from "./util";

export interface FetchedPage {
  url: string;
  status: number;
  contentType: string;
  body: string;
  isHtml: boolean;
  /** Raw bytes when the response is a PDF and the caller allowed PDFs; body is empty then. */
  pdf?: Uint8Array;
}

export interface FetchOptions {
  /** Return PDF responses as bytes instead of rejecting them. */
  allowPdf?: boolean;
}

function looksLikePdf(contentType: string, url: string): boolean {
  if (/application\/(?:x-)?pdf/i.test(contentType)) return true;
  return /(?:application|binary)\/octet-stream/i.test(contentType) && /\.pdf(?:$|[?#])/i.test(url);
}

/**
 * Fetches a page as text. With `render`, the page is loaded in a headless
 * browser through the Browser Rendering binding instead.
 */
export async function fetchPage(
  url: string,
  ctx: ToolContext,
  render = false,
  options: FetchOptions = {},
): Promise<FetchedPage> {
  const { env, budget } = ctx;
  if (render) {
    if (!env.BROWSER) {
      throw new ToolError(
        "JavaScript rendering is not enabled on this server (missing Browser Rendering binding). Retry with render=false.",
      );
    }
    budget.take();
    const puppeteer = (await import("@cloudflare/puppeteer")).default;
    const browser = await puppeteer.launch(env.BROWSER);
    try {
      const page = await browser.newPage();
      await page.setUserAgent(USER_AGENT);
      const response = await page.goto(url, { waitUntil: "networkidle0", timeout: 30_000 });
      const body = await page.content();
      return {
        url: page.url(),
        status: response?.status() ?? 200,
        contentType: "text/html",
        body,
        isHtml: true,
      };
    } finally {
      await browser.close();
    }
  }

  const response = await budget.fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: options.allowPdf
        ? "text/html,application/xhtml+xml,application/pdf;q=0.9,text/plain;q=0.9,*/*;q=0.8"
        : "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const contentType = response.headers.get("content-type") ?? "";
  const finalUrl = response.url || url;
  if (options.allowPdf && looksLikePdf(contentType, finalUrl)) {
    const pdf = await readPdf(response, url);
    return { url: finalUrl, status: response.status, contentType, body: "", isHtml: false, pdf };
  }
  const isHtml = /html|xml/i.test(contentType) || contentType === "";
  const isText = isHtml || /^text\/|json|javascript/i.test(contentType);
  if (!isText) {
    // Drain the body so the connection can be reused.
    await response.body?.cancel();
    throw new ToolError(`Unsupported content type "${contentType}" at ${url}.`);
  }
  const body = await response.text();
  return { url: finalUrl, status: response.status, contentType, body, isHtml };
}

async function readPdf(response: Response, url: string): Promise<Uint8Array> {
  const tooLarge = () =>
    new ToolError(`PDF at ${url} is larger than ${MAX_PDF_BYTES / 1024 / 1024} MB, the limit for text extraction.`);
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_PDF_BYTES) {
    await response.body?.cancel();
    throw tooLarge();
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_PDF_BYTES) throw tooLarge();
  return bytes;
}
