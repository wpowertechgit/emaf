# Configuration

All settings are optional. Secrets are set with `npx wrangler secret put <NAME>`. Bindings and variables go in `wrangler.toml`, which has commented examples for each. Redeploy after changing them.

Free-tier numbers below are from the Cloudflare docs, checked November 2026.

## Secrets

| Secret | Effect |
| --- | --- |
| `MCP_SECRET` | Path segment of the endpoint, `/mcp/<MCP_SECRET>`. Required unless OAuth is configured. |
| `GITHUB_TOKEN` | Raises GitHub limits for `prior_art` from 60 requests per hour and 10 searches per minute (per IP, and Workers share IPs) to 5,000 per hour and 30 searches per minute. Enables code search, which GitHub only allows with a token. A fine-grained token with read access to public repositories is enough. |
| `BRAVE_API_KEY` | Uses the [Brave Search API](https://brave.com/search/api/). DuckDuckGo, the fallback, may rate-limit requests from Cloudflare. |
| `OPENALEX_API_KEY` | Free [OpenAlex](https://openalex.org) key. Keyless use works at 10 requests per second; a key raises the daily budget tenfold. |
| `AUTH_PASSWORD` | Owner password for OAuth. See [OAuth](#oauth). |

## Variables

| Variable | Effect |
| --- | --- |
| `OPENALEX_MAILTO` | Contact address sent to OpenAlex. |
| `RATE_LIMIT_PER_MINUTE` | Tool calls per minute for the in-memory limiter. Default 60, `0` disables it. |

## Workers AI (`AI`)

The binding is enabled in `wrangler.toml`. It does two things.

### Page conversion

Parsing a page into a DOM is the expensive part of EMAF: Readability and Turndown take about 550 ms of CPU on a 650 KB Wikipedia article, far over the 10 ms Workers Free allows per request. With the binding, `scrape`, `batch_scrape`, `crawl` and `research` send HTML to [Markdown Conversion](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/), which runs on Cloudflare and does not count as this Worker's CPU time. Cloudflare describes it as free for most formats and names only image conversion as using Workers AI models, which EMAF never sends.

- If a conversion fails, the tool falls back to local extraction for that page.
- `format: "html"`, `onlyMainContent: false` and text output with `includeLinks` always use the local pipeline.
- Without the binding, `research` uses a fast local text extractor (about 3 ms on the same page), and the other tools use Readability and Turndown.
- Each conversion counts against the budget for calls to Cloudflare services (900 per request), not the external budget of 45.

### Embedding rerank

`research` reorders the top 30 BM25 passages by cosine similarity of [`@cf/baai/bge-base-en-v1.5`](https://developers.cloudflare.com/workers-ai/models/bge-base-en-v1.5/) embeddings, in one call. If the binding is missing or the call fails, BM25 is used alone.

- Workers Free includes 10,000 neurons per day, reset at 00:00 UTC. After that, calls fail until the reset and `research` falls back to BM25.
- One rerank embeds about 10,000 to 12,000 tokens, roughly 60 to 75 neurons. That is about 130 reranked calls per day for free.
- The model is English-focused. Passages are clipped to 350 words to fit its 512-token input.

## Scrape cache (`CACHE`)

```bash
npx wrangler kv namespace create CACHE
```

Put the id in the commented `CACHE` block in `wrangler.toml`.

`scrape` stores successful results under a hash of the URL and output options, expiring after `cacheTtl` seconds (default 3600, minimum 60). A cached reply starts with a note giving its age. Error pages are not cached. A failing cache never fails a scrape.

Workers Free includes 100,000 KV reads, 1,000 writes and 1 GB of storage per day. Each cache miss is one write, so the free plan caches up to 1,000 new pages a day; past that, `scrape` keeps working uncached.

## Rate limiting (`RATE_LIMITER`)

Tool calls are rate limited per secret (or per OAuth user). The handshake, `tools/list` and pings are not counted. A limited call returns a tool error asking Claude to wait. The limiter key is a hash of the secret, never the secret itself.

- With the `RATE_LIMITER` binding (commented `[[ratelimits]]` block in `wrangler.toml`), Cloudflare's limiter applies. It is approximate and counts per Cloudflare location. `namespace_id` is any integer unique in your account; nothing needs to be created.
- Without it, an in-memory limiter allows `RATE_LIMIT_PER_MINUTE` calls per minute in each Worker isolate. It slows down a leaked secret; it is not a global limit.

## OAuth

By default the URL secret is the only protection, and revoking access means rotating it. With OAuth, the connector URL is public and Claude signs in once through a consent page that asks for an owner password. Access is a token that expires and refreshes.

```bash
npx wrangler kv namespace create OAUTH_KV   # put the id in the commented OAUTH_KV block in wrangler.toml
npx wrangler secret put AUTH_PASSWORD        # 12+ characters
npx wrangler deploy
```

Add `https://emaf.<your-subdomain>.workers.dev/mcp` (no secret) as a connector in Claude, with the OAuth fields empty. Claude registers itself and opens the consent page, which shows the app and where access will be sent. Enter the password and choose **Allow**.

- Built on [`@cloudflare/workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider): OAuth 2.1 with PKCE, RFC 8414 and RFC 9728 discovery, Dynamic Client Registration. Tokens are stored in KV as hashes.
- 5 password attempts per minute per IP and isolate.
- The secret URL keeps working alongside OAuth. Turn it off with `npx wrangler secret delete MCP_SECRET`.
- Tokens are bound to the hostname used to connect.

## JavaScript rendering (`BROWSER`)

Uncomment the `[browser]` block to enable `render: true` on `scrape` through [Browser Rendering](https://developers.cloudflare.com/browser-rendering/), which has its own plan limits.

## Request budget

Workers Free allows 50 external subrequests per invocation, plus 1,000 to Cloudflare services such as KV and Workers AI. EMAF tracks both per MCP request: 45 external calls (fetches) and 900 calls to Cloudflare services (KV, Workers AI); batched calls share them. Tools plan within what is left and degrade instead of failing, and their output says how much was used.

Typical cost: `research` (normal) makes 2 web searches, 1 OpenAlex call, 1 arXiv call and up to 6 page reads. `prior_art` makes 2 GitHub searches, 1 npm search, up to 3 PyPI lookups, up to 4 repository lookups and up to 10 README fetches.

arXiv asks for at most one request every three seconds; `research` makes one per call, so avoid running many in parallel.
