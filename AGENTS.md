
# AGENTS.md

Instructions for AI coding agents working in this repository. Read this file before making any change.

## Project

EMAF is a remote MCP server on Cloudflare Workers. It is used from claude.ai as a custom connector for web research and fact-checking: it turns web pages, search results and academic sources into clean, relevant Markdown. It must stay free to run on the Workers Free plan and must not depend on paid LLM or search APIs.

## Commands

```bash
npm install
npm run typecheck                        # tsc --noEmit
npm test                                 # vitest, no live network
npx wrangler deploy --dry-run            # bundle check
python scripts/emoji-gestapo.py .        # style check, must exit 0
npm run dev                              # local server, needs .dev.vars with MCP_SECRET
```

## Definition of done

A change is done only when all of these pass locally:

1. `npm run typecheck`
2. `npm test`
3. `npx wrangler deploy --dry-run`
4. `python scripts/emoji-gestapo.py .` exits 0

Never report a task as complete without running them. If one fails, fix it or say clearly that it fails and why.

## Style rules

- No emoji and no em dashes anywhere in the repository: code, comments, strings, tests, fixtures, docs, commit messages, PR descriptions, CI files. `scripts/emoji-gestapo.py` enforces this and runs in CI. Use a plain hyphen, a comma, a colon or a new sentence instead of an em dash.
- Plain, professional English in all of the above.
- Comments explain why, not what. No commented-out code, no TODOs without an issue reference.
- No filler: no "simply", "just", "robust", "seamless", "leverage", "comprehensive" in docs or comments. Say what the thing does.
- Keep functions small and named for what they do. Prefer clarity over cleverness.
- No new dependency without a reason stated in the PR description. Check bundle size impact with the dry-run.

## Architecture rules

- Transport: stateless MCP Streamable HTTP with JSON responses. No SSE, no sessions. The endpoint is `POST /mcp/<MCP_SECRET>`, plus `POST /mcp` with an OAuth bearer token when OAuth is configured (`OAUTH_KV` and `AUTH_PASSWORD`); the OAuth discovery, registration, token and `/authorize` routes exist only then. Every other path returns 404. Notifications return 202 with no body.
- Tool failures return a result with `isError: true` and a readable message. JSON-RPC errors are only for protocol problems (unknown method, unknown tool, invalid request).
- Subrequest budget: Workers Free allows 50 outbound requests per invocation. Every outbound call, including AI binding calls, goes through the shared budget accounting. Tools must degrade gracefully when the budget runs low and say so in their output.
- Every external call has a timeout and a clear error message naming the service.
- Tool output is bounded. Default limits exist for every tool; never return unbounded page dumps.
- Tool descriptions decide which tool claude.ai picks. When adding or changing a tool, write its description for that purpose and check it does not overlap with existing tools.
- Prefer official, free APIs (OpenAlex, arXiv, Crossref, GitHub REST, npm, PyPI) over scraping their HTML.

## Known quirks, do not remove

- linkedom does not implement `HTMLTableElement.rows`, which `turndown-plugin-gfm` needs. The getter is patched on the element prototype, not on instances, because turndown clones the tree before converting. Removing this breaks every page with a table.
- Fragment links: keep URL fragments in Markdown output; strip them only for deduplication in crawl and map.

## Testing

- Tests never hit the live network. Mock outbound fetch and use fixtures (HTML pages, OpenAlex JSON, arXiv Atom, GitHub, npm and PyPI responses).
- Every bug fix comes with a test that fails without the fix.
- When changing extraction, add or update a fixture that covers the case (tables, code blocks, relative links, navigation stripping, images with signed URLs, badges).

## Secrets and safety

- Secrets live in Wrangler secrets and `.dev.vars`. `.dev.vars` is never committed. The MCP secret is part of the URL, so never log request URLs or print the secret.
- Optional secrets: `BRAVE_API_KEY`, `GITHUB_TOKEN` (read-only). Optional bindings: Browser Rendering, Workers AI. All features must work, possibly degraded, without them.

## Ask the user before

- deploying, pushing, or creating releases
- creating or changing the GitHub repository settings
- choosing or changing the license
- adding a paid binding or anything that can cost money
- deleting files outside the change at hand, or rewriting git history

## Commits

- Small, focused commits. Imperative subject line under 72 characters, body explaining why when it is not obvious.
- One logical change per commit. Formatting-only changes go in their own commit.
