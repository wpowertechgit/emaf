/**
 * emaf
 *
 * A stateless remote MCP server (Streamable HTTP transport, JSON responses)
 * running on Cloudflare Workers. Tools:
 *   - scrape: fetch one URL and return clean Markdown
 *   - map:    list the URLs found on a page and in the site's sitemap
 *   - crawl:  breadth-first crawl of a site, returning Markdown per page
 *   - search: web search (Brave API if configured, DuckDuckGo HTML otherwise)
 *
 * The endpoint is /mcp/<MCP_SECRET>. Any other path returns 404.
 */

import type { Env } from "./env";
import { handleMcpRequest } from "./mcp/http";

export type { Env } from "./env";

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response("emaf is running.\n", { headers: { "Content-Type": "text/plain" } });
    }

    const match = url.pathname.match(/^\/mcp\/([^/]+)\/?$/);
    if (!match) return new Response("Not found\n", { status: 404 });

    if (!env.MCP_SECRET) {
      return new Response("MCP_SECRET is not configured on this server.\n", { status: 500 });
    }
    let providedSecret: string;
    try {
      providedSecret = decodeURIComponent(match[1]);
    } catch {
      // Malformed percent-encoding can never match the secret.
      return new Response("Not found\n", { status: 404 });
    }
    if (!timingSafeEqual(providedSecret, env.MCP_SECRET)) {
      return new Response("Not found\n", { status: 404 });
    }

    return handleMcpRequest(request, env);
  },
} satisfies ExportedHandler<Env>;
