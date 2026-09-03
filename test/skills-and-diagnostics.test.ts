import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { parseTexFileLines } from "../lib/tex-project/tex-diagnostics";
import {
  discoverSkillsInDir,
  findAgentsMd,
  readSkillFile,
  writeAgentsMd,
  writeProjectSkill,
} from "../lib/research/project-skills";

describe("compile diagnostics", () => {
  it("parses file and line errors", () => {
    const hits = parseTexFileLines(["./sections/evaluation.tex:83: Undefined control sequence", "l.12 leftover"]);
    assert.equal(hits[0]!.file, "evaluation.tex");
    assert.equal(hits[0]!.line, 83);
    assert.match(hits[0]!.message, /Undefined control sequence/);
  });
});

describe("project instructions", () => {
  it("discovers skills and protects existing instruction writes with hashes", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "openbar-skills-"));
    try {
      const first = writeAgentsMd(root, "# Project instructions\nKeep the plan concrete.");
      assert.equal(findAgentsMd(root)?.path, "AGENTS.md");
      assert.throws(() => writeAgentsMd(root, "changed", "bad-hash"), /changed on disk/);
      writeAgentsMd(root, "changed", first.hash);

      const skill = writeProjectSkill(root, { id: "research-notes", name: "Research notes", body: "Inspect raw artifacts." });
      assert.equal(discoverSkillsInDir(root)[0]!.id, "research-notes");
      assert.equal(readSkillFile(root, "research-notes")?.body, "Inspect raw artifacts.");
      assert.throws(
        () => writeProjectSkill(root, { id: "research-notes", body: "overwrite" }, "bad-hash"),
        /changed on disk/,
      );
      writeProjectSkill(root, { id: "research-notes", body: "updated" }, skill.hash);
      assert.equal(readSkillFile(root, "research-notes")?.body, "updated");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
