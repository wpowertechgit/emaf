/** The subset of the Workers AI binding that EMAF uses. */
export interface AiBinding {
  run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
}

export interface Env {
  /** Secret path segment of the MCP endpoint (/mcp/<MCP_SECRET>). Required. */
  MCP_SECRET?: string;
  /** Enables Brave Search for web search. Optional. */
  BRAVE_API_KEY?: string;
  /** Read-only GitHub token: higher rate limits and code search for prior_art. Optional. */
  GITHUB_TOKEN?: string;
  /** OpenAlex API key: raises the daily OpenAlex budget. Optional. */
  OPENALEX_API_KEY?: string;
  /** Contact address sent to OpenAlex as `mailto`. Optional. */
  OPENALEX_MAILTO?: string;
  /** Cloudflare Browser Rendering binding, used by scrape when render=true. Optional. */
  BROWSER?: Fetcher;
  /** Workers AI binding, enables embedding rerank in research. Optional. */
  AI?: AiBinding;
}
