import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanImageUrl, cleanMarkdownImages, isBadgeUrl } from "../src/images";
import { callTool, mockFetch } from "./helpers";

afterEach(() => {
  vi.restoreAllMocks();
});

const JWT_IMAGE =
  "https://private-user-images.githubusercontent.com/123/456-abc.png?jwt=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJnaXRodWIuY29tIiwiYXVkIjoicmF3LmdpdGh1YnVzZXJjb250ZW50LmNvbSJ9.abc";

describe("isBadgeUrl", () => {
  it.each([
    "https://img.shields.io/npm/v/foo.svg",
    "https://badgen.net/npm/dt/foo",
    "https://badge.fury.io/js/foo.svg",
    "https://camo.githubusercontent.com/abc123/68747470",
    "https://github.com/owner/repo/actions/workflows/ci.yml/badge.svg",
    "https://github.com/owner/repo/workflows/CI/badge.svg?branch=main",
    "https://codecov.io/gh/owner/repo/branch/main/graph/badge.svg",
    "https://readthedocs.org/projects/foo/badge/?version=latest",
    "https://gitlab.com/owner/repo/badges/main/pipeline.svg",
  ])("detects %s", (url) => {
    expect(isBadgeUrl(url)).toBe(true);
  });

  it.each([
    "https://example.com/images/diagram.png",
    "https://raw.githubusercontent.com/owner/repo/main/docs/screenshot.png",
    JWT_IMAGE,
  ])("keeps %s", (url) => {
    expect(isBadgeUrl(url)).toBe(false);
  });
});

describe("cleanImageUrl", () => {
  it("strips signed JWT query strings", () => {
    expect(cleanImageUrl(JWT_IMAGE)).toBe("https://private-user-images.githubusercontent.com/123/456-abc.png");
  });

  it("strips S3 signatures and very long queries", () => {
    expect(cleanImageUrl("https://b.s3.amazonaws.com/x.png?X-Amz-Signature=abc&X-Amz-Expires=300")).toBe(
      "https://b.s3.amazonaws.com/x.png",
    );
    expect(cleanImageUrl(`https://cdn.test/a.png?${"p=1&".repeat(40)}`)).toBe("https://cdn.test/a.png");
  });

  it("keeps short, unsigned query strings", () => {
    expect(cleanImageUrl("https://cdn.test/a.png?w=640")).toBe("https://cdn.test/a.png?w=640");
  });
});

describe("cleanMarkdownImages", () => {
  it("drops inline, linked and reference-style badges", () => {
    const md = [
      "# Project",
      "",
      "[![npm](https://img.shields.io/npm/v/foo.svg)](https://npmjs.com/package/foo) [![CI][ci-badge]][ci-url]",
      "![Coverage](https://codecov.io/gh/o/r/branch/main/graph/badge.svg)",
      "",
      "Real content here.",
      "",
      "[ci-badge]: https://github.com/o/r/actions/workflows/ci.yml/badge.svg",
      "[ci-url]: https://github.com/o/r/actions",
    ].join("\n");
    const out = cleanMarkdownImages(md);
    expect(out).not.toMatch(/shields|badge|codecov|\[\]\(/);
    expect(out).toContain("Real content here.");
    expect(out).toContain("[ci-url]: https://github.com/o/r/actions");
  });

  it("converts HTML images, drops HTML badges and strips other tags", () => {
    const md = [
      '<p align="center">',
      '  <img src="https://img.shields.io/badge/license-MIT-blue" alt="license">',
      `  <img src="${JWT_IMAGE}" alt="Screenshot" width="600">`,
      "</p>",
      "<!-- comment -->",
      "Text with <b>bold</b>.",
    ].join("\n");
    expect(cleanMarkdownImages(md)).toBe(
      "![Screenshot](https://private-user-images.githubusercontent.com/123/456-abc.png)\n\nText with bold.",
    );
  });

  it("leaves fenced code blocks untouched", () => {
    const md = 'Intro\n\n```html\n<img src="https://img.shields.io/x"> <div>keep</div>\n```\n\nOutro';
    expect(cleanMarkdownImages(md)).toBe(md);
  });
});

describe("scrape output", () => {
  it("drops badges and shortens signed image URLs in HTML pages", async () => {
    const html = `<html><head><title>T</title></head><body>
      <p><a href="https://npmjs.com/package/foo"><img src="https://img.shields.io/npm/v/foo.svg" alt="npm"></a>
         <img src="https://camo.githubusercontent.com/abc/def" alt="build"></p>
      <p>Body text.</p>
      <p><img src="${JWT_IMAGE}" alt="Screenshot"></p>
    </body></html>`;
    mockFetch({ "https://site.test/readme": html });
    const { text } = await callTool("scrape", { url: "https://site.test/readme", onlyMainContent: false });
    expect(text).not.toMatch(/shields|camo|jwt=|\[\]\(/);
    expect(text).toContain("![Screenshot](https://private-user-images.githubusercontent.com/123/456-abc.png)");
    expect(text).toContain("Body text.");
  });
});
