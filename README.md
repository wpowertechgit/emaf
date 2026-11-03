# EMAF

A self-hosted alternative to Firecrawl: a remote [MCP](https://modelcontextprotocol.io) server on Cloudflare Workers for research from Claude. It turns web pages into clean Markdown, and its `research` and `prior_art` tools return ranked, condensed passages with sources instead of raw page dumps.

- Runs on the Cloudflare Workers free plan.
- No framework and no MCP SDK: a small, stateless implementation of the MCP Streamable HTTP transport (JSON responses, no SSE, no sessions).
- Uses official free APIs (OpenAlex, arXiv, GitHub, npm, PyPI) instead of scraping their HTML.
- HTML is parsed with [linkedom](https://github.com/WebReflection/linkedom), the main content is picked by [Readability](https://github.com/mozilla/readability), and Markdown is produced by [Turndown](https://github.com/mixmark-io/turndown) with GitHub Flavored Markdown tables. Badge images are dropped and signed image URLs are shortened.

## Tools

| Tool | Use it for | What it does |
| --- | --- | --- |
| `research` | "Look into X", fact-checking, "what is known about X" | Derives 2-4 search queries from the question, searches the web, [OpenAlex](https://openalex.org) and [arXiv](https://arxiv.org) in parallel, reads the top web pages, splits everything into passages, ranks them with BM25 (optionally reranked by embeddings), removes near-duplicates and returns the best passages grouped by source. Papers include authors, venue, citation count and DOI; preprints are marked as not peer reviewed. Options: `depth` (`quick`, `normal`, `deep`), `sources` (`web`, `academic`, `all`), `maxChars` (default 12000). |
| `prior_art` | "Does something like this exist?", "is there a library for X?" | Searches GitHub repositories (plus GitHub code search with a token), npm and PyPI, reads each candidate's README and quotes the passage most relevant to the description. Reports stars, last push, archived flag, license and open issues, and flags projects without a push in 12+ months. Options: `language` (for example `python`, `typescript`, `rust`), `limit` (default 8), `maxChars`. |
| `scrape` | Reading one specific URL | Fetches one URL and returns Markdown, plain text or cleaned HTML. PDFs (up to 10 MB) are converted to text with one section per page. Strips navigation, headers, footers and scripts by default (`onlyMainContent`). `render: true` loads the page in a headless browser first (requires Browser Rendering). `includeLinks` appends every link on the page. With a KV cache configured, results are cached; `cacheTtl` sets the maximum age in seconds (default 3600, `0` for a fresh copy). |
| `batch_scrape` | Reading a list of known URLs | Reads up to 20 URLs, possibly from different sites, in one call and returns each as Markdown or text, including PDFs. Duplicates (including fragment variants) are fetched once, failures are listed per URL, and URLs beyond the subrequest budget are reported as skipped. Options: `format`, `onlyMainContent`, `maxCharsPerPage` (default 8000), `maxChars` (default 40000). |
| `crawl` | Reading several pages of one site | Breadth-first crawl of a single host, returning Markdown per page. Options: `limit` (up to 40 pages), `maxDepth`, `pathPrefix` (for example `/docs/`), `maxCharsPerPage` and `respectRobots` (fetch robots.txt first and skip disallowed URLs, following RFC 9309). |
| `map` | Finding the right page on a known site | Lists the URLs linked from a page plus the entries of the site's `/sitemap.xml`. Supports a substring filter (`search`), `sameDomainOnly` and `limit`. |
| `search` | Raw web search results | Uses Brave Search when `BRAVE_API_KEY` is set and DuckDuckGo HTML otherwise. `scrapeResults` also fetches each result. |

The tool descriptions steer Claude: `research` for questions and claims, `prior_art` for build decisions, `scrape`/`batch_scrape`/`crawl`/`map` for specific URLs and sites.

### Research skill

[`skills/research/SKILL.md`](skills/research/SKILL.md) is a Claude skill that describes the research method (start with `research`, prefer primary sources, cross-check key claims, flag preprints and single sources, run `prior_art` before building). Upload it to Claude as a custom skill (zip the `skills/research` folder if the upload asks for an archive).

## Deploy

Requires Node.js 22 or later and a Cloudflare account (the free plan is enough).

```bash
npm install
npx wrangler login
npx wrangler deploy
```

Generate a long random secret and store it as `MCP_SECRET`. It becomes part of the endpoint URL and is the only thing protecting the endpoint, so treat it like a password:

```bash
openssl rand -hex 24
npx wrangler secret put MCP_SECRET
```

The MCP endpoint is:

```
https://emaf.<your-subdomain>.workers.dev/mcp/<MCP_SECRET>
```

Check that the Worker is up by opening `https://emaf.<your-subdomain>.workers.dev/health`.

## Add to Claude

In Claude, open **Settings → Connectors → Add custom connector**, paste the endpoint URL, leave the OAuth fields empty and save. Any other MCP client that supports the Streamable HTTP transport can use the same URL.

## Optional configuration

All of these are optional; every tool works without them.

| Setting | Type | Effect |
| --- | --- | --- |
| `GITHUB_TOKEN` | secret | Read-only GitHub token for `prior_art`. Raises GitHub limits from 60 requests per hour and 10 searches per minute (per IP, shared with other Workers) to 5,000 per hour and 30 searches per minute, and enables GitHub code search, which GitHub only allows with authentication. A fine-grained token with no extra permissions (public repositories, read-only) is enough. |
| `BRAVE_API_KEY` | secret | Uses the [Brave Search API](https://brave.com/search/api/) for web search. DuckDuckGo, the fallback, may rate-limit requests coming from Cloudflare. |
| `OPENALEX_API_KEY` | secret | Free [OpenAlex](https://openalex.org) API key. Keyless use works (10 requests per second); a key raises the daily budget tenfold. |
| `OPENALEX_MAILTO` | variable | Contact address sent to OpenAlex as `mailto`. |
| `AI` | binding | [Workers AI](https://developers.cloudflare.com/workers-ai/). Enables the embedding rerank stage of `research`. |
| `CACHE` | binding | [Workers KV](https://developers.cloudflare.com/kv/) namespace that caches `scrape` results. |
| `RATE_LIMITER` | binding | [Workers Rate Limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) for tool calls. |
| `RATE_LIMIT_PER_MINUTE` | variable | Tool calls per minute for the in-memory fallback limiter used without `RATE_LIMITER` (default 60, `0` disables it). |
| `BROWSER` | binding | [Browser Rendering](https://developers.cloudflare.com/browser-rendering/). Enables `render: true` on `scrape`. |

Secrets are set with `npx wrangler secret put <NAME>`. Bindings and variables are configured in `wrangler.toml` (commented examples are included).

### Embedding rerank (Workers AI)

With the `AI` binding, `research` reorders the top 30 BM25 passages by cosine similarity of [`@cf/baai/bge-base-en-v1.5`](https://developers.cloudflare.com/workers-ai/models/bge-base-en-v1.5/) embeddings, in one batched call. Without the binding, or if the call fails, BM25 ranking is used alone.

Workers AI limits on the Workers Free plan (from the Cloudflare docs, checked November 2026):

- 10,000 neurons per day at no charge, reset daily at 00:00 UTC. When the allocation is used up, further calls fail until the reset (`research` then falls back to BM25); going beyond it requires Workers Paid ($0.011 per 1,000 neurons).
- `bge-base-en-v1.5` costs 6,058 neurons per million input tokens. One rerank embeds roughly 10,000 to 12,000 tokens, about 60 to 75 neurons, so the free allocation covers roughly 130 reranked `research` calls per day.
- Text embedding models are limited to 3,000 requests per minute.
- The model is English-focused and accepts up to 512 tokens per input; passages are clipped to 350 words.

### Scrape cache (Workers KV)

Create a namespace and add the commented `[[kv_namespaces]]` block in `wrangler.toml` with its id:

```bash
npx wrangler kv namespace create CACHE
```

`scrape` then stores each successful result under a hash of the URL and the output options, with `cacheTtl` seconds of expiry (default 3600, minimum 60), and serves later calls from the cache while the copy is younger than `cacheTtl`. Cached responses start with a note giving their age. Error pages are not cached, and a failing cache never fails a scrape.

KV is included in Workers Free: 100,000 reads, 1,000 writes and 1 GB of storage per day (from the Cloudflare docs, checked November 2026). Every cache miss is one write, so the free plan caches up to 1,000 new pages per day; beyond that, writes fail and `scrape` keeps working uncached. KV reads and writes are included in the subrequest budget.

### Rate limiting

Tool calls (`tools/call`) are rate limited per secret; the handshake, `tools/list` and pings are not. The key is derived from a hash of `MCP_SECRET`, never the secret itself. A limited call returns a tool error asking Claude to wait, and the tool does not run.

- With the `RATE_LIMITER` binding (the commented `[[ratelimits]]` block in `wrangler.toml`), Cloudflare's limiter applies. It is approximate and counts separately in each Cloudflare location.
- Without it, an in-memory limiter allows `RATE_LIMIT_PER_MINUTE` tool calls per minute (default 60) in each Worker isolate. It is a best-effort guard against a leaked secret, not a global limit. Set it to `0` to disable it.

## Limits

- **Subrequests.** Workers Free allows 50 external subrequests per invocation, plus 1,000 to Cloudflare services such as KV and Workers AI. EMAF counts every outbound call (fetches, KV, the Workers AI call, Browser Rendering) against a single budget of 45 per MCP request, which stays below the stricter external limit; batched JSON-RPC calls share it. `research` plans its page reads within the remaining budget and falls back to search snippets when it runs low; `prior_art` limits README and repository lookups the same way. The output reports how many subrequests were used.
- **Typical cost.** `research` (normal): 2 web searches, 1 OpenAlex call, 1 arXiv call and up to 6 page reads. `prior_art`: 2 GitHub searches, 1 npm search, up to 3 PyPI lookups, up to 4 repository lookups and up to 10 READMEs.
- **CPU time.** Workers Free allows 10 ms of CPU time per invocation. Parsing and ranking many pages (`crawl`, `research` with `depth: "deep"`) can exceed it; Workers Paid raises the limit.
- **Crawl** is capped at 40 pages per call. Run several crawls with different `pathPrefix` values for larger sites.
- **PyPI** has no official search API. `prior_art` looks up a few project names derived from the description and finds Python packages through GitHub search; packages with unrelated names may be missed.
- **arXiv** asks clients to make at most one request every three seconds; `research` makes one arXiv request per call. Avoid firing many `research` calls in parallel.
- **GitHub** limits unauthenticated requests per IP, and Workers share outbound IPs, so `prior_art` without `GITHUB_TOKEN` may hit rate limits. The output says so when it happens.
- Without rendering, pages that build their content entirely in JavaScript come back mostly empty. Use `render: true` for those.
- `scrape` and `batch_scrape` extract the text layer of PDFs up to 10 MB with [unpdf](https://github.com/unjs/unpdf) (a serverless build of pdf.js). Scanned PDFs without a text layer return a note instead of text, since there is no OCR. Parsing large PDFs uses CPU time that can exceed the Workers Free limit. Other binary content, such as images, is rejected; `crawl` and `research` skip PDFs (`research` uses the search snippet).
- Sites behind aggressive bot protection may still block requests.

## Development

```bash
npm install
echo 'MCP_SECRET="dev"' > .dev.vars
npm run dev
# endpoint: http://127.0.0.1:8787/mcp/dev
```

`.dev.vars` and `.env` hold local secrets and are ignored by Git.

| Command | Description |
| --- | --- |
| `npm run dev` | Run the Worker locally with `wrangler dev`. |
| `npm run typecheck` | Type-check the source and the tests. |
| `npm test` | Run the test suite once. |
| `npm run test:watch` | Run the tests in watch mode. |
| `npm run deploy` | Deploy to Cloudflare. |

Tests use [Vitest](https://vitest.dev) with [`@cloudflare/vitest-plugin`](https://developers.cloudflare.com/workers/testing/vitest-integration/), so they run inside the Workers runtime. Outbound `fetch` is replaced by a router over fixtures (`test/fixtures.ts` for HTML pages, `test/api-fixtures.ts` for OpenAlex, arXiv, GitHub, npm and PyPI responses); any request without a fixture fails, so tests never reach the network.

CI (GitHub Actions) runs the typecheck, the tests and `wrangler deploy --dry-run` on every push and pull request.

### Project layout

```
src/
  index.ts           Worker entry point: routing and secret check
  env.ts             Bindings and secrets
  config.ts          Constants (protocol versions, timeouts, budgets, models)
  context.ts         Per-request tool context (env and subrequest budget)
  budget.ts          Subrequest accounting
  util.ts            Argument validation and URL helpers
  fetch.ts           Page fetching (plain fetch or Browser Rendering)
  extract.ts         HTML to Markdown / text conversion
  images.ts          Badge removal and signed image URL cleanup
  clients/           One client per external API (web search, OpenAlex, arXiv, GitHub, npm, PyPI)
  rank/              Tokenizer, BM25, chunking, near-duplicate removal, query derivation, embedding rerank
  mcp/http.ts        Streamable HTTP transport (POST, CORS, batching)
  mcp/jsonrpc.ts     JSON-RPC dispatch and MCP methods
  tools/             One module per tool: definition and handler
skills/research/     Claude skill describing the research method
test/                Vitest suites and fixtures
```

Note: linkedom does not implement `HTMLTableElement.rows`, which the GFM table rules need. `prepareTables()` in `src/extract.ts` adds the getter to the element prototype, because Turndown clones the tree before converting and per-element patches would be lost.
