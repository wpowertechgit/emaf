import { afterEach, describe, expect, it, vi } from "vitest";
import { Budget } from "../src/budget";
import type { KvBinding } from "../src/env";
import { scrapeTool } from "../src/tools/scrape";
import { ARTICLE_HTML, SITE } from "./fixtures";
import { callTool, mockFetch, testEnv } from "./helpers";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const URL_A = `${SITE}/cached`;

function fakeKv() {
  const store = new Map<string, string>();
  const puts: { key: string; ttl?: number }[] = [];
  const kv: KvBinding = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string, options?: { expirationTtl?: number }) => {
      store.set(key, value);
      puts.push({ key, ttl: options?.expirationTtl });
    }),
  };
  return { kv, store, puts };
}

describe("scrape cache", () => {
  it("stores a fresh result and serves the next call from KV", async () => {
    const { kv, puts } = fakeKv();
    const mock = mockFetch({ [URL_A]: ARTICLE_HTML });
    const env = testEnv({ CACHE: kv });

    const first = await callTool("scrape", { url: URL_A }, env);
    expect(first.text).not.toContain("Cached copy");
    expect(puts).toHaveLength(1);
    expect(puts[0].ttl).toBe(3600);
    expect(puts[0].key).toMatch(/^scrape:[0-9a-f]{64}$/);

    const second = await callTool("scrape", { url: URL_A }, env);
    expect(mock.requested).toEqual([URL_A]);
    expect(second.text).toMatch(/^Cached copy from \S+ \(\d+s old\)\. Pass cacheTtl: 0 for a fresh copy\./);
    expect(second.text).toContain("Getting Started");
  });

  it("applies maxChars to cached results", async () => {
    const { kv } = fakeKv();
    mockFetch({ [URL_A]: ARTICLE_HTML });
    const env = testEnv({ CACHE: kv });
    await callTool("scrape", { url: URL_A }, env);
    const { text } = await callTool("scrape", { url: URL_A, maxChars: 500 }, env);
    expect(text).toMatch(/^Cached copy[\s\S]*\[\.\.\. truncated, \d+ more characters\]$/);
  });

  it("bypasses the cache with cacheTtl 0", async () => {
    const { kv } = fakeKv();
    const mock = mockFetch({ [URL_A]: ARTICLE_HTML });
    const env = testEnv({ CACHE: kv });
    await callTool("scrape", { url: URL_A, cacheTtl: 0 }, env);
    await callTool("scrape", { url: URL_A, cacheTtl: 0 }, env);
    expect(mock.requested).toHaveLength(2);
    expect(kv.get).not.toHaveBeenCalled();
    expect(kv.put).not.toHaveBeenCalled();
  });

  it("refetches when the cached copy is older than cacheTtl", async () => {
    const { kv } = fakeKv();
    const mock = mockFetch({ [URL_A]: ARTICLE_HTML });
    const env = testEnv({ CACHE: kv });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    await callTool("scrape", { url: URL_A, cacheTtl: 86400 }, env);
    vi.setSystemTime(new Date("2026-01-01T02:00:00Z"));
    const { text } = await callTool("scrape", { url: URL_A, cacheTtl: 3600 }, env);
    expect(mock.requested).toHaveLength(2);
    expect(text).not.toContain("Cached copy");
  });

  it("keys entries by the options that change the output", async () => {
    const { kv, store } = fakeKv();
    const mock = mockFetch({ [URL_A]: ARTICLE_HTML });
    const env = testEnv({ CACHE: kv });
    await callTool("scrape", { url: URL_A }, env);
    const { text } = await callTool("scrape", { url: URL_A, format: "text" }, env);
    expect(mock.requested).toHaveLength(2);
    expect(store.size).toBe(2);
    expect(text).not.toContain("```");
  });

  it("does not cache error pages", async () => {
    const { kv } = fakeKv();
    mockFetch({ [URL_A]: { body: ARTICLE_HTML, status: 503 } });
    await callTool("scrape", { url: URL_A }, testEnv({ CACHE: kv }));
    expect(kv.put).not.toHaveBeenCalled();
  });

  it("raises a small cacheTtl to the KV minimum of 60 seconds", async () => {
    const { kv, puts } = fakeKv();
    mockFetch({ [URL_A]: ARTICLE_HTML });
    await callTool("scrape", { url: URL_A, cacheTtl: 5 }, testEnv({ CACHE: kv }));
    expect(puts[0].ttl).toBe(60);
  });

  it("counts KV reads and writes against the Cloudflare services budget", async () => {
    const { kv } = fakeKv();
    mockFetch({ [URL_A]: ARTICLE_HTML });
    const budget = new Budget();
    await scrapeTool.handler({ url: URL_A }, { env: testEnv({ CACHE: kv }), budget });
    // One external fetch; the KV read and write count as calls to Cloudflare services.
    expect(budget.used).toBe(1);
    expect(budget.usedInternal).toBe(2);
  });

  it("still scrapes when KV fails", async () => {
    const kv: KvBinding = {
      get: async () => {
        throw new Error("KV unavailable");
      },
      put: async () => {
        throw new Error("KV unavailable");
      },
    };
    mockFetch({ [URL_A]: ARTICLE_HTML });
    const { text, isError } = await callTool("scrape", { url: URL_A }, testEnv({ CACHE: kv }));
    expect(isError).toBe(false);
    expect(text).toContain("Getting Started");
  });
});
