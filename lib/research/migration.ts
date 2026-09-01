/**
 * Inspected openbarry/project@2 migration. Apply requires the plan id,
 * expected repository hash, and explicit confirmation.
 */

import fs from "node:fs";
import path from "node:path";

import {
  DEFAULT_ASSET_ROOTS,
  DEFAULT_DOCUMENT_ROOTS,
  PROJECT_MANIFEST_V2,
  defaultProjectManifest,
  repositoryHash,
  type MigrationPlan,
  type ProjectManifestV2,
} from "./manifest";
import { failResult, okResult, type OperationResult } from "./operation-result";
import { inspectRepository, traverseInputGraph } from "@/lib/tex-project/source-graph";
import { upsertDataBlock, withWriteLock, writeTextAtomic } from "@/lib/tex-project/codec";

const plans = new Map<string, MigrationPlan>();

function projectRecordFile(manuscriptDir: string): string {
  return path.join(manuscriptDir, "openbarry", "project.tex");
}

export function planRepositoryMigration(manuscriptDir: string, projectId: string): MigrationPlan {
  const graph = traverseInputGraph(manuscriptDir);
  const inspection = inspectRepository(manuscriptDir);
  const files = graph.nodes.map((node) => ({ path: node.filePath, bytes: node.source }));
  const plan: MigrationPlan = {
    id: `mig-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    projectId,
    expectedRepositoryHash: repositoryHash(files),
    fromSchema: "openbarry/project@1",
    toSchema: PROJECT_MANIFEST_V2,
    proposedRootFile: graph.rootFile || "paper.tex",
    proposedAssetRoots: [...DEFAULT_ASSET_ROOTS],
    warnings: [
      ...inspection.diagnostics.map((item) => item.message),
      "Approval comes from the human or controlling agent. Apply does not rewrite paper.tex or style files.",
    ],
    createdAt: new Date().toISOString(),
  };
  plans.set(plan.id, plan);
  return plan;
}

export function getMigrationPlan(id: string): MigrationPlan | undefined {
  return plans.get(id);
}

export function applyRepositoryMigration(
  manuscriptDir: string,
  input: { planId: string; expectedRepositoryHash: string; confirm: boolean },
): OperationResult<ProjectManifestV2> {
  if (!input.confirm) {
    return failResult("invalid_arguments", "Migration apply requires explicit confirm=true from the human or controlling agent.", false);
  }
  const plan = plans.get(input.planId);
  if (!plan) return failResult("invalid_arguments", `Unknown migration plan "${input.planId}".`, false);
  const graph = traverseInputGraph(manuscriptDir);
  const currentHash = repositoryHash(graph.nodes.map((node) => ({ path: node.filePath, bytes: node.source })));
  if (currentHash !== input.expectedRepositoryHash || currentHash !== plan.expectedRepositoryHash) {
    return failResult("stale_disk_state", "Repository hash does not match the inspected migration plan.", {
      retryable: true,
      currentHash,
      conflict: { currentRevision: 0, currentHash, refresh: "reload_project" },
    });
  }
  const manifest = defaultProjectManifest(plan.proposedRootFile);
  manifest.researchKind = plan.projectId;
  manifest.documentRoots = [...DEFAULT_DOCUMENT_ROOTS];
  manifest.assetRoots = plan.proposedAssetRoots;
  const file = projectRecordFile(manuscriptDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, "% OpenBar project record.\n");
  return withWriteLock(file, () => {
    const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    const next = upsertDataBlock(current, PROJECT_MANIFEST_V2, "manifest", manifest, "OpenBar project@2 manifest. LaTeX ignores this comment block.");
    writeTextAtomic(file, next);
    return okResult(manifest, { diskHash: currentHash });
  });
}
