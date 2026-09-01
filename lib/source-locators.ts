import fs from "node:fs";
import path from "node:path";

import type { SourceManifestEntry } from "./types";

export type SourceLocator =
  | { type: "localPath"; path: string; lineStart?: number; lineCount?: number }
  | { type: "overleafGitPath"; repoPath: string; filePath: string; commit?: string; lineStart?: number; lineCount?: number }
  | { type: "wandbArtifactUri"; uri: string; runId?: string; artifact?: string; table?: string; version?: string; rowFilter?: string }
  | { type: "googleDoc"; url: string; docId?: string; heading?: string; revision?: string }
  | { type: "googleSlide"; url: string; deckId?: string; slideId?: string; revision?: string }
  | { type: "driveFile"; url: string; fileId?: string; pathHint?: string; revision?: string };

export interface ResolvedSourceLocator {
  sourceId: string;
  label: string;
  uri: string;
  locator?: SourceLocator;
  canReadLocally: boolean;
  localPath?: string;
  readInstruction: string;
  selectedExcerpt?: string;
}

export function sourceLocator(entry: SourceManifestEntry): SourceLocator | undefined {
  const locator = entry.metadata?.locator;
  if (!locator || typeof locator !== "object") return inferLocator(entry);
  const type = (locator as { type?: unknown }).type;
  if (type === "localPath" && typeof (locator as { path?: unknown }).path === "string") return locator as SourceLocator;
  if (type === "overleafGitPath" && typeof (locator as { repoPath?: unknown }).repoPath === "string" && typeof (locator as { filePath?: unknown }).filePath === "string") return locator as SourceLocator;
  if (type === "wandbArtifactUri" && typeof (locator as { uri?: unknown }).uri === "string") return locator as SourceLocator;
  if (type === "googleDoc" && typeof (locator as { url?: unknown }).url === "string") return locator as SourceLocator;
  if (type === "googleSlide" && typeof (locator as { url?: unknown }).url === "string") return locator as SourceLocator;
  if (type === "driveFile" && typeof (locator as { url?: unknown }).url === "string") return locator as SourceLocator;
  return inferLocator(entry);
}

export function resolveSourceLocator(entry: SourceManifestEntry): ResolvedSourceLocator {
  const locator = sourceLocator(entry);
  const localPath = localPathFor(entry, locator);
  const canReadLocally = Boolean(localPath && existsFile(localPath));
  return {
    sourceId: entry.id,
    label: entry.label,
    uri: entry.uri,
    locator,
    canReadLocally,
    localPath,
    readInstruction: instructionFor(entry, locator, canReadLocally, localPath),
    selectedExcerpt: entry.selectedExcerpt,
  };
}

export function renderResolvedSourceMarkdown(resolved: ResolvedSourceLocator): string {
  const locator = resolved.locator ? JSON.stringify(resolved.locator, null, 2) : "not recorded";
  return [
    `# Source: ${resolved.label}`,
    "",
    `- id: ${resolved.sourceId}`,
    `- uri: ${resolved.uri}`,
    `- local readable: ${resolved.canReadLocally ? "yes" : "no"}`,
    resolved.localPath ? `- local path: ${resolved.localPath}` : undefined,
    "",
    "## Locator",
    "",
    "```json",
    locator,
    "```",
    "",
    "## How to inspect",
    "",
    resolved.readInstruction,
    resolved.selectedExcerpt ? `\n## Selected excerpt\n\n\`\`\`\n${resolved.selectedExcerpt}\n\`\`\`` : undefined,
  ].filter((part): part is string => Boolean(part)).join("\n");
}

function inferLocator(entry: SourceManifestEntry): SourceLocator | undefined {
  if (entry.kind === "local") return { type: "localPath", path: entry.uri };
  if (entry.kind === "overleaf") {
    if (entry.uri.startsWith("https://git.overleaf.com/")) return { type: "overleafGitPath", repoPath: entry.uri, filePath: "main.tex" };
    return { type: "overleafGitPath", repoPath: entry.uri, filePath: "main.tex" };
  }
  if (entry.kind === "wandb") return { type: "wandbArtifactUri", uri: entry.uri };
  if (entry.kind === "google-doc") return { type: "googleDoc", url: entry.uri };
  if (entry.kind === "google-slide") return { type: "googleSlide", url: entry.uri };
  if (entry.kind === "drive") return { type: "driveFile", url: entry.uri };
  return undefined;
}

function localPathFor(entry: SourceManifestEntry, locator?: SourceLocator): string | undefined {
  if (!locator) return entry.kind === "local" ? entry.uri : undefined;
  if (locator.type === "localPath") return locator.path;
  if (locator.type === "overleafGitPath") return path.join(locator.repoPath, locator.filePath);
  if (locator.type === "driveFile" && locator.pathHint) return locator.pathHint;
  return entry.kind === "local" ? entry.uri : undefined;
}

function instructionFor(entry: SourceManifestEntry, locator: SourceLocator | undefined, canReadLocally: boolean, localPath?: string): string {
  if (canReadLocally && localPath) return `Read local file at ${localPath}. Use anchors or line ranges from the source manifest before summarizing.`;
  if (!locator) return "No typed locator recorded. Use the URI as a pointer and add locator metadata before relying on this source.";
  if (locator.type === "localPath") return `Local file is expected at ${locator.path}, but it is not currently readable from this server.`;
  if (locator.type === "overleafGitPath") return `Clone or update the Overleaf Git mirror, then read ${locator.filePath}${locator.commit ? ` at commit ${locator.commit}` : ""}. Keep Overleaf authoritative.`;
  if (locator.type === "wandbArtifactUri") return `Fetch the W&B artifact/table by URI ${locator.uri}${locator.table ? `, table ${locator.table}` : ""}. Store only selected rows, anchors, and digest in OpenBar.`;
  if (locator.type === "googleDoc") return `Export or inspect the Google Doc at ${locator.url}${locator.heading ? ` near heading ${locator.heading}` : ""}. Store only selected excerpt and anchors.`;
  if (locator.type === "googleSlide") return `Inspect the Google Slides deck at ${locator.url}${locator.slideId ? ` slide ${locator.slideId}` : ""}. Link or export only the needed slide text/image.`;
  return `Inspect the Drive file at ${locator.url}. Store only selected excerpt, hash, and anchors.`;
}

function existsFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}
