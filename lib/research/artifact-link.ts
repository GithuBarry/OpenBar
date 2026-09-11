/**
 * Generic artifact deep links.
 */

import type { ArtifactKind, ArtifactRef, Mindmap, MindmapNode, PaperSectionRefContext } from "@/lib/types";
import { safeUrl } from "@/lib/safe-url";
import { sha256Hex } from "@/lib/mindmap/sha256";

export type PaperSectionRefTarget = {
  id: string;
  title: string;
  level: number;
  label?: string;
  file?: string;
  filePath?: string;
  order?: number;
  headingPath?: string[];
  bodyHash?: string;
  body?: string;
  tex?: string;
  excerpt?: string;
  sourceHash?: string;
  sourceRange?: { from: number; to: number };
  from?: number;
  to?: number;
};

export type PaperSectionResolution =
  | { status: "resolved"; section: PaperSectionRefTarget }
  | {
    status: "unresolved";
    reason: "missing-section" | "ambiguous-section" | "legacy-positional";
    candidates: PaperSectionRefTarget[];
  };

export type MindmapNodeResolution =
  | { status: "resolved"; mapId: string; nodeId: string; node: MindmapNode; map: Mindmap }
  | {
    status: "unresolved";
    reason: "missing-map" | "missing-node" | "ambiguous-node";
    mapId: string;
    nodeId: string;
  };

export const PAPER_SECTION_FRAGMENT_PREFIX = "paper-section:";
export const PRIMARY_MINDMAP_ID = "draft";

function safeMapId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const id = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) ? id : undefined;
}

function normalizedText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().toLocaleLowerCase() : "";
}

function normalizedPath(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map(item => normalizedText(item)) : [];
}

function normalizedParentPath(value: unknown): string[] {
  const path = normalizedPath(value);
  return path.length ? path.slice(0, -1) : [];
}

function sourceFile(section: PaperSectionRefTarget): string | undefined {
  const value = section.file || section.filePath;
  return typeof value === "string" && value.trim() ? value.trim().replace(/\\/g, "/") : undefined;
}

export function paperSectionBodyHash(section: Pick<PaperSectionRefTarget, "body" | "tex" | "excerpt" | "bodyHash">): string | undefined {
  if (typeof section.bodyHash === "string" && section.bodyHash.trim()) return section.bodyHash.trim();
  const body = typeof section.body === "string" ? section.body : typeof section.tex === "string" ? section.tex : section.excerpt;
  return typeof body === "string" ? sha256Hex(body) : undefined;
}

export function paperSectionContext(section: PaperSectionRefTarget): PaperSectionRefContext {
  const file = sourceFile(section);
  const bodyHash = paperSectionBodyHash(section);
  const label = typeof section.label === "string" ? section.label.trim() : "";
  const title = typeof section.title === "string" ? section.title.trim() : "";
  const headingPath = normalizedPath(section.headingPath);
  return {
    ...(file ? { file } : {}),
    ...(title ? { title } : {}),
    ...(Number.isInteger(section.level) ? { level: section.level } : {}),
    ...(headingPath.length ? { headingPath: section.headingPath!.map(item => item.trim()) } : {}),
    ...(bodyHash ? { bodyHash } : {}),
    ...(label ? { label } : {}),
    ...(typeof section.sourceHash === "string" && section.sourceHash.trim() ? { sourceHash: section.sourceHash.trim() } : {}),
    ...(section.sourceRange && Number.isFinite(section.sourceRange.from) && Number.isFinite(section.sourceRange.to)
      ? { sourceRange: { from: section.sourceRange.from, to: section.sourceRange.to } }
      : {}),
    ...(Number.isInteger(section.order) ? { order: section.order } : {}),
  };
}

function contextHasIdentity(context: PaperSectionRefContext | undefined): boolean {
  return Boolean(context && (context.file || context.title || context.level !== undefined || context.headingPath?.length || context.bodyHash || context.label));
}

