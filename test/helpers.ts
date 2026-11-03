import { createExecutionContext } from "cloudflare:test";
import { vi } from "vitest";
import worker, { type Env } from "../src/index";

export const TEST_SECRET = "test-secret";
export const BASE_URL = "https://emaf.test";
export const MCP_URL = `${BASE_URL}/mcp/${TEST_SECRET}`;

export interface FixtureResponse {
  body: string | Uint8Array<ArrayBuffer>;
  status?: number;
  contentType?: string;
  headers?: Record<string, string>;
}

export type FixtureRoutes = Record<string, FixtureResponse | string>;

export interface FetchMock {
  /** Every URL the worker requested, in order. */
  requested: string[];
  /** Request headers by URL (last request wins). */
  headers: Map<string, Headers>;
  /** URLs that had no fixture. Tests should assert this stays empty. */
  unexpected: string[];
}

function findRoute(routes: FixtureRoutes, url: string): FixtureResponse | string | undefined {
  if (routes[url] !== undefined) return routes[url];
  // Keys ending in "*" match by prefix; the longest matching prefix wins.
  let best: string | undefined;
  for (const key of Object.keys(routes)) {
    if (key.endsWith("*") && url.startsWith(key.slice(0, -1)) && (!best || key.length > best.length)) best = key;
  }
  return best ? routes[best] : undefined;
}

/**
 * Replaces the global fetch with a router over fixture responses. Unknown URLs
 * are recorded and rejected, so tests can never reach the network. Route keys
 * are exact URLs, or prefixes ending in "*".
 */
export function mockFetch(routes: FixtureRoutes): FetchMock {
  const mock: FetchMock = { requested: [], headers: new Map(), unexpected: [] };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    mock.requested.push(url);
    mock.headers.set(url, new Headers(init?.headers));
    const route = findRoute(routes, url);
    if (route === undefined) {
      mock.unexpected.push(url);
      throw new Error(`Unexpected outbound request in test: ${url}`);
    }
    const fixture = typeof route === "string" ? { body: route } : route;
    return new Response(fixture.body, {
      status: fixture.status ?? 200,
      headers: { "Content-Type": fixture.contentType ?? "text/html; charset=utf-8", ...fixture.headers },
    });
  });
  return mock;
}

/** Test environment. The in-memory rate limiter is off unless a test enables it. */
export function testEnv(overrides: Partial<Env> = {}): Env {
  return { MCP_SECRET: TEST_SECRET, RATE_LIMIT_PER_MINUTE: "0", ...overrides };
}

export function request(
  path: string,
  init: RequestInit = {},
  env: Env = testEnv(),
): Promise<Response> {
  return worker.fetch(new Request(`${BASE_URL}${path}`, init), env, createExecutionContext());
}

export function postMcp(body: unknown, env: Env = testEnv(), secret = TEST_SECRET): Promise<Response> {
  return request(
    `/mcp/${secret}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
    env,
  );
}

interface ToolCallResult {
  text: string;
  isError: boolean;
}

/** Calls a tool through the full MCP request path and returns its text output. */
export async function callTool(
  name: string,
  args: Record<string, unknown>,
  env: Env = testEnv(),
): Promise<ToolCallResult> {
  const response = await postMcp(
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
    env,
  );
  if (response.status !== 200) {
    throw new Error(`tools/call returned HTTP ${response.status}`);
  }
  const data = (await response.json()) as {
    result?: { content: { type: string; text: string }[]; isError: boolean };
    error?: { message: string };
  };
  if (!data.result) {
    throw new Error(`tools/call returned a JSON-RPC error: ${data.error?.message}`);
  }
  return { text: data.result.content[0].text, isError: data.result.isError };
}
