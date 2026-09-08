/**
 * Generic artifact deep links.
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
    case "paper-section":
    case "paper-todo":
    case "paper-comment":
      return `${base}/paper#${encodeURIComponent(ref.id)}`;
    case "wiki-page":
      return `${base}/wiki/${encodeURIComponent(ref.id)}`;
    case "mindmap-node":
      return `${base}/mindmap#${encodeURIComponent(ref.id)}`;
    case "figure":
      return `/api/p/${encodeURIComponent(projectId)}/asset/${ref.id.split("/").map(encodeURIComponent).join("/")}`;
    default:
      return `${base}/paper`;
  }
}

export const ARTIFACT_KINDS: ArtifactKind[] = [
  "project",
  "paper-section",
  "paper-todo",
  "paper-comment",
  "wiki-page",
  "mindmap-node",
  "figure",
  "web",
  "external",
];

export function coerceArtifactKind(value: string): ArtifactKind | undefined {
  return ARTIFACT_KINDS.includes(value as ArtifactKind) ? value as ArtifactKind : undefined;
}

export function coerceArtifactRef(ref: { kind: string; id: string; label?: string; url?: string; imageWidth?: number }): ArtifactRef | undefined {
  const kind = coerceArtifactKind(ref.kind);
  if (!kind || !ref.id) return undefined;
  return {
    kind,
    id: ref.id,
    ...(Number.isInteger(ref.imageWidth) && ref.imageWidth! >= 25 && ref.imageWidth! <= 100 ? { imageWidth: ref.imageWidth } : {}),
    ...(ref.label ? { label: ref.label } : {}),
    ...(ref.url ? { url: ref.url } : {}),
  };
}

export function isArtifactKind(value: string): value is ArtifactKind {
  return coerceArtifactKind(value) !== undefined;
}