function contextLabel(ref: Pick<ArtifactRef, "id" | "sectionContext">): string | undefined {
  const label = ref.sectionContext?.label?.trim();
  return label || undefined;
}

function labelsEqual(left: string | undefined, right: string | undefined): boolean {
  return Boolean(left && right && left === right);
}

function structurallyMatches(context: PaperSectionRefContext, section: PaperSectionRefTarget): boolean {
  if (context.file && sourceFile(section) !== context.file.replace(/\\/g, "/")) return false;
  if (context.title && normalizedText(section.title) !== normalizedText(context.title)) return false;
  if (context.level !== undefined && section.level !== context.level) return false;
  if (context.headingPath?.length && normalizedPath(section.headingPath).join("\u0000") !== normalizedPath(context.headingPath).join("\u0000")) return false;
  return true;
}

/**
 * Resolve a durable paper-section ref against the current source-derived
 * descriptors. TeX labels are authoritative. Unlabeled references use the
 * captured structural identity and body hash, with ambiguity surfaced.
 */
export function resolvePaperSectionRef(
  ref: Pick<ArtifactRef, "kind" | "id" | "sectionContext">,
  sections: readonly PaperSectionRefTarget[],
): PaperSectionResolution {
  if (ref.kind !== "paper-section") return { status: "unresolved", reason: "legacy-positional", candidates: [] };
  const context = ref.sectionContext;
  const label = contextLabel(ref) || (!contextHasIdentity(context) ? ref.id : undefined);
  if (label) {
    const candidates = sections.filter(section => labelsEqual(section.label?.trim(), label));
    if (candidates.length === 1) return { status: "resolved", section: candidates[0]! };
    if (candidates.length > 1) return { status: "unresolved", reason: "ambiguous-section", candidates };
    if (context?.label) return { status: "unresolved", reason: "missing-section", candidates: [] };
  }

  if (!contextHasIdentity(context)) {
    return { status: "unresolved", reason: "legacy-positional", candidates: [] };
  }

  const structural = sections.filter(section => structurallyMatches(context!, section));
  const bodyHash = context!.bodyHash;
  const byBody = bodyHash ? structural.filter(section => paperSectionBodyHash(section) === bodyHash) : [];
  if (structural.length === 1) return { status: "resolved", section: structural[0]! };
  if (byBody.length === 1) return { status: "resolved", section: byBody[0]! };
  if (structural.length > 1) return { status: "unresolved", reason: "ambiguous-section", candidates: byBody.length ? byBody : structural };

  // A renamed unlabeled heading can still be recovered when its file, level,
  // path, and unchanged body identify one current section.
  const bodyCandidates = bodyHash
    ? sections.filter(section => {
      if (context!.file && sourceFile(section) !== context!.file.replace(/\\/g, "/")) return false;
      if (context!.level !== undefined && section.level !== context!.level) return false;
      if (context!.headingPath?.length
        && normalizedParentPath(section.headingPath).join("\u0000") !== normalizedParentPath(context!.headingPath).join("\u0000")) return false;
      return paperSectionBodyHash(section) === bodyHash;
    })
    : [];
  if (bodyCandidates.length === 1) return { status: "resolved", section: bodyCandidates[0]! };
  if (bodyCandidates.length > 1) return { status: "unresolved", reason: "ambiguous-section", candidates: bodyCandidates };
  return { status: "unresolved", reason: "missing-section", candidates: [] };
}

/** Enrich a paper-section ref at a save boundary and preserve unresolved refs. */
export function canonicalizePaperSectionRef(
  ref: ArtifactRef,
  sections: readonly PaperSectionRefTarget[],
): ArtifactRef {
  if (ref.kind !== "paper-section") return ref;
  const resolved = resolvePaperSectionRef(ref, sections);
  const target = resolved.status === "resolved" ? resolved.section : undefined;
  if (!target) return ref;
  const context = paperSectionContext(target);
  const durableId = target.label?.trim() && sections.filter(section => section.label?.trim() === target!.label!.trim()).length === 1
    ? target.label.trim()
    : target.id;
  return { ...ref, id: durableId, sectionContext: context };
}

