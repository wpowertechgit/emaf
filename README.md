# EMAF

### Enterprise Markdown Acquisition Framework

Research the web from Claude or Codex. Facts with sources, not page dumps.

Ask a question and get the relevant passages from web pages, papers and preprints, ranked and cited. Ask whether something already exists and get the open-source projects that do it, with the README line that proves it. Read any URL or PDF as clean Markdown.

A self-hosted MCP server on Cloudflare Workers. Runs on the free plan, no paid APIs.

## Tools

| Tool | For |
| --- | --- |
| `research` | Questions and fact-checks. Searches the web, OpenAlex and arXiv, reads the top pages, returns the best passages with sources. Preprints are flagged as not peer reviewed. |
| `prior_art` | "Does this exist?" Searches GitHub, npm and PyPI and quotes where each README mentions the feature, with stars, last push, license and maintenance status. |
| `scrape` | One URL as Markdown. HTML or PDF. |
| `batch_scrape` | Up to 20 URLs in one call. |
| `crawl` | Several pages of one site. |
| `map` | List a site's URLs from its links and sitemap. |
| `search` | Raw web search results. |

Parameters for each tool: [docs/tools.md](docs/tools.md).

## Deploy

Needs Node.js 22+ and a Cloudflare account.

```bash
git clone https://github.com/wpowertechgit/emaf.git
cd emaf
npm install
npx wrangler login
npx wrangler deploy
npx wrangler secret put MCP_SECRET    # long random string: openssl rand -hex 24
```

Your endpoint:

```
https://emaf.<your-subdomain>.workers.dev/mcp/<MCP_SECRET>
```

The secret is the password. Keep the URL private, or use [OAuth](docs/configuration.md#oauth) instead.

## Connect to Claude

**Settings → Connectors → Add custom connector**, paste the endpoint, leave the OAuth fields empty, save.

Optional: upload [`skills/research`](skills/research/SKILL.md) as a Claude skill. It tells Claude how to research: primary sources first, two independent sources per key claim, preprints and single sources called out.

## Connect to Codex

Codex connects directly over Streamable HTTP. With [OAuth configured](docs/configuration.md#oauth):

```bash
codex mcp add emaf --url https://emaf.YOUR-SUBDOMAIN.workers.dev/mcp
codex mcp login emaf
```

Enter the EMAF owner password on the consent page. Run `codex mcp list` to check registration and `/mcp` inside Codex to check the connection.

For the secret URL, `config.toml` settings, troubleshooting and the optional research skill, see [Codex setup](docs/codex.md).

## Configuration

Everything is optional. Without any of it, all tools work.

| Setting | Effect |
| --- | --- |
| `GITHUB_TOKEN` | Higher GitHub limits and code search for `prior_art`. Recommended. |
| `BRAVE_API_KEY` | Brave Search instead of DuckDuckGo. |
| `OPENALEX_API_KEY` | Higher OpenAlex daily budget. |
| `AI` | On by default. Converts pages on Cloudflare's side to stay within the free CPU limit, and reranks `research` passages. |
| `CACHE` | KV cache for `scrape`. |
| `OAUTH_KV` + `AUTH_PASSWORD` | OAuth sign-in instead of a secret URL. |
| `RATE_LIMITER` | Rate limit tool calls (in-memory fallback otherwise). |
| `BROWSER` | `render: true` for JavaScript-heavy pages. |

Setup and free-tier limits for each: [docs/configuration.md](docs/configuration.md).

## Limits

- Workers Free allows 50 outbound requests per call. EMAF budgets for that and reads fewer pages instead of failing. `crawl` stops at 40 pages.
- Workers Free allows 10 ms of CPU per request. With the `AI` binding, page conversion runs on Cloudflare and does not count; without it, `research` uses a fast text extractor, while `scrape`, `crawl` and large PDFs can go over on big pages.
- No JavaScript rendering without `BROWSER`. No OCR for scanned PDFs.
- PyPI has no search API, so `prior_art` finds Python packages by name guesses and through GitHub.
- Sites with strong bot protection may block requests.

## Development

```bash
npm install
echo 'MCP_SECRET="dev"' > .dev.vars
npm run dev          # http://127.0.0.1:8787/mcp/dev
npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
