/**
 * Recorded-shape fixtures for the external APIs used by research and prior_art.
 * Field names follow the official API documentation.
 */

const DAY = 24 * 60 * 60 * 1000;
export const isoDaysAgo = (days: number) => new Date(Date.now() - days * DAY).toISOString();

function json(body: unknown) {
  return { body: JSON.stringify(body), contentType: "application/json" };
}

function invertedIndex(text: string): Record<string, number[]> {
  const index: Record<string, number[]> = {};
  text.split(" ").forEach((word, i) => {
    index[word] ??= [];
    index[word].push(i);
  });
  return index;
}

// ---------------------------------------------------------------------------
// research
// ---------------------------------------------------------------------------

export const QUESTION = "Does intermittent fasting improve insulin sensitivity?";

const PAPER_ABSTRACT =
  "In this randomized controlled trial intermittent fasting improved insulin sensitivity in adults with prediabetes. " +
  "Fasting insulin decreased and insulin sensitivity measured by clamp increased after twelve weeks compared with control.";

const PREPRINT_ABSTRACT =
  "We model glucose dynamics under time restricted eating and find that intermittent fasting may improve insulin sensitivity " +
  "in a simulated cohort. These results are preliminary and require clinical confirmation.";

export const OPENALEX_RESPONSE = json({
  meta: { count: 3 },
  results: [
    {
      id: "https://openalex.org/W1",
      doi: "https://doi.org/10.1000/fasting.2023",
      display_name: "Intermittent fasting and insulin sensitivity: a randomized trial",
      publication_date: "2023-05-04",
      publication_year: 2023,
      type: "article",
      cited_by_count: 1234,
      authorships: [
        { author: { display_name: "Ada Lovelace" } },
        { author: { display_name: "Alan Turing" } },
        { author: { display_name: "Grace Hopper" } },
        { author: { display_name: "Edsger Dijkstra" } },
      ],
      primary_location: {
        landing_page_url: "https://journal.test/fasting",
        version: "publishedVersion",
        source: { display_name: "Journal of Metabolism", type: "journal" },
      },
      abstract_inverted_index: invertedIndex(PAPER_ABSTRACT),
    },
    {
      id: "https://openalex.org/W2",
      doi: null,
      display_name: "Modeling time restricted eating",
      publication_date: "2024-01-10",
      type: "preprint",
      cited_by_count: 3,
      authorships: [{ author: { display_name: "Barbara Liskov" } }],
      primary_location: {
        landing_page_url: "https://preprints.test/trf",
        source: { display_name: "medRxiv", type: "repository" },
      },
      abstract_inverted_index: invertedIndex(PREPRINT_ABSTRACT),
    },
    {
      id: "https://openalex.org/W3",
      doi: "https://doi.org/10.1000/unrelated",
      display_name: "Soil erosion in alpine meadows",
      publication_date: "2019-02-01",
      type: "article",
      cited_by_count: 50,
      authorships: [],
      primary_location: { source: { display_name: "Geology Letters", type: "journal" } },
      abstract_inverted_index: null,
    },
  ],
});

export const ARXIV_ATOM = {
  contentType: "application/atom+xml",
  body: `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <title type="html">ArXiv Query</title>
  <entry>
    <id>http://arxiv.org/abs/2401.00001v1</id>
    <published>2024-01-02T10:00:00Z</published>
    <title>Fasting Windows and Insulin Response:
      A Data-Driven Analysis</title>
    <summary>  Using wearable glucose monitors we analyse fasting windows. Longer intermittent fasting windows
      were associated with improved insulin sensitivity &amp; lower glucose variability.  </summary>
    <author><name>Donald Knuth</name></author>
    <author><name>Frances Allen</name></author>
    <arxiv:doi>10.48550/arXiv.2401.00001</arxiv:doi>
    <arxiv:journal_ref>Metabolic Data 12 (2024) 1-9</arxiv:journal_ref>
    <link href="http://arxiv.org/abs/2401.00001v1" rel="alternate" type="text/html"/>
    <link title="pdf" href="http://arxiv.org/pdf/2401.00001v1" rel="related" type="application/pdf"/>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2402.00002v1</id>
    <published>2024-02-03T10:00:00Z</published>
    <title>Intermittent fasting and insulin sensitivity: a randomized trial</title>
    <summary>${PAPER_ABSTRACT}</summary>
    <author><name>Ada Lovelace</name></author>
    <link href="http://arxiv.org/abs/2402.00002v1" rel="alternate" type="text/html"/>
  </entry>
</feed>`,
};

