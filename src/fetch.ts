import { FETCH_TIMEOUT_MS, USER_AGENT } from "./config";
import type { ToolContext } from "./context";
import { ToolError } from "./util";

export interface FetchedPage {
  url: string;
  status: number;
  contentType: string;
  body: string;
  isHtml: boolean;
}

/**
 * Fetches a page as text. With `render`, the page is loaded in a headless
 * browser through the Browser Rendering binding instead.
 */
export async function fetchPage(url: string, ctx: ToolContext, render = false): Promise<FetchedPage> {
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
      Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const contentType = response.headers.get("content-type") ?? "";
  const isHtml = /html|xml/i.test(contentType) || contentType === "";
  const isText = isHtml || /^text\/|json|javascript/i.test(contentType);
  if (!isText) {
    // Drain the body so the connection can be reused.
    await response.body?.cancel();
    throw new ToolError(`Unsupported content type "${contentType}" at ${url}.`);
  }
  const body = await response.text();
  return { url: response.url || url, status: response.status, contentType, body, isHtml };
}
