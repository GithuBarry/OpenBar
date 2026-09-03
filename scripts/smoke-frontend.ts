#!/usr/bin/env npx tsx
/**
 * HTTP smoke for public routes plus health, conversion-adjacent JSON, and
 * asset isolation. Playwright is not a dependency; this fetches a live
 * `pnpm dev` server.
 *
 *   pnpm dev
 *   pnpm smoke
 */
import { fetchWithRetry } from "./smoke-http";

const base = process.env.OB_SMOKE_BASE || "http://127.0.0.1:3000";
const slugs = (process.env.OB_SMOKE_SLUGS || process.env.OB_SMOKE_SLUG || "command-v,noveltybench")
  .split(",")
  .map((slug) => slug.trim())
  .filter(Boolean);
if (!slugs.length) throw new Error("OB_SMOKE_SLUGS must contain at least one project slug.");
const routes = [
  "/",
  "/about",
  ...slugs.flatMap((slug) => [`/p/${slug}/paper`, `/p/${slug}/mindmap`, `/p/${slug}/wiki`]),
];
const themes = ["paper", "dark"];

async function check(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: string }> {
  const response = await fetchWithRetry(url, init);
  const body = await response.text();
  return { ok: response.ok, status: response.status, body };
}

async function main() {
  const failures: string[] = [];
  for (const theme of themes) {
    for (const route of routes) {
      const url = `${base}${route}`;
      try {
        const response = await fetchWithRetry(url, { headers: { cookie: `ob-theme=${theme}` } });
        if (!response.ok) failures.push(`${theme} ${route} → ${response.status}`);
      } catch (error) {
        failures.push(`${theme} ${route} → ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  try {
    const health = await check(`${base}/api/health`);
    if (!health.ok) failures.push(`health → ${health.status}`);
    else {
      const json = JSON.parse(health.body) as Record<string, unknown>;
      if (json.ok !== true) failures.push("health payload missing ok");
      const blob = health.body.toLowerCase();
      if (blob.includes("password") || blob.includes("secret=") || blob.includes("cloudflare_access_aud")) {
        failures.push("health leaked a secret");
      }
      const tools = json.tools as Record<string, unknown> | undefined;
      if (!tools || typeof tools.latexpand !== "boolean") failures.push("health missing latexpand");
      if (process.env.OB_EXPECT_PUBLIC_DEMO === "1") {
        if (json.mode !== "public-demo") failures.push(`health mode → ${String(json.mode)}`);
        const demoSlugs = json.demoSlugs as unknown;
        if (!Array.isArray(demoSlugs) || slugs.some((slug) => !demoSlugs.includes(slug))) {
          failures.push("health missing configured demo slugs");
        }
      }
    }
  } catch (error) {
    failures.push(`health → ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const traversal = await check(`${base}/api/p/${slugs[0]}/asset/../package.json`);
    if (traversal.status !== 404) failures.push(`asset traversal → ${traversal.status}`);
    const protocol = await check(`${base}/api/p/${slugs[0]}/asset/${encodeURIComponent("//evil.test/x.png")}`);
    if (protocol.ok) failures.push("protocol-relative asset resolved");
  } catch (error) {
    failures.push(`asset isolation → ${error instanceof Error ? error.message : String(error)}`);
  }

  if (failures.length) {
    console.error(`Frontend smoke failed against ${base}:\n${failures.map((line) => `- ${line}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`Frontend smoke ok: ${routes.length} routes × ${themes.length} themes + health/assets at ${base}`);
}

void main();
