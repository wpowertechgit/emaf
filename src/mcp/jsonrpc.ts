import { DEFAULT_PROTOCOL_VERSION, SERVER_INFO, SUPPORTED_PROTOCOL_VERSIONS } from "../config";
import type { ToolContext } from "../context";
import { TOOL_DEFINITIONS, TOOL_HANDLERS } from "../tools";
import { ToolError } from "../util";

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: JsonRpcId;
  method?: unknown;
  params?: Record<string, unknown>;
}

const SERVER_INSTRUCTIONS =
  "Research and web reading tools. Use `research` to look into a question or fact-check a claim (ranked passages from web pages, papers and preprints), `prior_art` to find existing open-source projects or packages for a feature, `scrape` to read one URL in full, `batch_scrape` to read a list of URLs, `crawl` to read several pages of one site, `map` to list a site's URLs, and `search` for raw web search results.";

export function rpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

export function rpcError(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/**
 * Handles one JSON-RPC message. Returns the response object, or null when no
 * response is due (notifications and client-sent responses).
 */
export async function handleMessage(message: JsonRpcRequest, ctx: ToolContext): Promise<object | null> {
  const hasId = message !== null && typeof message === "object" && "id" in message && message.id !== undefined;
  const id: JsonRpcId = hasId ? (message.id as JsonRpcId) : null;

  if (
    !message ||
    typeof message !== "object" ||
    message.jsonrpc !== "2.0" ||
    typeof message.method !== "string"
  ) {
    // Responses sent by the client (no method) are accepted and ignored.
    if (message && typeof message === "object" && !("method" in message)) return null;
    return rpcError(id, -32600, "Invalid Request");
  }

  // Notifications get no response.
  if (!hasId) return null;

  const params = message.params ?? {};

  switch (message.method) {
    case "initialize": {
      const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : DEFAULT_PROTOCOL_VERSION;
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: SERVER_INSTRUCTIONS,
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: TOOL_DEFINITIONS });
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const handler = TOOL_HANDLERS[name];
      if (!handler) return rpcError(id, -32602, `Unknown tool: ${name}`);
      const args =
        params.arguments && typeof params.arguments === "object"
          ? (params.arguments as Record<string, unknown>)
          : {};
      try {
        const text = await handler(args, ctx);
        return rpcResult(id, { content: [{ type: "text", text }], isError: false });
      } catch (err) {
        const messageText =
          err instanceof ToolError
            ? err.message
            : err instanceof Error
              ? `${err.name}: ${err.message}`
              : String(err);
        return rpcResult(id, { content: [{ type: "text", text: `Error: ${messageText}` }], isError: true });
      }
    }
    case "resources/list":
      return rpcResult(id, { resources: [] });
    case "prompts/list":
      return rpcResult(id, { prompts: [] });
    default:
      return rpcError(id, -32601, `Method not found: ${message.method}`);
  }
}
