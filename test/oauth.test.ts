import { env as testBindings } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { resetRateLimitState } from "../src/ratelimit";
import { BASE_URL, postMcp, request, testEnv } from "./helpers";

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

async function registerClient(env: Env, name = "Claude"): Promise<string> {
  const response = await request(
    "/oauth/register",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: name,
        redirect_uris: [REDIRECT_URI],
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
async function openConsent(env: Env, clientId: string, challenge: string) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
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

async function obtainToken(env: Env): Promise<string> {
  const clientId = await registerClient(env);
  const { verifier, challenge } = await pkce();
  const consent = await openConsent(env, clientId, challenge);
  const approved = await submitConsent(env, consent, { decision: "approve", password: PASSWORD });
  expect(approved.status).toBe(302);
  const code = new URL(approved.headers.get("Location") ?? "").searchParams.get("code") ?? "";
  const response = await request(
    "/oauth/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: clientId,
        code_verifier: verifier,
        resource: RESOURCE,
      }).toString(),
    },
    env,
  );
  expect(response.status).toBe(200);
  return ((await response.json()) as { access_token: string }).access_token;
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
