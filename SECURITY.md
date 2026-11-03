# Security

## Reporting a vulnerability

Report it privately through [GitHub security advisories](https://github.com/wpowertechgit/emaf/security/advisories/new). Do not open a public issue.

Include what is affected, how to reproduce it, and the impact you expect.

## Scope

In scope: authentication bypass (secret URL or OAuth), leaking `MCP_SECRET` or tokens, server-side request forgery beyond fetching the URLs a tool is asked to fetch, injection through scraped content into the consent page, and anything that lets one caller exhaust another deployment's resources.

Out of scope: content of the pages EMAF fetches, rate limits of third-party APIs, and issues in a deployment whose secret was shared by its owner.

## Running your own instance

- Treat the endpoint URL as a password. Rotate `MCP_SECRET` if it leaks, or switch to OAuth.
- Use a read-only `GITHUB_TOKEN` with no private repository access.
- Never commit `.dev.vars` or `.env`.
