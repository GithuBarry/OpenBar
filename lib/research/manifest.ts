/**
 * openbarry/project@2 comment-only project metadata.
 *
 * Existing repositories stay on openbarry/project@1 until an inspected
 * migration plan is applied.
 */

import { createHash } from "node:crypto";

export const PROJECT_MANIFEST_V2 = "openbarry/project@2";
export const DOCUMENT_MANIFEST_V2 = "openbarry/document@2";

export type DocumentFormat = "tex" | "markdown" | "html";
export type HtmlMode = "static" | "interactive";

export type ManagedRegion = {
  id: string;
  filePath: string;
  kind: "edit-block" | "heading" | "include" | "metadata";
};

export type DocumentManifestV2 = {
  id: string;
  kind: "paper" | "wiki" | "note" | "agenda" | "custom";
  title: string;
  format: DocumentFormat;
  bodyPath?: string;
  htmlMode?: HtmlMode;
  bodyHash: string;
  revision: number;
};

export type ProjectManifestV2 = {
  schema: typeof PROJECT_MANIFEST_V2;
  rootFile: string;
  documentRoots: string[];
  assetRoots: string[];
  managedRegions: ManagedRegion[];
  documents: DocumentManifestV2[];
  researchKind?: string;
  capabilities: string[];
};

export type MigrationPlan = {
  id: string;
  projectId: string;
  expectedRepositoryHash: string;
  fromSchema: string;
  toSchema: string;
  proposedRootFile: string;
  proposedAssetRoots: string[];
  warnings: string[];
  createdAt: string;
};

export const DEFAULT_ASSET_ROOTS = ["figures", "figure_candidates"];
export const DEFAULT_DOCUMENT_ROOTS = ["sections", "wiki", "notes", "slides", "openbarry"];

export function defaultProjectManifest(rootFile = "paper.tex"): ProjectManifestV2 {
  return {
    schema: PROJECT_MANIFEST_V2,
    rootFile,
    documentRoots: [...DEFAULT_DOCUMENT_ROOTS],
    assetRoots: [...DEFAULT_ASSET_ROOTS],
    managedRegions: [],
    documents: [],
    capabilities: ["tex", "mindmap", "wiki"],
  };
}

export function repositoryHash(files: Array<{ path: string; bytes: string | Buffer }>): string {
  const hash = createHash("sha256");
  for (const file of files.slice().sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(file.bytes);
    hash.update("\n");
  }
  return hash.digest("hex");
}

export function isProjectManifestV2(value: unknown): value is ProjectManifestV2 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.schema === PROJECT_MANIFEST_V2 && typeof record.rootFile === "string";
}
