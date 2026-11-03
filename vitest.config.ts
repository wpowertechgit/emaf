import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Tests build their own Env and must never pick up local secrets from .env.
process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = "false";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      // Tests pass their own fake bindings; never connect to Cloudflare (CI has no credentials).
      remoteBindings: false,
      // Real KV storage for the OAuth tests; production binds OAUTH_KV in wrangler.toml.
      miniflare: { kvNamespaces: ["TEST_OAUTH_KV"] },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
  },
});
