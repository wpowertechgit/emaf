# Contributing

Bug reports, fixes and focused features are welcome. For anything larger than a bug fix, open an issue first so we can agree on the approach.

## Setup

Node.js 22+.

```bash
npm install
echo 'MCP_SECRET="dev"' > .dev.vars
npm run dev          # http://127.0.0.1:8787/mcp/dev
```

`.dev.vars` and `.env` are gitignored. Never commit secrets.

## Before you open a pull request

All four must pass. CI runs the same checks.

```bash
npm run typecheck
npm test
npx wrangler deploy --dry-run
python scripts/emoji-gestapo.py .
```

## Rules

- **Tests never touch the network.** Mock `fetch` with the helpers in `test/helpers.ts` and add fixtures (`test/fixtures.ts` for pages, `test/api-fixtures.ts` for API responses). Unknown URLs fail the test.
- **Bug fixes come with a test that fails without the fix.**
- **Stay on the free plan.** No paid APIs or bindings as requirements. Optional bindings must degrade cleanly when missing.
- **Respect the request budget.** Every outbound call goes through `Budget`. Tools plan within what is left and say in their output when they cut something.
- **Bound the output.** Every tool has a default size limit.
- **Tool descriptions matter.** Claude chooses tools by description. A new tool's description must say when to use it and not overlap with existing ones.
- **New dependencies need a reason** in the pull request, plus the bundle size from the dry-run.
- **Style:** plain English, no emoji, no em dashes (the style check enforces this). Comments explain why, not what.

[AGENTS.md](AGENTS.md) has the full list, including known quirks that must not be removed.

## Commits

Small and focused, one logical change each. Imperative subject under 72 characters ("Add robots.txt support to crawl"), and a body explaining why when it is not obvious.

## Layout

```
src/
  index.ts         Routing: health, secret URL, OAuth
  mcp/             Streamable HTTP transport and JSON-RPC dispatch
  tools/           One file per tool: definition and handler
  clients/         One client per external API
  rank/            Tokenizer, BM25, chunking, dedup, query derivation, embedding rerank
  extract.ts       HTML to Markdown
  fetch.ts         Page fetching, PDF detection
  budget.ts        Subrequest accounting
  oauth.ts         OAuth provider and consent page
test/              Vitest suites (run inside workerd) and fixtures
skills/research/   Claude skill for the research method
docs/              Tool reference and configuration
```

## Security

Do not open public issues for vulnerabilities. See [SECURITY.md](SECURITY.md).
