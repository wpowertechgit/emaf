import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RateLimitBinding } from "../src/env";
import { allowToolCall, rateLimitKey, resetRateLimitState } from "../src/ratelimit";
import { ARTICLE_HTML, SITE } from "./fixtures";
import { TEST_SECRET, callTool, mockFetch, postMcp, testEnv } from "./helpers";

beforeEach(() => {
  resetRateLimitState();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const PAGE = `${SITE}/page`;

describe("rate limiting", () => {
  it("derives a key from the secret without containing it", async () => {
    const key = await rateLimitKey(TEST_SECRET);
    expect(key).toMatch(/^mcp:[0-9a-f]{16}$/);
    expect(key).not.toContain(TEST_SECRET);
    expect(await rateLimitKey(TEST_SECRET)).toBe(key);
    expect(await rateLimitKey("other-secret")).not.toBe(key);
  });

  it("limits tool calls per minute with the in-memory fallback", async () => {
    const mock = mockFetch({ [PAGE]: ARTICLE_HTML });
    const env = testEnv({ RATE_LIMIT_PER_MINUTE: "2" });
    expect((await callTool("scrape", { url: PAGE }, env)).isError).toBe(false);
    expect((await callTool("scrape", { url: PAGE }, env)).isError).toBe(false);
    const limited = await callTool("scrape", { url: PAGE }, env);
    expect(limited.isError).toBe(true);
    expect(limited.text).toContain("Rate limit reached");
    // The limited call never reached the tool.
    expect(mock.requested).toHaveLength(2);
  });

  it("opens a new window after a minute", async () => {
    const env = testEnv({ RATE_LIMIT_PER_MINUTE: "1" });
    const t0 = Date.parse("2026-01-01T00:00:00Z");
    expect(await allowToolCall(env, "k", t0)).toBe(true);
    expect(await allowToolCall(env, "k", t0 + 59_000)).toBe(false);
    expect(await allowToolCall(env, "k", t0 + 60_000)).toBe(true);
  });

  it("does not count handshake and list requests", async () => {
    mockFetch({ [PAGE]: ARTICLE_HTML });
    const env = testEnv({ RATE_LIMIT_PER_MINUTE: "1" });
    for (let i = 0; i < 5; i++) {
      await postMcp({ jsonrpc: "2.0", id: i, method: "tools/list" }, env);
      await postMcp({ jsonrpc: "2.0", id: i, method: "initialize", params: {} }, env);
    }
    expect((await callTool("scrape", { url: PAGE }, env)).isError).toBe(false);
  });

  it("counts every tool call in a batch", async () => {
    mockFetch({ [PAGE]: ARTICLE_HTML });
    const env = testEnv({ RATE_LIMIT_PER_MINUTE: "2" });
    const call = (id: number) => ({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name: "scrape", arguments: { url: PAGE } },
    });
    const response = await postMcp([call(1), call(2), call(3)], env);
    const body = (await response.json()) as { result: { isError: boolean } }[];
    expect(body.map((r) => r.result.isError).filter(Boolean)).toHaveLength(1);
  });

  it("is disabled with RATE_LIMIT_PER_MINUTE=0", async () => {
    const env = testEnv({ RATE_LIMIT_PER_MINUTE: "0" });
    for (let i = 0; i < 200; i++) expect(await allowToolCall(env, "k")).toBe(true);
  });

  it("defaults to 60 calls per minute when unset", async () => {
    const env = testEnv({ RATE_LIMIT_PER_MINUTE: undefined });
    const now = Date.now();
    for (let i = 0; i < 60; i++) expect(await allowToolCall(env, "k", now)).toBe(true);
    expect(await allowToolCall(env, "k", now)).toBe(false);
  });

  it("uses the Rate Limiting binding when configured", async () => {
    mockFetch({ [PAGE]: ARTICLE_HTML });
    const limit = vi.fn(async () => ({ success: false }));
    const binding: RateLimitBinding = { limit };
    const { text, isError } = await callTool("scrape", { url: PAGE }, testEnv({ RATE_LIMITER: binding }));
    expect(isError).toBe(true);
    expect(text).toContain("Rate limit reached");
    expect(limit).toHaveBeenCalledWith({ key: await rateLimitKey(TEST_SECRET) });
  });

  it("allows calls when the binding fails", async () => {
    const binding: RateLimitBinding = {
      limit: async () => {
        throw new Error("binding unavailable");
      },
    };
    expect(await allowToolCall(testEnv({ RATE_LIMITER: binding }), "k")).toBe(true);
  });
});
