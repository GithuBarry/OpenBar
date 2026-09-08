#!/usr/bin/env npx tsx

import { fetchWithRetry } from "./smoke-http";

const base = process.env.OB_SMOKE_BASE || "http://127.0.0.1:3000";
const slugs = (process.env.OB_SMOKE_SLUGS || "private-project-a,private-project-b").split(",").map((slug) => slug.trim()).filter(Boolean);
if (slugs.length !== 2) throw new Error("Public demo state smoke expects two configured projects.");

async function get(pathname: string): Promise<{ response: Response; body: string }> {
  const response = await fetchWithRetry(`${base}${pathname}`);
  return { response, body: await response.text() };
}

async function main() {
  const failures: string[] = [];
  const expectStatus = async (pathname: string, status: number, label: string) => {
    try {
      const { response } = await get(pathname);
      if (response.status !== status) failures.push(`${label} → ${response.status}`);
    } catch (error) {
      failures.push(`${label} → ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  for (const slug of slugs) {
    try {
      const paper = await get(`/p/${slug}/paper`);
      if (!paper.response.ok || !paper.body.includes(`/p/${slug}/mindmap`)) {
        failures.push(`${slug} paper did not load the real paper`);
      }
      const map = await get(`/p/${slug}/mindmap`);
      if (!map.response.ok || !map.body.includes(`/p/${slug}/paper`)) {
        failures.push(`${slug} mindmap did not load the real map`);
      }
    } catch (error) {
      failures.push(`${slug} routes → ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  try {
    const health = await get("/api/health");
    const json = JSON.parse(health.body) as Record<string, unknown>;
    const demoSlugs = json.demoSlugs as unknown;
    if (!health.response.ok || json.mode !== "public-demo" || !Array.isArray(demoSlugs)
      || slugs.some((slug) => !demoSlugs.includes(slug))) {
      failures.push("health did not describe the configured two-project private demo");
    }
  } catch (error) {
    failures.push(`health → ${error instanceof Error ? error.message : String(error)}`);
  }

  const origin = new URL(base).origin;
  try {
    const crossSite = await fetchWithRetry(`${base}/api/demo/reset`, {
      method: "POST",
      headers: { origin: "https://evil.example.test", "sec-fetch-site": "cross-site" },
    });
    if (crossSite.status !== 403) failures.push(`cross-site reset → ${crossSite.status}`);
  } catch (error) {
    failures.push(`cross-site reset → ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const sameOrigin = await fetchWithRetry(`${base}/api/demo/reset`, {
      method: "POST",
      headers: { origin, "sec-fetch-site": "same-origin" },
    });
    const payload = await sameOrigin.json().catch(() => ({})) as { ok?: boolean; slugs?: unknown };
    if (sameOrigin.status !== 200 || payload.ok !== true || !Array.isArray(payload.slugs)
      || slugs.some((slug) => !payload.slugs?.includes(slug))) {
      failures.push(`same-origin reset → ${sameOrigin.status}`);
    }
  } catch (error) {
    failures.push(`same-origin reset → ${error instanceof Error ? error.message : String(error)}`);
  }

  for (const slug of slugs) {
    await expectStatus(`/p/${slug}/paper`, 200, `${slug} after reset`);
  }
  await expectStatus("/p/not-the-demo/paper", 404, "unknown project");
  await expectStatus(`/p/${slugs[0]}/instructions`, 404, "instructions page");

  try {
    const home = await get("/");
    if (!home.response.ok || slugs.some((slug) => !home.body.includes(`/p/${slug}/paper`)) || home.body.includes("New project")) {
      failures.push("home did not show both projects with administration hidden");
    }
  } catch (error) {
    failures.push(`home → ${error instanceof Error ? error.message : String(error)}`);
  }

  if (failures.length) {
    console.error(`Public demo state smoke failed against ${base}:\n${failures.map((line) => `- ${line}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`Public demo state smoke ok at ${base}`);
}

void main();
