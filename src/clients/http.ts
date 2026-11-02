import { API_TIMEOUT_MS, API_USER_AGENT } from "../config";
import type { Budget } from "../budget";
import { ToolError } from "../util";

/** An external API call failed. The message names the service and is safe to show. */
export class ApiError extends ToolError {
  constructor(
    readonly service: string,
    message: string,
    readonly status?: number,
  ) {
    super(`${service}: ${message}`);
  }
}

export interface ApiRequestOptions {
  /** Service name used in error messages, for example "GitHub". */
  service: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Return null instead of throwing on HTTP 404. */
  allowNotFound?: boolean;
  /** Extra explanation appended to rate-limit errors. */
  rateLimitHint?: string;
}

async function request(budget: Budget, url: string, options: ApiRequestOptions): Promise<Response | null> {
  const timeoutMs = options.timeoutMs ?? API_TIMEOUT_MS;
  let response: Response;
  try {
    response = await budget.fetch(url, {
      headers: { "User-Agent": API_USER_AGENT, ...options.headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err instanceof ToolError) throw err;
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new ApiError(options.service, `request timed out after ${Math.round(timeoutMs / 1000)}s.`);
    }
    throw new ApiError(options.service, `request failed (${err instanceof Error ? err.message : String(err)}).`);
  }

  if (response.status === 404 && options.allowNotFound) {
    await response.body?.cancel();
    return null;
  }
  if (!response.ok) {
    const rateLimited =
      response.status === 429 ||
      (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0");
    await response.body?.cancel();
    if (rateLimited) {
      throw new ApiError(
        options.service,
        `rate limit reached (HTTP ${response.status}).${options.rateLimitHint ? ` ${options.rateLimitHint}` : ""}`,
        response.status,
      );
    }
    throw new ApiError(options.service, `HTTP ${response.status}.`, response.status);
  }
  return response;
}

export async function getJson<T>(budget: Budget, url: string, options: ApiRequestOptions): Promise<T> {
  const response = await request(budget, url, options);
  if (!response) throw new ApiError(options.service, "not found.", 404);
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError(options.service, "returned invalid JSON.");
  }
}

/** Like getJson, but resolves to null on HTTP 404. */
export async function getJsonOrNull<T>(budget: Budget, url: string, options: ApiRequestOptions): Promise<T | null> {
  const response = await request(budget, url, { ...options, allowNotFound: true });
  if (!response) return null;
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError(options.service, "returned invalid JSON.");
  }
}

export async function getText(budget: Budget, url: string, options: ApiRequestOptions): Promise<string | null> {
  const response = await request(budget, url, options);
  return response ? response.text() : null;
}