export function canonicalizeMindmapNodeRef(ref: ArtifactRef): ArtifactRef {
  if (ref.kind !== "mindmap-node" || ref.mapId) return ref;
  // Older map-node refs opened the default map. Make that migration explicit.
  return { ...ref, mapId: PRIMARY_MINDMAP_ID };
}

export function canonicalizeArtifactRef(ref: ArtifactRef, sections: readonly PaperSectionRefTarget[] = []): ArtifactRef {
  return canonicalizeMindmapNodeRef(canonicalizePaperSectionRef(ref, sections));
}

export function migrateArtifactRef(ref: ArtifactRef, sections: readonly PaperSectionRefTarget[] = []): ArtifactRef {
  return canonicalizeArtifactRef(ref, sections);
}

export function migrateMindmapArtifactRefs<T extends Mindmap>(mindmap: T, sections: readonly PaperSectionRefTarget[] = []): T {
  return {
    ...mindmap,
    nodes: mindmap.nodes.map(node => ({
      ...node,
      ...(node.refs ? { refs: node.refs.map(ref => migrateArtifactRef(ref, sections)) } : {}),
    })),
  };
}

export function resolveMindmapNodeRef(
  ref: Pick<ArtifactRef, "kind" | "id" | "mapId">,
  maps: readonly Mindmap[],
): MindmapNodeResolution {
  const mapId = safeMapId(ref.mapId) || PRIMARY_MINDMAP_ID;
  const canonicalMapId = mapId === "mindmap" ? PRIMARY_MINDMAP_ID : mapId;
  const candidates = maps.filter(map => {
    const id = map.id || (map.role === "draft" ? PRIMARY_MINDMAP_ID : "");
    return id === canonicalMapId || (canonicalMapId === PRIMARY_MINDMAP_ID && (id === "mindmap" || map.role === "draft"));
  });
  const map = candidates[0];
  if (!map) return { status: "unresolved", reason: "missing-map", mapId: canonicalMapId, nodeId: ref.id };
  const nodes = map.nodes.filter(node => node.id === ref.id);
  if (nodes.length === 0) return { status: "unresolved", reason: "missing-node", mapId: canonicalMapId, nodeId: ref.id };
  if (nodes.length > 1) return { status: "unresolved", reason: "ambiguous-node", mapId: canonicalMapId, nodeId: ref.id };
  return { status: "resolved", mapId: canonicalMapId, nodeId: ref.id, node: nodes[0]!, map };
}

function paperSectionFragmentPayload(ref: Pick<ArtifactRef, "id" | "sectionContext">): string {
  return `${PAPER_SECTION_FRAGMENT_PREFIX}${encodeURIComponent(JSON.stringify({ id: ref.id, sectionContext: ref.sectionContext }))}`;
}

