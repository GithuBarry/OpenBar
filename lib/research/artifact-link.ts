/**
 * Generic artifact deep links. Project-neutral: no embedded section names.
 */

import type { ArtifactKind, ArtifactRef } from "@/lib/types";
import { safeUrl } from "@/lib/safe-url";

export function artifactHref(projectId: string, ref: Pick<ArtifactRef, "kind" | "id" | "url">): string {
  if (ref.kind === "web" || ref.kind === "external") {
    const external = safeUrl(ref.url || ref.id);
    if (external) return external;
  }
  const base = `/p/${encodeURIComponent(projectId)}`;
  switch (ref.kind) {
    case "project":
      return base;
    case "draft-section":
    case "draft-claim":
    case "draft-todo":
      return `${base}/paper#${encodeURIComponent(ref.id)}`;
    case "wiki-page":
      return `${base}/wiki/${encodeURIComponent(ref.id)}`;
    case "daily-note":
      return `${base}/wiki`;
    case "mindmap-node":
      return `${base}/mindmap#${encodeURIComponent(ref.id)}`;
    case "slide":
      return `${base}/wiki`;
    case "figure":
      return `/api/p/${encodeURIComponent(projectId)}/asset/${ref.id.split("/").map(encodeURIComponent).join("/")}`;
    default:
      return `${base}/paper`;
  }
}

export function isArtifactKind(value: string): value is ArtifactKind {
  return ARTIFACT_KINDS.includes(value as ArtifactKind);
}

export const ARTIFACT_KINDS: ArtifactKind[] = [
  "project",
  "draft-section",
  "draft-claim",
  "draft-todo",
  "wiki-page",
  "daily-note",
  "mindmap-node",
  "slide",
  "figure",
  "dataset",
  "experiment",
  "web",
  "html-document",
  "markdown-document",
  "custom",
  "external",
];
