import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = process.cwd();

test("private demo home names both real published papers", () => {
  const home = fs.readFileSync(path.join(root, "app", "page.tsx"), "utf8");
  const notice = fs.readFileSync(path.join(root, "components", "demo", "public-demo-notice.tsx"), "utf8");
  assert.match(home, /<PublicDemoNotice \/>/);
  assert.match(notice, /Command-V and NoveltyBench/);
});

test("private demo UI keeps identity and administration read-only", () => {
  const home = fs.readFileSync(path.join(root, "app", "page.tsx"), "utf8");
  const sidebar = fs.readFileSync(path.join(root, "components", "shell", "sidebar.tsx"), "utf8");
  assert.match(home, /readOnly=\{publicDemo\}/);
  assert.match(home, /publicDemo \? <ResetDemoButton/);
  assert.match(sidebar, /allowCreate=\{!publicDemo\}/);
  assert.match(sidebar, /!publicDemo/);
});
