/**
 * emaf
 *
 * A stateless remote MCP server (Streamable HTTP transport, JSON responses)
 * running on Cloudflare Workers, for web research from Claude.
 *
 * Two ways to reach the MCP endpoint:
 *   - /mcp/<MCP_SECRET>: the secret is part of the URL.
 *   - /mcp with OAuth 2.1, when OAUTH_KV and AUTH_PASSWORD are configured.
 * Any other path returns 404.
 */

import type { Env } from "./env";
import { handleMcpRequest } from "./mcp/http";
import { getOAuthProvider, oauthEnabled, publicBaseUrl } from "./oauth";
import { timingSafeEqual } from "./util";

export type { Env } from "./env";

const notFound = () => new Response("Not found\n", { status: 404 });

function handleSecretPath(request: Request, env: Env, encodedSecret: string): Response | Promise<Response> {
  if (!env.MCP_SECRET) {
    // With OAuth configured the secret URL is optional; without either, the server is misconfigured.
    return oauthEnabled(env)
      ? notFound()
      : new Response("MCP_SECRET is not configured on this server.\n", { status: 500 });
  }
  let providedSecret: string;
  try {
    providedSecret = decodeURIComponent(encodedSecret);
  } catch {
    // Malformed percent-encoding can never match the secret.
    return notFound();
  }
  if (!timingSafeEqual(providedSecret, env.MCP_SECRET)) return notFound();
  return handleMcpRequest(request, env, env.MCP_SECRET);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response("emaf is running.\n", { headers: { "Content-Type": "text/plain" } });
    }

    // Checked before OAuth: /mcp/<secret> lies under the OAuth resource path /mcp.
    const secretMatch = url.pathname.match(/^\/mcp\/([^/]+)\/?$/);
    if (secretMatch) return handleSecretPath(request, env, secretMatch[1]);

    if (oauthEnabled(env)) {
      return getOAuthProvider(publicBaseUrl(url)).fetch(request, env, ctx);
    }
    return notFound();
  },
} satisfies ExportedHandler<Env>;
