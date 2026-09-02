import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { PROJECT_WEBMCP_TOOL_NAMES } from "../lib/research/mcp-tool-schemas";
import { buildWorkspaceWebMcpTools } from "../lib/research/webmcp-workspace-contract";

test("project WebMCP stays focused on project context", () => {
  assert.deepEqual(PROJECT_WEBMCP_TOOL_NAMES, [
    "get_project_state",
    "search_project",
    "navigate_project",
    "update_project",
  ]);
});

test("workspace WebMCP lists, searches, and opens projects", async () => {
  let navigated = "";
  const tools = buildWorkspaceWebMcpTools({
    actions: {
      listProjects: async () => [{ slug: "dense-retrieval", title: "Dense retrieval under load", href: "/p/dense-retrieval/paper" }],
      searchProjects: async (query) => [{ slug: query, title: query, href: `/p/${query}/paper` }],
      openProject: async (slug) => ({ slug, title: slug, href: `/p/${slug}/paper` }),
    },
    navigate: (href) => { navigated = href; },
  });
  assert.deepEqual(tools.map((tool) => tool.name), ["list_projects", "search_projects", "open_project"]);
  const open = tools.find((tool) => tool.name === "open_project");
  assert.ok(open);
  const result = await open.execute({ slug: "dense-retrieval" }) as { ok?: boolean };
  assert.equal(navigated, "/p/dense-retrieval/paper");
  assert.equal(result.ok, true);
});

test("HTTP MCP files and dependency are removed", () => {
  for (const relative of ["app/api/mcp/route.ts", "mcp/server.ts", "scripts/mcp-call.ts", "scripts/webmcp-demo.ts", "lib/server/mcp-access.ts"]) {
    assert.equal(fs.existsSync(path.join(process.cwd(), relative)), false, relative);
  }
  const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
  assert.equal(packageJson.dependencies?.["@modelcontextprotocol/sdk"], undefined);
  for (const name of ["mcp", "mcp:http", "mcp:stdio", "mcp:call", "demo:webmcp"]) {
    assert.equal(packageJson.scripts?.[name], undefined, name);
  }
});
