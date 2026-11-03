import { env as testBindings } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { resetRateLimitState } from "../src/ratelimit";
import { page, SITE } from "./fixtures";
import { BASE_URL, mockFetch, postMcp, request, testEnv } from "./helpers";

const PASSWORD = "correct horse battery staple";
const REDIRECT_URI = "https://claude.test/api/mcp/auth_callback";
const RESOURCE = `${BASE_URL}/mcp`;

function oauthEnv(overrides: Partial<Env> = {}): Env {
  return testEnv({ OAUTH_KV: testBindings.TEST_OAUTH_KV, AUTH_PASSWORD: PASSWORD, ...overrides });
}

beforeEach(() => {
  resetRateLimitState();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = "v".repeat(20) + crypto.randomUUID().replace(/-/g, "");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return { verifier, challenge };
}

async function registerClient(env: Env, name = "Claude", redirectUri = REDIRECT_URI): Promise<string> {
  const response = await request(
    "/oauth/register",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: name,
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    },
    env,
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as { client_id: string }).client_id;
}

/** Opens the consent page and returns what the browser would keep: the form handle and cookies. */
async function openConsent(env: Env, clientId: string, challenge: string, redirectUri = REDIRECT_URI) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "state-123",
    scope: "mcp",
    resource: RESOURCE,
  });
  const response = await request(`/authorize?${params}`, {}, env);
  const html = await response.text();
  const handle = html.match(/name="handle" value="([^"]+)"/)?.[1] ?? "";
  const cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return { response, html, handle, cookie };
}

function submitConsent(env: Env, consent: { handle: string; cookie: string }, fields: Record<string, string>) {
  return request(
    "/authorize",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: consent.cookie },
      body: new URLSearchParams({ handle: consent.handle, ...fields }).toString(),
      redirect: "manual",
    },
    env,
  );
}

interface Tokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

function requestToken(env: Env, fields: Record<string, string>) {
  return request(
    "/oauth/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    },
    env,
  );
}

async function obtainGrant(env: Env, redirectUri = REDIRECT_URI, registeredRedirectUri = redirectUri) {
  const clientId = await registerClient(env, "Codex", registeredRedirectUri);
  const { verifier, challenge } = await pkce();
  const consent = await openConsent(env, clientId, challenge, redirectUri);
  expect(consent.response.status).toBe(200);
  const approved = await submitConsent(env, consent, { decision: "approve", password: PASSWORD });
  expect(approved.status).toBe(302);
  const callback = new URL(approved.headers.get("Location") ?? "");
  expect(callback.origin + callback.pathname).toBe(redirectUri);
  expect(callback.searchParams.get("state")).toBe("state-123");
  expect(callback.searchParams.get("iss")).toBe(BASE_URL);
  const response = await requestToken(env, {
    grant_type: "authorization_code",
    code: callback.searchParams.get("code") ?? "",
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
    resource: RESOURCE,
  });
  expect(response.status).toBe(200);
  return { clientId, tokens: (await response.json()) as Tokens };
}

async function obtainToken(env: Env): Promise<string> {
  return (await obtainGrant(env)).tokens.access_token;
}

function mcpWithToken(env: Env, token: string, body: unknown) {
  return request(
    "/mcp",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    },
    env,
  );
}

