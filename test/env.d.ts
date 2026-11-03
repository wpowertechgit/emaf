declare namespace Cloudflare {
  interface Env {
    /** KV namespace provided by the Vitest pool for OAuth tests. */
    TEST_OAUTH_KV: KVNamespace;
  }
}
