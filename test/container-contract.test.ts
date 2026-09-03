import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = process.cwd();

test("container package includes the standalone app, TeX tools, and published papers", () => {
  const dockerfile = fs.readFileSync(path.join(root, "deploy", "openbar.Dockerfile"), "utf8");
  for (const line of [
    "COPY --from=builder /app/.next/standalone ./",
    "COPY --from=builder /app/.next/static ./.next/static",
    "latexmk",
    "pdflatex",
    "latexpand",
    "pandoc",
    "COPY examples/published-papers /opt/openbar-seed/published-papers",
    "ENV OPENBAR_DEMO_SLUGS=command-v,noveltybench",
    "USER nextjs",
  ]) assert.match(dockerfile, new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("container startup seeds only the configured published projects", () => {
  const startup = fs.readFileSync(path.join(root, "deploy", "start-openbar.sh"), "utf8");
  assert.match(startup, /OPENBAR_DEMO_SLUGS/);
  assert.match(startup, /OPENBAR_DEMO_FIXTURE/);
  assert.match(startup, /fixture\/\$demo_slug/);
  assert.match(startup, /exec node server\.js/);
});
