/** An error whose message is safe to return to the MCP client as-is. */
export class ToolError extends Error {}

export function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(Math.max(n, min), max);
}

export function requireHttpUrl(value: unknown): URL {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ToolError("`url` must be a non-empty string.");
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ToolError(`Invalid URL: ${value}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ToolError("Only http and https URLs are supported.");
  }
  return url;
}

export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[... truncated, ${text.length - maxChars} more characters]`;
}

export function normalizeUrl(href: string, base: string): string | null {
  try {
    const url = new URL(href, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