const FILLER =
  "Readers often ask about meal timing, and this section covers general background on nutrition research methods without specific findings.";

export const WEB_PAGE_RELEVANT = `<!doctype html><html><head><title>Fasting and insulin</title></head><body>
<nav><a href="/">Home</a> <a href="/about">About</a></nav>
<article>
  <h1>What studies say about fasting</h1>
  <p>${FILLER} ${FILLER}</p>
  <h2>Insulin sensitivity</h2>
  <p>Several trials report that intermittent fasting improves insulin sensitivity, particularly in people with
     insulin resistance. The effect on insulin sensitivity appears similar to calorie restriction in most trials.</p>
  <h2>Unrelated tips</h2>
  <p>Hydration and sleep matter for overall wellbeing. Drink water and keep a consistent bedtime routine every night of the week.</p>
</article>
<footer>Footer text</footer>
</body></html>`;

/** Repeats the paper abstract verbatim, so dedup must drop one copy. */
export const WEB_PAGE_SYNDICATED = `<!doctype html><html><head><title>Press release</title></head><body>
<article><h1>Press release</h1><p>${PAPER_ABSTRACT}</p><p>${FILLER} ${FILLER} ${FILLER}</p></article>
</body></html>`;

export const WEB_PAGE_OFF_TOPIC = `<!doctype html><html><head><title>Gardening</title></head><body>
<article><h1>Tomatoes</h1><p>Tomatoes need full sun, regular watering and well drained soil to produce a good harvest in summer.
${FILLER} ${FILLER}</p></article></body></html>`;

export const DDG_RESULTS = `<html><body>
  <div class="result"><a class="result__a" href="https://health.test/fasting">Fasting and insulin</a>
    <a class="result__snippet">Trials on fasting and insulin sensitivity</a></div>
  <div class="result"><a class="result__a" href="https://news.test/press">Press release</a>
    <a class="result__snippet">A new trial on fasting</a></div>
  <div class="result"><a class="result__a" href="https://garden.test/tomatoes">Gardening</a>
    <a class="result__snippet">Tomatoes</a></div>
  <div class="result"><a class="result__a" href="https://files.test/report.pdf">Report PDF</a>
    <a class="result__snippet">Intermittent fasting improves insulin sensitivity in a large cohort (PDF snippet)</a></div>
</body></html>`;

export const RESEARCH_ROUTES = {
  "https://html.duckduckgo.com/html/": DDG_RESULTS,
  "https://api.openalex.org/works?*": OPENALEX_RESPONSE,
  "https://export.arxiv.org/api/query?*": ARXIV_ATOM,
  "https://health.test/fasting": WEB_PAGE_RELEVANT,
  "https://news.test/press": WEB_PAGE_SYNDICATED,
  "https://garden.test/tomatoes": WEB_PAGE_OFF_TOPIC,
};

// ---------------------------------------------------------------------------
// prior_art
// ---------------------------------------------------------------------------

export const FEATURE = "Rate limit HTTP requests per API key using a token bucket";

function repo(
  fullName: string,
  overrides: Partial<{
    description: string;
    stargazers_count: number;
    pushed_at: string;
    archived: boolean;
    license: { spdx_id: string; name: string } | null;
    open_issues_count: number;
    language: string;
  }> = {},
) {
  return {
    full_name: fullName,
    html_url: `https://github.com/${fullName}`,
    description: `${fullName} description`,
    stargazers_count: 100,
    pushed_at: isoDaysAgo(10),
    archived: false,
    license: { spdx_id: "MIT", name: "MIT License" },
    open_issues_count: 5,
    language: "TypeScript",
    fork: false,
    ...overrides,
  };
}

