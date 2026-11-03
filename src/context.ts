import type { Budget } from "./budget";
import type { Env } from "./env";

/** Per-invocation state shared by every tool call in one HTTP request. */
export interface ToolContext {
  env: Env;
  budget: Budget;
  /** Rate limit key for the caller; tool calls are not rate limited when absent. */
  rateLimitKey?: string;
}
