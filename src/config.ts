export const SERVER_INFO = { name: "emaf", version: "1.1.0" };
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
export const DEFAULT_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
/** Identifies EMAF to public APIs (GitHub requires a User-Agent; PyPI and arXiv ask for one). */
export const API_USER_AGENT = "emaf/1.1 (self-hosted MCP research server)";
export const FETCH_TIMEOUT_MS = 20_000;
export const API_TIMEOUT_MS = 15_000;

/**
 * Workers Free allows 50 external subrequests per invocation. Redirects may
 * also count, so keep headroom.
 */
export const SUBREQUEST_BUDGET = 45;

/** Workers Free allows 1,000 subrequests to Cloudflare services (KV, Workers AI) per invocation. */
export const INTERNAL_SUBREQUEST_BUDGET = 900;

// Crawl stays below the budget so a crawl never fails on accounting alone.
export const MAX_CRAWL_PAGES = 40;
export const CRAWL_CONCURRENCY = 5;

export const SKIP_EXTENSIONS =
  /\.(?:pdf|zip|gz|tar|rar|7z|exe|dmg|msi|jpg|jpeg|png|gif|webp|svg|ico|bmp|tiff|mp3|mp4|mov|avi|webm|wav|ogg|woff2?|ttf|eot|css|js|json|xml|rss|atom)(?:$|\?)/i;

/** Workers AI text embedding model used for the optional rerank stage. */
export const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
