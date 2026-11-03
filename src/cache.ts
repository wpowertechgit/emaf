import type { Budget } from "./budget";
import type { KvBinding } from "./env";

/** KV rejects expirationTtl values below 60 seconds. */
export const MIN_CACHE_TTL = 60;
export const MAX_CACHE_TTL = 30 * 24 * 60 * 60;

interface CachedEntry {
  output: string;
  cachedAt: string;
}

export async function cacheKey(kind: string, parts: Record<string, unknown>): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify([kind, parts]));
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${kind}:${hex}`;
}

/**
 * Reads a cached entry. KV operations count as subrequests, so the read is
 * skipped when the budget cannot cover it. Cache failures never fail a tool.
 */
export async function cacheGet(kv: KvBinding, budget: Budget, key: string): Promise<CachedEntry | null> {
  if (!budget.tryTakeInternal()) return null;
  try {
    const raw = await kv.get(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as Partial<CachedEntry>;
    return typeof entry.output === "string" && typeof entry.cachedAt === "string"
      ? { output: entry.output, cachedAt: entry.cachedAt }
      : null;
  } catch {
    return null;
  }
}

export async function cachePut(kv: KvBinding, budget: Budget, key: string, output: string, ttl: number): Promise<void> {
  if (!budget.tryTakeInternal()) return;
  const entry: CachedEntry = { output, cachedAt: new Date().toISOString() };
  try {
    await kv.put(key, JSON.stringify(entry), {
      expirationTtl: Math.min(Math.max(ttl, MIN_CACHE_TTL), MAX_CACHE_TTL),
    });
  } catch {
    // A failed write only costs a future cache miss.
  }
}