export const GITHUB_SEARCH = json({
  total_count: 4,
  items: [
    repo("acme/http-toolkit", { description: "Assorted HTTP utilities", stargazers_count: 5000 }),
    repo("bucket/token-limiter", {
      description: "Token bucket rate limiter",
      stargazers_count: 1200,
      pushed_at: isoDaysAgo(800),
      license: null,
    }),
    repo("old/ratelimit-legacy", { description: "Legacy limiter", archived: true, stargazers_count: 40 }),
    { ...repo("someone/fork-of-limiter"), fork: true },
  ],
});

export const README_TOKEN_LIMITER = `# token-limiter

[![npm](https://img.shields.io/npm/v/token-limiter.svg)](https://npmjs.com/package/token-limiter) [![CI](https://github.com/bucket/token-limiter/actions/workflows/ci.yml/badge.svg)](https://github.com/bucket/token-limiter/actions)

## Installation

Install it with your package manager of choice and import the default export.

## Per-key limits

Rate limit HTTP requests per API key with a token bucket: every API key gets its own bucket that refills at a fixed rate,
and requests are rejected with HTTP 429 when the bucket is empty.

## License

MIT
`;

export const README_HTTP_TOOLKIT = `# http-toolkit

A grab bag of HTTP helpers: retries, timeouts, cookie parsing and header utilities for Node.js servers and clients.

## Retries

Retry failed HTTP requests with exponential backoff and jitter.
`;

export const NPM_SEARCH = json({
  total: 2,
  objects: [
    {
      package: {
        name: "express-key-limit",
        version: "2.1.0",
        description: "Express middleware to rate limit requests per API key",
        date: "2025-06-01T00:00:00.000Z",
        links: {
          npm: "https://www.npmjs.com/package/express-key-limit",
          repository: "https://github.com/keys/express-key-limit",
        },
      },
      score: { final: 0.9 },
    },
    {
      package: {
        name: "tiny-bucket",
        version: "0.3.0",
        description: "Minimal token bucket",
        date: "2021-01-01T00:00:00.000Z",
        links: { npm: "https://www.npmjs.com/package/tiny-bucket" },
      },
      score: { final: 0.5 },
    },
  ],
});

export const PYPI_RATE_LIMIT = json({
  info: {
    name: "rate-limit",
    summary: "Python rate limiting with token buckets",
    version: "1.4.0",
    home_page: "",
    project_url: "https://pypi.org/project/rate-limit/",
    project_urls: { Source: "https://github.com/pyrate/rate-limit" },
  },
  urls: [{ upload_time_iso_8601: "2025-03-01T12:00:00.000000Z" }],
});

export const PRIOR_ART_ROUTES = {
  "https://api.github.com/search/repositories?*": GITHUB_SEARCH,
  "https://api.github.com/repos/bucket/token-limiter/readme": { body: README_TOKEN_LIMITER, contentType: "text/plain" },
  "https://api.github.com/repos/acme/http-toolkit/readme": { body: README_HTTP_TOOLKIT, contentType: "text/plain" },
  "https://api.github.com/repos/old/ratelimit-legacy/readme": { body: "Not Found", status: 404 },
  "https://api.github.com/repos/keys/express-key-limit": json(
    repo("keys/express-key-limit", { description: "Per-key rate limiting for Express", stargazers_count: 300 }),
  ),
  "https://api.github.com/repos/keys/express-key-limit/readme": {
    body: "# express-key-limit\n\nMiddleware that applies a token bucket per API key to incoming HTTP requests.",
    contentType: "text/plain",
  },
  "https://api.github.com/repos/pyrate/rate-limit": json(
    repo("pyrate/rate-limit", { language: "Python", stargazers_count: 80, pushed_at: isoDaysAgo(30) }),
  ),
  "https://api.github.com/repos/pyrate/rate-limit/readme": {
    body: "# rate-limit\n\nToken bucket rate limiting for Python web apps, keyed by client or API key.",
    contentType: "text/plain",
  },
  "https://registry.npmjs.org/-/v1/search?*": NPM_SEARCH,
  "https://pypi.org/pypi/rate-limit/json": PYPI_RATE_LIMIT,
  "https://pypi.org/pypi/*": { body: "Not Found", status: 404 },
};
