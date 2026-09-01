import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { parseTexFileLines } from "../lib/tex-project/tex-diagnostics";
import { discoverSkillsInDir, findAgentsMd, readSkillFile } from "../lib/research/project-skills";

describe("compile diagnostics", () => {
  it("parses file:line errors", () => {
    const hits = parseTexFileLines([
      "./sections/evaluation.tex:83: Undefined control sequence",
      "l.12 leftover",
    ]);
    assert.equal(hits[0]!.file, "evaluation.tex");
    assert.equal(hits[0]!.line, 83);
    assert.match(hits[0]!.message, /Undefined control sequence/);
  });
});

describe("project-local skills", () => {
  it("discovers SKILL.md and AGENTS.md", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "ob-skills-"));
    try {
      mkdirSync(path.join(root, "skills", "rigorous-research-agent"), { recursive: true });
      writeFileSync(path.join(root, "AGENTS.md"), "# Project instructions\nKeep the claim narrow.\n");
      writeFileSync(
        path.join(root, "skills", "rigorous-research-agent", "SKILL.md"),
        "---\nname: rigorous-research-agent\ndescription: Use for experimental conclusions.\n---\n\nInspect raw artifacts.\n",
      );
      const skills = discoverSkillsInDir(root);
      assert.equal(skills.length, 1);
      assert.equal(skills[0]!.id, "rigorous-research-agent");
      assert.equal(findAgentsMd(root)?.path, "AGENTS.md");
      const body = readSkillFile(root, "rigorous-research-agent");
      assert.match(body!.body, /Inspect raw artifacts/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