describe("OAuth", () => {
  it("is off unless OAUTH_KV and AUTH_PASSWORD are both set", async () => {
    expect((await request("/mcp", { method: "POST", body: "{}" }, testEnv())).status).toBe(404);
    expect((await request("/.well-known/oauth-authorization-server", {}, testEnv())).status).toBe(404);
    const onlyKv = testEnv({ OAUTH_KV: testBindings.TEST_OAUTH_KV });
    expect((await request("/mcp", { method: "POST", body: "{}" }, onlyKv)).status).toBe(404);
  });

  it("challenges unauthenticated MCP requests with the resource metadata URL", async () => {
    const response = await request("/mcp", { method: "POST", body: "{}" }, oauthEnv());
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain(
      `resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource/mcp"`,
    );
  });

  it("publishes protected resource and authorization server metadata", async () => {
    const env = oauthEnv();
    const resource = (await (await request("/.well-known/oauth-protected-resource/mcp", {}, env)).json()) as {
      resource: string;
      authorization_servers: string[];
    };
    expect(resource.resource).toBe(RESOURCE);
    expect(resource.authorization_servers).toEqual([BASE_URL]);
    const server = (await (await request("/.well-known/oauth-authorization-server", {}, env)).json()) as Record<
      string,
      unknown
    >;
    expect(server.issuer).toBe(BASE_URL);
    expect(server.authorization_endpoint).toBe(`${BASE_URL}/authorize`);
    expect(server.token_endpoint).toBe(`${BASE_URL}/oauth/token`);
    expect(server.registration_endpoint).toBe(`${BASE_URL}/oauth/register`);
  });

  it("completes the authorization code flow and serves MCP with the token", async () => {
    const env = oauthEnv();
    const token = await obtainToken(env);
    const response = await mcpWithToken(env, token, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: { tools: { name: string }[] } };
    expect(body.result.tools.map((t) => t.name)).toContain("research");
  });

  it.each([43127, 51843])("accepts a Codex loopback callback on port %i", async (port) => {
    const env = oauthEnv();
    const registered = "http://127.0.0.1/callback/emaf-test";
    const redirectUri = `http://127.0.0.1:${port}/callback/emaf-test`;
    const { tokens } = await obtainGrant(env, redirectUri, registered);
    const response = await mcpWithToken(env, tokens.access_token, { jsonrpc: "2.0", id: 1, method: "ping" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
  });

  it.each([
    "http://127.0.0.1:43127/callback/another-server",
    "http://localhost:43127/callback/emaf-test",
  ])("rejects a loopback callback that changes the registered host or path: %s", async (redirectUri) => {
    const env = oauthEnv();
    const clientId = await registerClient(env, "Codex", "http://127.0.0.1/callback/emaf-test");
    const consent = await openConsent(env, clientId, (await pkce()).challenge, redirectUri);
    expect(consent.response.status).toBe(400);
    expect(consent.handle).toBe("");
  });

  it("refreshes a Codex token without repeating consent", async () => {
    const env = oauthEnv();
    const { clientId, tokens } = await obtainGrant(env, "http://127.0.0.1:43127/callback/emaf-test");
    expect(tokens.refresh_token).toBeTruthy();
    const response = await requestToken(env, {
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: clientId,
      resource: RESOURCE,
    });
    expect(response.status).toBe(200);
    const refreshed = (await response.json()) as Tokens;
    expect(refreshed.access_token).toBeTruthy();
    expect(refreshed.access_token).not.toBe(tokens.access_token);
    expect(refreshed.refresh_token).toBeTruthy();
    expect(refreshed.refresh_token).not.toBe(tokens.refresh_token);
    expect(refreshed.token_type.toLowerCase()).toBe("bearer");
    expect(refreshed.expires_in).toBeGreaterThan(0);
    const ping = await mcpWithToken(env, refreshed.access_token, { jsonrpc: "2.0", id: 1, method: "ping" });
    expect(ping.status).toBe(200);
    expect(await ping.json()).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
  });

  it.each(["secret URL", "OAuth"])("serves the Codex MCP lifecycle through %s", async (auth) => {
    const mock = mockFetch({
      [`${SITE}/robots.txt`]: { body: "User-agent: *\nAllow: /", contentType: "text/plain" },
      [`${SITE}/docs`]: page({ title: "Connector documentation", heading: "Using the connector" }),
    });
    const env = auth === "OAuth" ? oauthEnv() : testEnv();
    const token = auth === "OAuth" ? await obtainToken(env) : "";
    const send = (body: unknown) => auth === "OAuth" ? mcpWithToken(env, token, body) : postMcp(body, env);
    const initialized = await send({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "codex", version: "test" },
      },
    });
    expect(initialized.status).toBe(200);
    expect(initialized.headers.get("Content-Type")).toBe("application/json");
    expect(initialized.headers.has("Mcp-Session-Id")).toBe(false);
    expect(await initialized.json()).toMatchObject({
      id: 1, result: { protocolVersion: "2025-06-18", serverInfo: { name: "emaf" } },
    });
    const notification = await send({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(notification.status).toBe(202);
    expect(await notification.text()).toBe("");
    const listed = await send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(listed.status).toBe(200);
    const catalog = (await listed.json()) as { result: { tools: { name: string }[] } };
    expect(catalog.result.tools.map((tool) => tool.name)).toContain("scrape");
    const called = await send({
      jsonrpc: "2.0", id: 3, method: "tools/call",
      params: { name: "scrape", arguments: { url: `${SITE}/docs` } },
    });
    expect(called.status).toBe(200);
    const result = (await called.json()) as {
      id: number; result: { isError: boolean; content: { type: string; text: string }[] };
    };
    expect(result.id).toBe(3);
    expect(result.result.isError).toBe(false);
    expect(result.result.content[0].type).toBe("text");
    expect(result.result.content[0].text).toContain("Using the connector");
    expect(result.result.content[0].text).toContain(`URL: ${SITE}/docs`);
    expect(mock.requested).toContain(`${SITE}/docs`);
    expect(mock.unexpected).toEqual([]);
  });

  it("rejects an invalid token", async () => {
    const response = await mcpWithToken(oauthEnv(), "not-a-token", { jsonrpc: "2.0", id: 1, method: "ping" });
    expect(response.status).toBe(401);
  });

  it("shows the client and where access goes, with client data escaped", async () => {
    const env = oauthEnv();
    const clientId = await registerClient(env, `<script>alert("x")</script>`);
    const { response, html } = await openConsent(env, clientId, (await pkce()).challenge);
    expect(response.status).toBe(200);
    expect(html).toContain("&#60;script&#62;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("<strong>claude.test</strong>");
    expect(html).toContain("This app registered itself; its name is not verified.");
    expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });

  it("refuses a wrong password and lets the owner retry", async () => {
    const env = oauthEnv();
    const clientId = await registerClient(env);
    const consent = await openConsent(env, clientId, (await pkce()).challenge);
    const wrong = await submitConsent(env, consent, { decision: "approve", password: "nope" });
    expect(wrong.status).toBe(401);
    expect(await wrong.text()).toContain("Wrong password.");
    const right = await submitConsent(env, consent, { decision: "approve", password: PASSWORD });
    expect(right.status).toBe(302);
    expect(right.headers.get("Location")).toMatch(/^https:\/\/claude\.test\/api\/mcp\/auth_callback\?code=/);
  });

  it("throttles password attempts", async () => {
    const env = oauthEnv();
    const clientId = await registerClient(env);
    const consent = await openConsent(env, clientId, (await pkce()).challenge);
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await submitConsent(env, consent, { decision: "approve", password: "wrong" })).status);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
  });

  it("redirects with access_denied when the owner denies", async () => {
    const env = oauthEnv();
    const clientId = await registerClient(env);
    const consent = await openConsent(env, clientId, (await pkce()).challenge);
    const denied = await submitConsent(env, consent, { decision: "deny" });
    expect(denied.status).toBe(302);
    const location = new URL(denied.headers.get("Location") ?? "");
    expect(location.searchParams.get("error")).toBe("access_denied");
    expect(location.searchParams.get("state")).toBe("state-123");
  });

  it("refuses to authorize with a short AUTH_PASSWORD", async () => {
    const env = oauthEnv({ AUTH_PASSWORD: "short" });
    const clientId = await registerClient(env);
    const { response, html } = await openConsent(env, clientId, (await pkce()).challenge);
    expect(response.status).toBe(500);
    expect(html).toContain("at least 12 characters");
  });

  it("keeps the secret URL working next to OAuth", async () => {
    const response = await postMcp({ jsonrpc: "2.0", id: 1, method: "ping" }, oauthEnv());
    expect(response.status).toBe(200);
  });

  it("disables the secret URL when MCP_SECRET is removed", async () => {
    const env = oauthEnv({ MCP_SECRET: undefined });
    const response = await postMcp({ jsonrpc: "2.0", id: 1, method: "ping" }, env, "anything");
    expect(response.status).toBe(404);
  });
});
