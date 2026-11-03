# Codex setup

EMAF uses stateless MCP Streamable HTTP with JSON responses. Codex connects directly to the deployed Worker. All seven tools read public sources and advertise `readOnlyHint: true`, `destructiveHint: false` and `openWorldHint: true`.

## OAuth

First configure `OAUTH_KV` and `AUTH_PASSWORD` as described in [Configuration](configuration.md#oauth). Then replace `YOUR-SUBDOMAIN` and run:

```bash
codex mcp add emaf --url https://emaf.YOUR-SUBDOMAIN.workers.dev/mcp
codex mcp login emaf
```

On the consent page, enter your EMAF owner password and choose **Allow**. Codex handles client registration, PKCE, the local callback and token refresh. The owner password belongs in the consent page, not in Codex configuration.

## Secret URL

Without OAuth, use the existing `/mcp/<MCP_SECRET>` endpoint. Add this table to your private `~/.codex/config.toml`, replacing the placeholders locally:

```toml
[mcp_servers.emaf]
url = "https://emaf.YOUR-SUBDOMAIN.workers.dev/mcp/YOUR-MCP-SECRET"
```

On Windows the default file is `%USERPROFILE%\.codex\config.toml`. Keep it private: the URL contains the password. Use `codex mcp login emaf` only with the OAuth endpoint above.

`MCP_SECRET` is a URL path secret, not a bearer token. Codex's `bearer_token_env_var` setting does not turn it into a token accepted by `/mcp`.

## Connection settings

The CLI, desktop app and IDE extension share MCP configuration for the same Codex host. To configure OAuth manually, use:

```toml
[mcp_servers.emaf]
url = "https://emaf.YOUR-SUBDOMAIN.workers.dev/mcp"
```

Then run `codex mcp login emaf`. Edit the existing table when changing settings; do not add a second `[mcp_servers.emaf]` table.

Codex defaults to a 60-second tool timeout. For longer research or crawl calls, you can add `tool_timeout_sec = 120` inside the table. This only changes how long Codex waits; EMAF's service timeouts, subrequest budget and Workers CPU limits still apply.

Project-scoped configuration can live in `.codex/config.toml` in a trusted project. Use the public OAuth URL there. Keep secret URLs and credentials out of version control.

See the [official Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp) for client settings and authentication options.

## Optional research skill

The existing [research skill](../skills/research/SKILL.md) works with Codex as well as Claude. Copy the entire `skills/research` directory to either:

- `~/.agents/skills/research` for your user, or `%USERPROFILE%\.agents\skills\research` on Windows.
- `.agents/skills/research` in a project for repository-scoped use.

The resulting path must end in `research/SKILL.md`. Preserve an existing skill at that location before copying. Codex detects installed skills automatically; restart it if the skill does not appear. Invoke it with `$research`, for example: `$research Check whether a maintained TypeScript library already implements this feature.`

The skill adds a research workflow. Configure the EMAF MCP connection separately so its tools are available. See [Codex skill locations](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills).

## Check the connection

Run `codex mcp list` to check that EMAF is registered, then use `/mcp` inside Codex to check connection status and the available tools. Ask Codex to use EMAF's `scrape` tool on a public documentation URL. A successful call returns Markdown with a source URL.

- A 404 usually means the secret URL is wrong, or `/mcp` was used before OAuth was enabled.
- A 401 on `/mcp` means authentication is needed. Run `codex mcp login emaf` and finish consent.
- If a tool times out, narrow the query or page count before raising the client timeout.
- Budget, rate-limit and missing-service messages come from EMAF. Follow the message and disclose partial results when answering.

These instructions cover direct MCP configuration on a Codex host. ChatGPT web uses plugins rather than reading your local `config.toml`; see the [official MCP guide](https://learn.chatgpt.com/docs/extend/mcp#connect-an-existing-mcp-server).
