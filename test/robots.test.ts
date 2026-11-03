import { afterEach, describe, expect, it, vi } from "vitest";
import { isPathAllowed, parseRobots } from "../src/robots";
import { CRAWL_SITE, SITE } from "./fixtures";
import { callTool, mockFetch } from "./helpers";

afterEach(() => {
  vi.restoreAllMocks();
});

function allowed(robots: string, path: string, agent?: string): boolean {
  return isPathAllowed(parseRobots(robots, agent), path);
}

describe("robots.txt parsing", () => {
  const ROBOTS = `
# Comment line
User-agent: *
Disallow: /private/
Disallow: /*.pdf$
Allow: /private/public-report
Disallow: /search?

User-agent: OtherBot
Disallow: /
`;

  it("applies the * group to EMAF", () => {
    expect(allowed(ROBOTS, "/docs/intro")).toBe(true);
    expect(allowed(ROBOTS, "/private/notes")).toBe(false);
    expect(allowed(ROBOTS, "/private/public-report")).toBe(true);
  });

  it("supports * and $ wildcards", () => {
    expect(allowed(ROBOTS, "/files/manual.pdf")).toBe(false);
    expect(allowed(ROBOTS, "/files/manual.pdf?download=1")).toBe(true);
    expect(allowed(ROBOTS, "/search?q=x")).toBe(false);
    expect(allowed(ROBOTS, "/search")).toBe(true);
  });

  it("prefers a group that names the agent over the * group", () => {
    const robots = "User-agent: *\nDisallow: /\n\nUser-agent: emaf\nDisallow: /admin\n";
    expect(allowed(robots, "/docs")).toBe(true);
    expect(allowed(robots, "/admin/users")).toBe(false);
  });

  it("merges consecutive user-agent lines into one group", () => {
    const robots = "User-agent: emaf\nUser-agent: OtherBot\nDisallow: /shared\n";
    expect(allowed(robots, "/shared/x")).toBe(false);
  });

  it("lets Allow win when rules have equal length", () => {
    expect(allowed("User-agent: *\nDisallow: /page\nAllow: /page\n", "/page")).toBe(true);
  });

  it("treats an empty Disallow and a missing group as allowing everything", () => {
    expect(allowed("User-agent: *\nDisallow:\n", "/anything")).toBe(true);
    expect(allowed("User-agent: OtherBot\nDisallow: /\n", "/anything")).toBe(true);
    expect(allowed("", "/anything")).toBe(true);
  });
});

describe("crawl with respectRobots", () => {
  it("skips disallowed URLs and lists them", async () => {
    const mock = mockFetch({
      ...CRAWL_SITE,
      [`${SITE}/robots.txt`]: { body: "User-agent: *\nDisallow: /blog/\n", contentType: "text/plain" },
    });
    const { text } = await callTool("crawl", { url: `${SITE}/`, maxDepth: 1, respectRobots: true });
    expect(mock.unexpected).toEqual([]);
    expect(mock.requested).toEqual([`${SITE}/robots.txt`, `${SITE}/`, `${SITE}/docs/`]);
    expect(text).toContain(`Skipped 1 URL(s) disallowed by robots.txt:\n- ${SITE}/blog/`);
  });

  it("does not crawl at all when the start URL is disallowed", async () => {
    const mock = mockFetch({
      ...CRAWL_SITE,
      [`${SITE}/robots.txt`]: { body: "User-agent: *\nDisallow: /\n", contentType: "text/plain" },
    });
    const { text } = await callTool("crawl", { url: `${SITE}/`, respectRobots: true });
    expect(mock.requested).toEqual([`${SITE}/robots.txt`]);
    expect(text.startsWith(`Crawled 0 page(s)`)).toBe(true);
  });

  it("allows everything when robots.txt is missing", async () => {
    const mock = mockFetch({ ...CRAWL_SITE, [`${SITE}/robots.txt`]: { body: "Not found", status: 404 } });
    await callTool("crawl", { url: `${SITE}/`, maxDepth: 1, respectRobots: true });
    expect(mock.requested).toContain(`${SITE}/blog/`);
  });

  it("treats a server error as disallowing the site, per RFC 9309", async () => {
    const mock = mockFetch({ ...CRAWL_SITE, [`${SITE}/robots.txt`]: { body: "oops", status: 503 } });
    const { text } = await callTool("crawl", { url: `${SITE}/`, respectRobots: true });
    expect(mock.requested).toEqual([`${SITE}/robots.txt`]);
    expect(text).toContain("robots.txt returned HTTP 503; treating the site as disallowed.");
  });

  it("does not fetch robots.txt unless asked", async () => {
    const mock = mockFetch(CRAWL_SITE);
    await callTool("crawl", { url: `${SITE}/`, maxDepth: 0 });
    expect(mock.requested).toEqual([`${SITE}/`]);
  });
});
