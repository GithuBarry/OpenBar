import path from "node:path";
import { agentPermissionsPolicy } from "./lib/server/agent-origins";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const configDir = path.dirname(fileURLToPath(import.meta.url));

function distDirFromEnvironment(): string {
  const requested = process.env.OB_DIST?.trim();
  if (!requested) return ".next";
  const resolved = path.resolve(configDir, requested);
  const relative = path.relative(configDir, resolved);
  if (path.isAbsolute(requested) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error("OB_DIST must stay inside the project directory, for example .next-local.");
  }
  return relative || ".next";
}

const nextConfig: NextConfig = {
  devIndicators: false,
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "Origin-Agent-Cluster", value: "?1" },
      { key: "Link", value: '</agents>; rel="help"; title="MCP and WebMCP setup", </llms.txt>; rel="alternate"; type="text/plain"; title="OpenBar agent instructions"' },
      { key: "Permissions-Policy", value: agentPermissionsPolicy() },
    ] }];
  },
  output: "standalone",
  distDir: distDirFromEnvironment(),
  outputFileTracingRoot: configDir,
  // Content is a runtime data tree, not application code. Keep it out of NFT
  // traces so `next build` does not warn about walking manuscript files.
  // Pandoc Lua filters must ship with the server trace.
  outputFileTracingExcludes: {
    "/*": ["./content/projects/**", "./scratch/**", "./.scratch/**"],
  },
  outputFileTracingIncludes: {
    "/*": ["./lib/tex-project/pandoc-openbarry.lua"],
  },
  // Next 16 treats each browser host as a separate origin and blocks
  // /_next chunks + HMR unless listed here. Keep the stable tailnet name and
  // current tailnet address available for the long-lived private workbench.
  allowedDevOrigins: [
    "127.0.0.1",
    "127.0.2.2",
    "localhost",
    "100.64.0.1",
    "openbar.example.ts.net",
    "dev.example.ts.net",
  ],
  serverExternalPackages: [
    "file-type",
    "proper-lockfile",
    "jose",
    "@citation-js/core",
    "@citation-js/plugin-bibtex",
    "@citation-js/plugin-csl",
  ],
  experimental: {
    authInterrupts: true,
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  transpilePackages: [
    "@unified-latex/unified-latex-ctan",
    "@unified-latex/unified-latex-types",
    "@unified-latex/unified-latex-util-arguments",
    "@unified-latex/unified-latex-util-catcode",
    "@unified-latex/unified-latex-util-environments",
    "@unified-latex/unified-latex-util-match",
    "@unified-latex/unified-latex-util-parse",
    "@unified-latex/unified-latex-util-pegjs",
    "@unified-latex/unified-latex-util-print-raw",
    "@unified-latex/unified-latex-util-replace",
    "@unified-latex/unified-latex-util-scan",
    "@unified-latex/unified-latex-util-trim",
    "@unified-latex/unified-latex-util-visit",
    "@unified-latex/unified-latex-to-hast",
    "@unified-latex/unified-latex-util-html-like",
  ],
  turbopack: {
    resolveAlias: {
      fs: { browser: "./lib/empty-module.ts" },
      "node:fs": { browser: "./lib/empty-module.ts" },
      path: { browser: "./lib/empty-module.ts" },
      "node:path": { browser: "./lib/empty-module.ts" },
      module: { browser: "./lib/empty-module.ts" },
    },
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        module: false,
        canvas: false,
      };
    }
    return config;
  },
};

export default nextConfig;
