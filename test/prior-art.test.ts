import { afterEach, describe, expect, it, vi } from "vitest";
import { FEATURE, PRIOR_ART_ROUTES } from "./api-fixtures";
import { callTool, mockFetch, testEnv } from "./helpers";

afterEach(() => {
  vi.restoreAllMocks();
});

function projectNames(text: string): string[] {
  return Array.from(text.matchAll(/^## \d+\. (\S+)/gm), (m) => m[1]);
}

function projectBlock(text: string, name: string): string {
  const start = text.search(new RegExp(`^## \\d+\\. ${name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")} `, "m"));
  if (start === -1) return "";
  const next = text.indexOf("\n## ", start + 1);
  return text.slice(start, next === -1 ? undefined : next);
}

describe("prior_art", () => {
  it("searches GitHub, npm and PyPI without touching the network", async () => {
    const mock = mockFetch(PRIOR_ART_ROUTES);
    const { text, isError } = await callTool("prior_art", { description: FEATURE });
    expect(isError).toBe(false);
    expect(mock.unexpected).toEqual([]);

    const repoSearch = new URL(mock.requested.find((u) => u.includes("/search/repositories")) ?? "");
    expect(repoSearch.searchParams.get("q")).toBe("rate limit http requests in:name,description,readme");
    expect(mock.headers.get(repoSearch.href)?.get("User-Agent")).toMatch(/^emaf/);
    expect(mock.requested.some((u) => u.includes("/search/code"))).toBe(false);
    expect(mock.requested).toContain("https://pypi.org/pypi/rate-limit/json");
    expect(text).toContain("GitHub code search (skipped: requires GITHUB_TOKEN)");
    expect(text).toContain("found rate-limit; PyPI has no search API");
  });

  it("ranks projects by where the README mentions the feature", async () => {
    mockFetch(PRIOR_ART_ROUTES);
    const { text } = await callTool("prior_art", { description: FEATURE });
    const names = projectNames(text);
    expect(names[0]).toBe("bucket/token-limiter");
    // The popular but unrelated toolkit ranks below the projects whose README matches.
    expect(names.indexOf("acme/http-toolkit")).toBeGreaterThan(names.indexOf("keys/express-key-limit"));
    expect(names).not.toContain("someone/fork-of-limiter");

    const top = projectBlock(text, "bucket/token-limiter");
    expect(top).toContain("Most relevant README passage (section: token-limiter > Per-key limits):");
    expect(top).toContain("> Rate limit HTTP requests per API key with a token bucket");
    expect(text).not.toMatch(/shields\.io|badge\.svg/);
  });

  it("reports maintenance signals per project", async () => {
    mockFetch(PRIOR_ART_ROUTES);
    const { text } = await callTool("prior_art", { description: FEATURE });

    const stale = projectBlock(text, "bucket/token-limiter");
    expect(stale).toContain("(1,200 stars)");
    expect(stale).toContain("POSSIBLY UNMAINTAINED: no push in 12+ months");
    expect(stale).toContain("License: none");

    const archived = projectBlock(text, "old/ratelimit-legacy");
    expect(archived).toContain("Archived: YES");
    expect(archived).not.toContain("UNMAINTAINED");

    const active = projectBlock(text, "acme/http-toolkit");
    expect(active).toMatch(/Last push: \d{4}-\d{2}-\d{2} · Archived: no · License: MIT · Open issues: 5 · Language: TypeScript/);
  });

  it("links packages to their repositories", async () => {
    mockFetch(PRIOR_ART_ROUTES);
    const { text } = await callTool("prior_art", { description: FEATURE });
    expect(projectBlock(text, "keys/express-key-limit")).toContain(
      "Packages: npm express-key-limit@2.1.0 (released 2025-06-01)",
    );
    expect(projectBlock(text, "pyrate/rate-limit")).toContain("Packages: PyPI rate-limit@1.4.0 (released 2025-03-01)");
    expect(projectBlock(text, "tiny-bucket")).toContain("(npm package, no GitHub repository found)");
  });

  it("restricts registries and adds a language qualifier for a language filter", async () => {
    const mock = mockFetch(PRIOR_ART_ROUTES);
    const { text } = await callTool("prior_art", { description: FEATURE, language: "rust" });
    expect(mock.requested.some((u) => u.includes("npmjs") || u.includes("pypi"))).toBe(false);
    const q = new URL(mock.requested[0]).searchParams.get("q");
    expect(q).toMatch(/ language:rust$/);
    expect(text).toContain("npm (skipped for this language)");
  });

  it("uses only PyPI as registry for python", async () => {
    const mock = mockFetch(PRIOR_ART_ROUTES);
    await callTool("prior_art", { description: FEATURE, language: "python" });
    expect(mock.requested.some((u) => u.includes("npmjs"))).toBe(false);
    expect(mock.requested.some((u) => u.includes("pypi.org"))).toBe(true);
  });

  it("uses the token and enables code search when GITHUB_TOKEN is set", async () => {
    const mock = mockFetch({
      ...PRIOR_ART_ROUTES,
      "https://api.github.com/search/code?*": {
        body: JSON.stringify({ items: [{ repository: { full_name: "bucket/token-limiter" } }] }),
        contentType: "application/json",
      },
    });
    const { text } = await callTool("prior_art", { description: FEATURE }, testEnv({ GITHUB_TOKEN: "ghp_test" }));
    expect(mock.unexpected).toEqual([]);
    const codeSearch = mock.requested.find((u) => u.includes("/search/code")) ?? "";
    expect(mock.headers.get(codeSearch)?.get("Authorization")).toBe("Bearer ghp_test");
    expect(text).toContain("GitHub code search (1 repositories)");
    expect(text).not.toContain("no GITHUB_TOKEN configured");
  });

  it("explains GitHub rate limits", async () => {
    mockFetch({
      ...PRIOR_ART_ROUTES,
      "https://api.github.com/search/repositories?*": {
        body: "{}",
        status: 403,
        headers: { "x-ratelimit-remaining": "0" },
      },
    });
    const { text, isError } = await callTool("prior_art", { description: FEATURE });
    expect(isError).toBe(false);
    expect(text).toContain("GitHub repository search failed: GitHub search: rate limit reached (HTTP 403). Set GITHUB_TOKEN");
    // Registry results still come through.
    expect(projectNames(text)).toContain("keys/express-key-limit");
  });

  it("validates its arguments", async () => {
    mockFetch({});
    expect((await callTool("prior_art", {})).text).toBe("Error: `description` must be a non-empty string.");
    expect((await callTool("prior_art", { description: "the of and" })).text).toContain("no searchable keywords");
  });
});