export function decodePaperSectionFragment(value: string): Pick<ArtifactRef, "kind" | "id" | "sectionContext"> | null {
  try {
    const decoded = decodeURIComponent(value.trim().replace(/^#/, ""));
    if (!decoded.startsWith(PAPER_SECTION_FRAGMENT_PREFIX)) return null;
    const payload = JSON.parse(decodeURIComponent(decoded.slice(PAPER_SECTION_FRAGMENT_PREFIX.length))) as Record<string, unknown>;
    if (typeof payload.id !== "string" || !payload.id.trim()) return null;
    const sectionContext = coercePaperSectionRefContext(payload.sectionContext);
    return { kind: "paper-section", id: payload.id.trim(), ...(sectionContext ? { sectionContext } : {}) };
  } catch {
    return null;
  }
}

export function coercePaperSectionRefContext(value: unknown): PaperSectionRefContext | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const text = (key: string): string | undefined => typeof input[key] === "string" && String(input[key]).trim() ? String(input[key]).trim() : undefined;
  const level = typeof input.level === "number" && Number.isInteger(input.level) && input.level >= 1 && input.level <= 6 ? input.level : undefined;
  const order = typeof input.order === "number" && Number.isInteger(input.order) && input.order >= 0 ? input.order : undefined;
  const headingPath = Array.isArray(input.headingPath) && input.headingPath.every(item => typeof item === "string")
    ? (input.headingPath as string[]).map(item => item.trim()).filter(Boolean)
    : undefined;
  const sourceRange = input.sourceRange && typeof input.sourceRange === "object" && !Array.isArray(input.sourceRange)
    ? input.sourceRange as Record<string, unknown>
    : undefined;
  const from = sourceRange && typeof sourceRange.from === "number" && Number.isInteger(sourceRange.from) && sourceRange.from >= 0 ? sourceRange.from : undefined;
  const to = sourceRange && typeof sourceRange.to === "number" && Number.isInteger(sourceRange.to) && sourceRange.to >= 0 ? sourceRange.to : undefined;
  const context: PaperSectionRefContext = {
    ...(text("file") ? { file: text("file") } : {}),
    ...(text("title") ? { title: text("title") } : {}),
    ...(level === undefined ? {} : { level }),
    ...(headingPath?.length ? { headingPath } : {}),
    ...(text("bodyHash") ? { bodyHash: text("bodyHash") } : {}),
    ...(text("label") ? { label: text("label") } : {}),
    ...(text("sourceHash") ? { sourceHash: text("sourceHash") } : {}),
    ...(from === undefined || to === undefined || to < from ? {} : { sourceRange: { from, to } }),
    ...(order === undefined ? {} : { order }),
  };
  return contextHasIdentity(context) ? context : undefined;
}

export function artifactHref(projectId: string, ref: Pick<ArtifactRef, "kind" | "id" | "url" | "mapId" | "sectionContext">): string {
  if (ref.kind === "web" || ref.kind === "external") {
    const external = safeUrl(ref.url || ref.id);
    if (external) return external;
  }
  const base = `/p/${encodeURIComponent(projectId)}`;
  switch (ref.kind) {
    case "project":
      return base;
    case "paper-section":
      if (ref.sectionContext?.label) {
        return `${base}/paper#${encodeURIComponent(ref.sectionContext.label)}`;
      }
      if (ref.sectionContext && !ref.sectionContext.label) {
        return `${base}/paper#${encodeURIComponent(paperSectionFragmentPayload(ref))}`;
      }
    case "paper-todo":
    case "paper-comment":
      return `${base}/paper#${encodeURIComponent(ref.id)}`;
    case "wiki-page":
      return `${base}/wiki/${encodeURIComponent(ref.id)}`;
    case "mindmap-node":
      {
        const mapId = safeMapId(ref.mapId);
        const mapPath = mapId && mapId !== "draft" && mapId !== "mindmap" ? `/${encodeURIComponent(mapId)}` : "";
        return `${base}/mindmap${mapPath}#${encodeURIComponent(ref.id)}`;
      }
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

export function coerceArtifactRef(ref: { kind: string; id: string; label?: string; url?: string; imageWidth?: number; mapId?: string; sectionContext?: unknown }): ArtifactRef | undefined {
  const kind = coerceArtifactKind(ref.kind);
  if (!kind || !ref.id) return undefined;
  return {
    kind,
    id: ref.id,
    ...(Number.isInteger(ref.imageWidth) && ref.imageWidth! >= 25 && ref.imageWidth! <= 100 ? { imageWidth: ref.imageWidth } : {}),
    ...(ref.label ? { label: ref.label } : {}),
    ...(ref.url ? { url: ref.url } : {}),
    ...(safeMapId(ref.mapId) ? { mapId: safeMapId(ref.mapId) } : {}),
    ...(coercePaperSectionRefContext(ref.sectionContext) ? { sectionContext: coercePaperSectionRefContext(ref.sectionContext) } : {}),
  };
}

export function isArtifactKind(value: string): value is ArtifactKind {
  return coerceArtifactKind(value) !== undefined;
}
