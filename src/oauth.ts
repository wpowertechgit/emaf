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

const PAGE_STYLE = `
:root{--bg:#f4f5f7;--card:#fff;--text:#1a1d21;--muted:#5f6670;--line:#e3e6ea;--field:#fff;--accent:#2f6fde;--accent-text:#fff;--warn-bg:#fff6e0;--warn:#8a5a00;--error:#c62828}
@media (prefers-color-scheme:dark){:root{--bg:#0e1013;--card:#171a1f;--text:#e8eaed;--muted:#9aa1ab;--line:#2a2f37;--field:#0e1013;--accent:#5b8ff0;--accent-text:#0e1013;--warn-bg:#2b2410;--warn:#e6b34a;--error:#ff6b6b}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px 16px;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
.card{width:100%;max-width:380px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:28px}
.brand{font-size:12px;font-weight:700;letter-spacing:.14em;color:var(--muted);margin:0 0 18px}
h1{font-size:20px;line-height:1.3;margin:0 0 4px}
.sub{color:var(--muted);margin:0 0 20px}
dl{margin:0 0 20px;border:1px solid var(--line);border-radius:10px}
dl div{display:flex;justify-content:space-between;gap:12px;padding:10px 12px}
dl div+div{border-top:1px solid var(--line)}
dt{color:var(--muted)}dd{margin:0;font-weight:600;text-align:right;overflow-wrap:anywhere}
.tag{font-weight:500;font-size:12px;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:1px 7px;margin-left:6px}
.note{background:var(--warn-bg);color:var(--warn);border-radius:8px;padding:10px 12px;margin:0 0 20px;font-size:14px}
.error{color:var(--error);margin:0 0 14px;font-weight:600}
label{display:block;font-size:13px;color:var(--muted);margin-bottom:6px}
input[type=password]{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--field);color:var(--text);font:inherit}
input[type=password]:focus{outline:2px solid var(--accent);outline-offset:1px}
.actions{display:flex;gap:10px;margin-top:18px}
button{flex:1;padding:10px;border-radius:8px;font:inherit;font-weight:600;cursor:pointer;border:1px solid var(--line);background:transparent;color:var(--text)}
button.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-text)}
`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>${PAGE_STYLE}</style></head><body><main class="card"><p class="brand">EMAF</p>${body}</main></body></html>`;
}

function consentForm(handle: string, error = ""): string {
  return `<form method="post">
  <input type="hidden" name="handle" value="${escape(handle)}">
  ${error ? `<p class="error">${escape(error)}</p>` : ""}
  <label for="password">Owner password</label>
  <input id="password" type="password" name="password" autocomplete="current-password" required autofocus>
  <div class="actions">
    <button name="decision" value="deny" formnovalidate>Deny</button>
    <button class="primary" name="decision" value="approve">Allow</button>
  </div>
</form>`;
}

/** Renders the consent page; every value from the client is escaped, since an attacker chooses it. */
export function consentPage(details: ConsentDescription, handle: string): string {
  const name = escape(details.clientName);
  const app = details.clientDomain
    ? `${name}<span class="tag">${escape(details.clientDomain)}</span>`
    : `${name}<span class="tag" title="The app registered itself; its name is not verified.">unverified</span>`;
  const loopback = details.redirectIsLoopback
    ? '<p class="note">Access goes to an app on this computer. Continue only if you just started connecting from it.</p>'
    : "";
  return page(
    `Connect ${details.clientName}`,
    `<h1>Connect ${name}</h1>
<p class="sub">It will be able to use all EMAF tools.</p>
<dl>
  <div><dt>App</dt><dd>${app}</dd></div>
  <div><dt>Access goes to</dt><dd>${escape(details.redirectHost)}</dd></div>
</dl>
${loopback}
${consentForm(handle)}`,
  );
}

/** A card with a heading and one short message, for errors outside the consent form. */
function messagePage(title: string, message: string): string {
  return page(title, `<h1>${escape(title)}</h1><p class="sub">${escape(message)}</p>`);
}

function htmlResponse(html: string, status: number, headers = new Headers()): Response {
  headers.set("Content-Type", "text/html; charset=utf-8");
  // No form-action: browsers apply it to the redirect back to the client after the form is posted.
  headers.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
  headers.set("X-Frame-Options", "DENY");
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
    return htmlResponse(
      page("Too many attempts", `<h1>Slow down</h1>${consentForm(handle, "Too many attempts. Wait a minute, then try again.")}`),
      429,
    );
  }
  if (!(await passwordMatches(env, String(form.get("password") ?? "")))) {
    // The handle is not consumed, so the owner can retry from the same page.
    return htmlResponse(page("Wrong password", `<h1>Try again</h1>${consentForm(handle, "Wrong password.")}`), 401);
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
      return htmlResponse(messagePage("Could not connect", `${message.replace(/[.\s]+$/, "")}. Go back to Claude and connect again.`), 400);
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
