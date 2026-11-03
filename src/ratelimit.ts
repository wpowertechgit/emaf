import type { Env } from "./env";

/** Default for the in-memory fallback when no RATE_LIMITER binding is configured. */
export const DEFAULT_TOOL_CALLS_PER_MINUTE = 60;
const WINDOW_MS = 60_000;

/** Fixed one-minute windows per key, local to this isolate. */
const windows = new Map<string, { start: number; count: number }>();

/** Clears the in-memory windows. Used by tests. */
export function resetRateLimitState(): void {
  windows.clear();
}

/** Derives a rate limit key from the secret without exposing the secret itself. */
export async function rateLimitKey(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const hex = Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
  return `mcp:${hex}`;
}

function perMinuteLimit(env: Env): number {
  const raw = env.RATE_LIMIT_PER_MINUTE;
  if (raw === undefined || raw.trim() === "") return DEFAULT_TOOL_CALLS_PER_MINUTE;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_TOOL_CALLS_PER_MINUTE;
}

function allowInMemory(key: string, limit: number, now: number): boolean {
  const current = windows.get(key);
  if (!current || now - current.start >= WINDOW_MS) {
    windows.set(key, { start: now, count: 1 });
    return limit >= 1;
  }
  if (current.count >= limit) return false;
  current.count++;
  return true;
}

/**
 * Decides whether one more tool call is allowed for `key`. Uses the Workers
 * Rate Limiting binding when configured (approximate, per Cloudflare
 * location); otherwise an in-memory window per isolate, which is a best-effort
 * guard rather than a global limit. RATE_LIMIT_PER_MINUTE=0 disables the
 * fallback. A failing binding allows the call, so an outage never blocks use.
 */
export async function allowToolCall(env: Env, key: string, now = Date.now()): Promise<boolean> {
  if (env.RATE_LIMITER) {
    try {
      const { success } = await env.RATE_LIMITER.limit({ key });
      return success;
    } catch {
      return true;
    }
  }
  const limit = perMinuteLimit(env);
  if (limit === 0) return true;
  return allowInMemory(key, limit, now);
}
