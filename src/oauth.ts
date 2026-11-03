import {
  AuthorizationError,
  CimdFetchError,
  type ConsentDescription,
  type OAuthHelpers,
  OAuthProvider,
} from "@cloudflare/workers-oauth-provider";
import type { Env } from "./env";
import { handleMcpRequest } from "./mcp/http";
import { allowFixedWindow } from "./ratelimit";
import { timingSafeEqual } from "./util";

/** The single user of a self-hosted EMAF server. */
const OWNER_ID = "owner";
const SCOPE = "mcp";
/** Password attempts per minute and client IP (in memory, per isolate). */
const LOGIN_ATTEMPTS_PER_MINUTE = 5;
export const MIN_PASSWORD_LENGTH = 12;

/** OAuth is on when the token store and the owner password are both configured. */
export function oauthEnabled(env: Env): boolean {
  return Boolean(env.OAUTH_KV && env.AUTH_PASSWORD);
}

/**
 * Canonical base URL of this server: the request origin, which the OAuth
 * library also uses as issuer. Tokens are bound to `<origin>/mcp`, so a server
 * reachable on two hostnames issues separate tokens for each.
 */
export function publicBaseUrl(requestUrl: URL): string {
  return `${requestUrl.protocol}//${requestUrl.host}`.toLowerCase();
}

const escape = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const PAGE_STYLE =
  "body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;color:#1f2328;background:#fff}" +
  "@media (prefers-color-scheme:dark){body{color:#e6edf3;background:#0d1117}input{background:#161b22;color:#e6edf3}}" +
  "input,button{font:inherit;padding:.4rem .6rem}.warn{border-left:4px solid #d29922;padding-left:.75rem}.error{color:#cf222e}";

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>${PAGE_STYLE}</style></head><body>${body}</body></html>`;
}

function consentForm(handle: string, error = ""): string {
  return `${error ? `<p class="error">${escape(error)}</p>` : ""}
<form method="post">
  <input type="hidden" name="handle" value="${escape(handle)}">
  <p><label>EMAF owner password<br><input type="password" name="password" autocomplete="current-password" required autofocus></label></p>
  <p><button name="decision" value="approve">Allow</button> <button name="decision" value="deny" formnovalidate>Deny</button></p>
</form>`;
}

/** Renders the consent page; every value from the client is escaped, since an attacker chooses it. */
export function consentPage(details: ConsentDescription, handle: string): string {
  const name = escape(details.clientName);
  const origin = details.clientDomain
    ? `Published by <strong>${escape(details.clientDomain)}</strong>.`
    : "This app registered itself; its name is not verified.";
  const loopback = details.redirectIsLoopback
    ? '<p class="warn"><strong>This sends access to an app on your computer.</strong> Continue only if you just started connecting from it.</p>'
    : "";
  return page(
    `Authorize ${details.clientName}`,
    `<h1>Allow ${name} to use EMAF?</h1>
<p>${origin} Access will be sent to <strong>${escape(details.redirectHost)}</strong>.</p>
${loopback}
<p>The app will be able to call all EMAF tools (scrape, research and the others) on your behalf.</p>
${consentForm(handle)}`,
  );
}

function htmlResponse(html: string, status: number, headers = new Headers()): Response {
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
  return new Response(html, { status, headers });
}

async function passwordMatches(env: Env, password: string): Promise<boolean> {
  // Hash both sides so the comparison time does not depend on the password length.
  const digest = async (value: string) =>
    Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
  return timingSafeEqual(await digest(password), await digest(env.AUTH_PASSWORD ?? ""));
}

async function handleAuthorize(request: Request, env: Env, oauth: OAuthHelpers): Promise<Response> {
  if ((env.AUTH_PASSWORD ?? "").length < MIN_PASSWORD_LENGTH) {
    return new Response(`AUTH_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters long.
`, { status: 500 });
  }
  if (request.method === "GET") {
    const authRequest = await oauth.parseAuthRequest(request);
    const details = await oauth.describeConsent(authRequest);
    const consent = await oauth.beginConsent(authRequest);
    return htmlResponse(consentPage(details, consent.handle), 200, consent.headers);
  }
  if (request.method !== "POST") return new Response("Method not allowed\n", { status: 405 });

  const form = await request.formData();
  const handle = String(form.get("handle") ?? "");
  if (form.get("decision") !== "approve") {
    const denied = await oauth.denyConsent(request, handle);
    return new Response(null, { status: 302, headers: denied.headers });
  }

  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  if (!allowFixedWindow(`login:${ip}`, LOGIN_ATTEMPTS_PER_MINUTE, Date.now())) {
    return htmlResponse(page("Too many attempts", consentForm(handle, "Too many attempts. Wait a minute and try again.")), 429);
  }
  if (!(await passwordMatches(env, String(form.get("password") ?? "")))) {
    // The handle is not consumed, so the owner can retry from the same page.
    return htmlResponse(page("Wrong password", consentForm(handle, "Wrong password.")), 401);
  }

  const approved = await oauth.approveConsent(request, handle, { scope: [SCOPE] });
  const { redirectTo } = await oauth.completeAuthorization({
    request: approved.request,
    userId: OWNER_ID,
    metadata: {},
    scope: [SCOPE],
    props: { userId: OWNER_ID },
  });
  approved.headers.set("Location", redirectTo);
  return new Response(null, { status: 302, headers: approved.headers });
}

async function defaultFetch(request: Request, env: Env & { OAUTH_PROVIDER?: OAuthHelpers }): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== "/authorize" || !env.OAUTH_PROVIDER) return new Response("Not found\n", { status: 404 });
  try {
    return await handleAuthorize(request, env, env.OAUTH_PROVIDER);
  } catch (error) {
    if (error instanceof AuthorizationError && error.redirectTo) {
      return Response.redirect(error.redirectTo, 302);
    }
    if (error instanceof AuthorizationError || error instanceof CimdFetchError) {
      const message =
        error instanceof AuthorizationError ? error.description : "This app could not be verified.";
      return htmlResponse(page("Authorization failed", `<h1>Authorization failed</h1><p>${escape(message)}</p>`), 400);
    }
    throw error;
  }
}

const providers = new Map<string, OAuthProvider<Env>>();

/** The OAuth provider for one canonical base URL, created on first use. */
export function getOAuthProvider(base: string): OAuthProvider<Env> {
  let provider = providers.get(base);
  if (!provider) {
    provider = new OAuthProvider<Env>({
      apiRoute: "/mcp",
      apiHandler: {
        fetch: (request, env, ctx) => {
          const props = (ctx as ExecutionContext & { props?: { userId?: string } }).props;
          return handleMcpRequest(request, env, `oauth:${props?.userId ?? OWNER_ID}`);
        },
      },
      defaultHandler: { fetch: (request, env) => defaultFetch(request, env) },
      authorizeEndpoint: "/authorize",
      tokenEndpoint: "/oauth/token",
      clientRegistrationEndpoint: "/oauth/register",
      scopesSupported: [SCOPE, "offline_access"],
      requiredScopes: [SCOPE],
      resourceMetadata: {
        resource: `${base}/mcp`,
        authorization_servers: [base],
        resource_name: "EMAF",
      },
    });
    providers.set(base, provider);
  }
  return provider;
}
