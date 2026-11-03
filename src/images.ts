/**
 * Image URL hygiene for Markdown output: status badges are dropped and long
 * signed query strings (GitHub private-user-images JWTs, S3/GCS/Azure SAS
 * signatures) are stripped. Both only waste context for an LLM.
 */

const BADGE_HOSTS = new Set([
  "img.shields.io",
  "shields.io",
  "badgen.net",
  "badge.fury.io",
  "badges.gitter.im",
  "badgesize.io",
  "img.badgesize.io",
  "camo.githubusercontent.com",
  "travis-ci.org",
  "travis-ci.com",
  "app.travis-ci.com",
  "coveralls.io",
  "codecov.io",
  "app.codecov.io",
  "circleci.com",
  "dl.circleci.com",
  "ci.appveyor.com",
  "api.codeclimate.com",
  "app.codacy.com",
  "api.codacy.com",
  "sonarcloud.io",
  "snyk.io",
  "pepy.tech",
  "static.pepy.tech",
  "api.netlify.com",
  "deepsource.io",
  "app.deepsource.com",
  "bestpractices.coreinfrastructure.org",
  "www.bestpractices.dev",
  "api.securityscorecards.dev",
]);

const SIGNED_PARAMS =
  /(?:^|[?&])(?:jwt|token|signature|sig|x-amz-[a-z-]+|x-goog-[a-z-]+|se|sp|sv|st|expires|policy|key-pair-id)=/i;

/** True for status, coverage, version and similar badge images. */
export function isBadgeUrl(src: string): boolean {
  let url: URL;
  try {
    url = new URL(src, "https://invalid.invalid");
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (BADGE_HOSTS.has(host) || host.startsWith("badge.") || host.startsWith("badges.")) return true;
  const path = url.pathname.toLowerCase();
  // GitHub Actions workflow badges, Read the Docs, GitLab pipeline and generic */badge.svg endpoints.
  return /(?:^|\/)badges?(?:\/|\.svg$|\.png$|$)|\/badge\.svg$|\/(?:pipeline|coverage)\.svg$/.test(path);
}

/** Removes signed or very long query strings and utm_ tracking parameters from an image URL. */
export function cleanImageUrl(src: string): string {
  const q = src.indexOf("?");
  if (q === -1) return src;
  const query = src.slice(q);
  if (query.length > 100 || SIGNED_PARAMS.test(query)) return src.slice(0, q);
  const kept = query
    .slice(1)
    .replace(/&amp;/g, "&")
    .split("&")
    .filter((param) => param && !/^utm_/i.test(param));
  return kept.length ? `${src.slice(0, q)}?${kept.join("&")}` : src.slice(0, q);
}

const MD_IMAGE = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const MD_LINKED_IMAGES_ONLY = /\[(\s*(?:!\[[^\]]*\]\([^)]*\)\s*)+)\]\([^)]*\)/g;
const MD_REF_DEFINITION = /^\s{0,3}\[([^\]]+)\]:\s*<?(\S+?)>?(?:\s+["'(].*)?$/gm;
const HTML_IMG = /<img\b[^>]*>/gi;

function htmlAttr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : "";
}

/**
 * Cleans raw Markdown (for example a GitHub README): drops badge images,
 * including linked and reference-style badges, converts remaining HTML <img>
 * tags to Markdown images with cleaned URLs, and strips other HTML tags.
 */
export function cleanMarkdownImages(markdown: string): string {
  // Fenced code blocks are kept verbatim: they often contain HTML examples.
  const segments = markdown.split(/(^\s*(?:```|~~~)[^\n]*\n[\s\S]*?^\s*(?:```|~~~)[ \t]*$)/m);
  return segments
    .map((segment, i) => (i % 2 === 1 ? segment : cleanProse(segment)))
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanProse(markdown: string): string {
  // Reference-style badges: [![alt][ref]][link] with "[ref]: https://img.shields.io/..."
  const badgeRefs = new Set<string>();
  for (const m of markdown.matchAll(MD_REF_DEFINITION)) {
    if (isBadgeUrl(m[2])) badgeRefs.add(m[1].toLowerCase());
  }
  let md = markdown;
  if (badgeRefs.size) {
    md = md.replace(/\[?!\[[^\]]*\]\[([^\]]+)\](?:\]\[[^\]]*\]|\]\([^)]*\))?/g, (match, ref: string) =>
      badgeRefs.has(ref.toLowerCase()) ? "" : match,
    );
    md = md.replace(MD_REF_DEFINITION, (match, ref: string) => (badgeRefs.has(ref.toLowerCase()) ? "" : match));
  }

  // HTML images become Markdown images (or disappear if they are badges).
  md = md.replace(HTML_IMG, (tag) => {
    const src = htmlAttr(tag, "src");
    if (!src || isBadgeUrl(src)) return "";
    return `![${htmlAttr(tag, "alt")}](${cleanImageUrl(src)})`;
  });

  // Inline Markdown images.
  md = md.replace(MD_IMAGE, (_match, alt: string, src: string) =>
    isBadgeUrl(src) ? "" : `![${alt}](${cleanImageUrl(src)})`,
  );
  // Links whose content was only images and is now empty: [](https://...)
  md = md.replace(MD_LINKED_IMAGES_ONLY, (match, inner: string) => (inner.trim() ? match : ""));
  md = md.replace(/\[\s*\]\([^)]*\)/g, "");

  // Remaining HTML: keep the text, drop the tags and comments.
  md = md.replace(/<!--[\s\S]*?-->/g, "").replace(/<\/?[a-zA-Z][^>]*>/g, "");

  return md
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n");
}
