import { Budget } from "../budget";
import type { Env } from "../env";
import { rateLimitKey } from "../ratelimit";
import { type JsonRpcRequest, handleMessage, rpcError } from "./jsonrpc";

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Authorization",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function accepted(): Response {
  return new Response(null, { status: 202, headers: CORS_HEADERS });
}

/**
 * Stateless MCP Streamable HTTP transport with JSON responses only.
 * The caller is responsible for authenticating the request.
 */
export async function handleMcpRequest(request: Request, env: Env): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== "POST") {
    // Stateless server: no server-initiated SSE stream and no sessions to delete.
    return new Response("Method not allowed\n", {
      status: 405,
      headers: { Allow: "POST, OPTIONS", ...CORS_HEADERS },
    });
  }

  // One budget per invocation: batched tool calls share the subrequest limit.
  const ctx = {
    env,
    budget: new Budget(),
    rateLimitKey: env.MCP_SECRET ? await rateLimitKey(env.MCP_SECRET) : undefined,
  };

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json(rpcError(null, -32700, "Parse error"), 400);
  }

  if (Array.isArray(payload)) {
    if (payload.length === 0) return json(rpcError(null, -32600, "Invalid Request"), 400);
    const responses = (
      await Promise.all(payload.map((m) => handleMessage(m as JsonRpcRequest, ctx)))
    ).filter((r): r is object => r !== null);
    return responses.length ? json(responses) : accepted();
  }

  const response = await handleMessage(payload as JsonRpcRequest, ctx);
  return response ? json(response) : accepted();
}
