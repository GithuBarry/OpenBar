import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { persistSourceBundle } from "../lib/tex-project/source-persist";
import { buildSourceBundle } from "../lib/tex-project/source-bundle";
import { texPaths, writePaperProject } from "../lib/tex-project/project";

describe("source persistence", () => {
  it("accepts a matching hash write and rejects a stale hash", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "ob-persist-"));
    try {
      writePaperProject(root, "Reconstruction", [
        {
          id: "introduction",
          title: "Introduction",
          level: 2,
          order: 0,
          label: "sec-introduction",
          tex: "Hello world.",
        },
        {
          id: "evaluation",
          title: "Evaluation",
          level: 2,
          order: 1,
          label: "sec-evaluation",
          tex: "Keep this evaluation paragraph.",
        },
      ]);
      const manuscriptDir = texPaths(root).manuscriptDir;
      const evalFile = path.join(manuscriptDir, "sections", "01-evaluation.tex");
      const evalBefore = readFileSync(evalFile);
      const bundle = buildSourceBundle(manuscriptDir);
      assert.match(bundle.source, /Hello world\./);

      const stale = persistSourceBundle({
        manuscriptDir,
        nextSource: bundle.source.replace("Hello world.", "Hello again."),
        expectedBundleHash: "not-the-current-hash",
      });
      assert.equal(stale.ok, false);
      if (!stale.ok) assert.equal(stale.code, "stale_disk_state");
      assert.equal(readFileSync(evalFile).equals(evalBefore), true);

      const ok = persistSourceBundle({
        manuscriptDir,
        nextSource: bundle.source.replace("Hello world.", "Hello again."),
        expectedBundleHash: bundle.bundleHash,
      });
      assert.equal(ok.ok, true);
      assert.match(buildSourceBundle(manuscriptDir).source, /Hello again\./);
      assert.equal(readFileSync(evalFile).equals(evalBefore), true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
