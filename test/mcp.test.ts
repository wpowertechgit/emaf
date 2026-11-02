import { afterEach, describe, expect, it, vi } from "vitest";
import { postMcp, request, testEnv } from "./helpers";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("routing", () => {
  it("serves the health check", async () => {
    const response = await request("/health");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("emaf is running");
  });

  it("returns 404 for a wrong secret", async () => {
    const response = await postMcp({ jsonrpc: "2.0", id: 1, method: "ping" }, testEnv(), "wrong-secret");
    expect(response.status).toBe(404);
  });

  it("returns 404 for a secret that is a prefix of the real one", async () => {
    const response = await postMcp({ jsonrpc: "2.0", id: 1, method: "ping" }, testEnv(), "test");
    expect(response.status).toBe(404);
  });

  it("returns 404 for paths outside /mcp/<secret>", async () => {
    for (const path of ["/mcp", "/mcp/", "/other", "/mcp/test-secret/extra"]) {
      const response = await request(path, { method: "POST", body: "{}" });
      expect(response.status, path).toBe(404);
    }
  });

  it("returns 404 for a secret with malformed percent-encoding", async () => {
    const response = await request("/mcp/%E0%A4%A", { method: "POST", body: "{}" });
    expect(response.status).toBe(404);
  });

  it("accepts a trailing slash after the secret", async () => {
    const response = await request("/mcp/test-secret/", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(response.status).toBe(200);
  });

  it("returns 500 when MCP_SECRET is not configured", async () => {
    const response = await postMcp({ jsonrpc: "2.0", id: 1, method: "ping" }, {});
    expect(response.status).toBe(500);
  });

  it("rejects GET and DELETE with 405", async () => {
    for (const method of ["GET", "DELETE"]) {
      const response = await request("/mcp/test-secret", { method });
      expect(response.status, method).toBe(405);
      expect(response.headers.get("Allow")).toBe("POST, OPTIONS");
    }
  });

  it("answers CORS preflight with 204", async () => {
    const response = await request("/mcp/test-secret", { method: "OPTIONS" });
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

describe("JSON-RPC handling", () => {
  it("completes the initialize handshake", async () => {
    const response = await postMcp({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test-client", version: "0.0.0" },
      },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    const body = (await response.json()) as { id: number; result: Record<string, unknown> };
    expect(body.id).toBe(1);
    expect(body.result.protocolVersion).toBe("2025-06-18");
    expect(body.result.serverInfo).toEqual({ name: "emaf", version: "1.1.0" });
    expect(body.result.capabilities).toEqual({ tools: { listChanged: false } });
  });

  it("negotiates down to the latest supported version for unknown versions", async () => {
    const response = await postMcp({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "1999-01-01" },
    });
    const body = (await response.json()) as { result: { protocolVersion: string } };
    expect(body.result.protocolVersion).toBe("2025-06-18");
  });

  it("keeps an older supported protocol version", async () => {
    const response = await postMcp({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05" },
    });
    const body = (await response.json()) as { result: { protocolVersion: string } };
    expect(body.result.protocolVersion).toBe("2024-11-05");
  });

  it("returns 202 with no body for notifications", async () => {
    const response = await postMcp({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
  });

  it("returns 202 for client responses without a method", async () => {
    const response = await postMcp({ jsonrpc: "2.0", id: 7, result: {} });
    expect(response.status).toBe(202);
  });

  it("returns 202 for a batch made only of notifications", async () => {
    const response = await postMcp([
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 1 } },
    ]);
    expect(response.status).toBe(202);
  });

  it("answers only the requests in a mixed batch", async () => {
    const response = await postMcp([
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: "a", method: "ping" },
      { jsonrpc: "2.0", id: "b", method: "ping" },
    ]);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { id: string; result: unknown }[];
    expect(body).toEqual([
      { jsonrpc: "2.0", id: "a", result: {} },
      { jsonrpc: "2.0", id: "b", result: {} },
    ]);
  });

  it("rejects an empty batch", async () => {
    const response = await postMcp([]);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32600);
  });

  it("returns a parse error for invalid JSON", async () => {
    const response = await postMcp("{not json");
    expect(response.status).toBe(400);
    const body = (await response.json()) as { id: null; error: { code: number } };
    expect(body.id).toBeNull();
    expect(body.error.code).toBe(-32700);
  });

  it("returns Invalid Request for a message without jsonrpc 2.0", async () => {
    const response = await postMcp({ jsonrpc: "1.0", id: 3, method: "ping" });
    const body = (await response.json()) as { id: number; error: { code: number } };
    expect(body.id).toBe(3);
    expect(body.error.code).toBe(-32600);
  });

  it("returns Method not found for unknown methods", async () => {
    const response = await postMcp({ jsonrpc: "2.0", id: 1, method: "does/not/exist" });
    const body = (await response.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32601);
  });

  it("lists the tools in a stable order", async () => {
    const response = await postMcp({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const body = (await response.json()) as {
      result: { tools: { name: string; inputSchema: { type: string; required: string[] } }[] };
    };
    expect(body.result.tools.map((t) => t.name)).toEqual(["research", "prior_art", "scrape", "map", "crawl", "search"]);
    for (const tool of body.result.tools) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.required.length).toBeGreaterThan(0);
    }
  });

  it("returns empty resource and prompt lists", async () => {
    const response = await postMcp([
      { jsonrpc: "2.0", id: 1, method: "resources/list" },
      { jsonrpc: "2.0", id: 2, method: "prompts/list" },
    ]);
    const body = (await response.json()) as { result: unknown }[];
    expect(body[0].result).toEqual({ resources: [] });
    expect(body[1].result).toEqual({ prompts: [] });
  });

  it("returns Invalid params for an unknown tool", async () => {
    const response = await postMcp({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "nope", arguments: {} },
    });
    const body = (await response.json()) as { error: { code: number; message: string } };
    expect(body.error.code).toBe(-32602);
    expect(body.error.message).toContain("nope");
  });

  it("reports tool failures as isError results, not JSON-RPC errors", async () => {
    const response = await postMcp({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "scrape", arguments: { url: "ftp://example.test/file" } },
    });
    const body = (await response.json()) as {
      result: { isError: boolean; content: { text: string }[] };
    };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toBe("Error: Only http and https URLs are supported.");
  });
});
