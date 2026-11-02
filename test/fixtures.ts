/**
 * A small fake website served from https://site.test by the fetch mock.
 */

export const SITE = "https://site.test";

const FILLER =
  "This paragraph exists so that the readability heuristics treat the article as the main content of the page. " +
  "It is intentionally long and plain, the way documentation prose usually is, and it carries no links.";

interface PageOptions {
  title: string;
  heading: string;
  /** Extra HTML placed inside the article. */
  content?: string;
  /** Links placed inside the article as relative hrefs. */
  links?: [href: string, label: string][];
}

/** Builds a full page with header, navigation, footer and a main article. */
export function page({ title, heading, content = "", links = [] }: PageOptions): string {
  const linkList = links.length
    ? `<ul>${links.map(([href, label]) => `<li><a href="${href}">${label}</a></li>`).join("")}</ul>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <title>${title}</title>
  <style>body { color: red; }</style>
  <script>window.tracking = true;</script>
</head>
<body>
  <header><a href="/">Site Logo</a></header>
  <nav class="site-nav">
    <a href="/">Home</a>
    <a href="/docs/">Docs</a>
    <a href="/blog/">Blog</a>
    <a href="https://external.test/partner">Partner</a>
  </nav>
  <main>
    <article>
      <h1>${heading}</h1>
      <p>${FILLER}</p>
      <p>${FILLER}</p>
      ${content}
      ${linkList}
    </article>
  </main>
  <footer>Copyright Footer Text 2026</footer>
</body>
</html>`;
}

export const ARTICLE_HTML = page({
  title: "Article Title",
  heading: "Getting Started",
  content: `
    <h2>Configuration table</h2>
    <table>
      <thead><tr><th>Name</th><th>Value</th></tr></thead>
      <tbody>
        <tr><td>timeout</td><td>20</td></tr>
        <tr><td>retries</td><td>3</td></tr>
      </tbody>
    </table>
    <h2>Example code</h2>
    <pre><code class="language-ts">const answer: number = 42;
console.log(answer);</code></pre>
    <p>Read the <a href="../guide/setup.html">setup guide</a> and the
       <a href="/reference">reference</a>.</p>
    <p><img src="images/diagram.png" alt="Diagram"></p>
  `,
});

/** Page without enough text for Readability, so the chrome-stripping fallback is used. */
export const SHORT_PAGE_HTML = `<!doctype html>
<html><head><title>Short</title></head>
<body>
  <nav><a href="/x">Nav Link</a></nav>
  <header>Header Text</header>
  <div id="content"><p>Short body text.</p></div>
  <aside>Aside Text</aside>
  <footer>Footer Text</footer>
</body></html>`;

export const SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE}/sitemap-only</loc></url>
  <url><loc> ${SITE}/search?q=a&amp;page=2 </loc></url>
  <url><loc>https://elsewhere.test/from-sitemap</loc></url>
</urlset>`;

/**
 * Link graph used by the crawl tests (depth from the root in brackets):
 *
 *   /              [0] -> /docs/, /blog/, external (nav)
 *   /docs/         [1] -> /docs/intro, /docs/advanced, /files/manual.pdf, /about
 *   /blog/         [1] -> /blog/post
 *   /docs/intro    [2] -> /docs/deep
 *   /docs/advanced [2] -> /docs/missing (404)
 *   /about         [2]
 *   /blog/post     [2]
 *   /docs/deep     [3]
 */
export const CRAWL_SITE: Record<string, string | { body: string; status: number }> = {
  [`${SITE}/`]: page({ title: "Home", heading: "Home page" }),
  [`${SITE}/docs/`]: page({
    title: "Docs",
    heading: "Docs index",
    links: [
      ["intro", "Intro"],
      ["/docs/advanced", "Advanced"],
      ["/files/manual.pdf", "Manual (PDF)"],
      ["/about", "About"],
    ],
  }),
  [`${SITE}/blog/`]: page({ title: "Blog", heading: "Blog index", links: [["/blog/post", "Post"]] }),
  [`${SITE}/docs/intro`]: page({ title: "Intro", heading: "Intro", links: [["/docs/deep", "Deep"]] }),
  [`${SITE}/docs/advanced`]: page({
    title: "Advanced",
    heading: "Advanced",
    links: [["/docs/missing", "Missing"]],
  }),
  [`${SITE}/docs/missing`]: { body: "Not found", status: 404 },
  [`${SITE}/about`]: page({ title: "About", heading: "About" }),
  [`${SITE}/blog/post`]: page({ title: "Post", heading: "Post" }),
  [`${SITE}/docs/deep`]: page({ title: "Deep", heading: "Deep" }),
};
