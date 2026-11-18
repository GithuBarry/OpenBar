/**
 * OpenBar domain types.
 *
 * Paper TODOs live in TeX. Mindmap TODO cards bind to those ids.
 * Wiki pages are optional Markdown memory. Research meaning is not an enum.
 */

export interface ProjectLink {
  label: string;
  url: string;
  kind: "overleaf" | "latex" | "arxiv" | "web" | "repo";
}

export interface Project {
  id: string;
  slug: string;
  title: string;
  /** Free-form research kind. Not a lifecycle machine. */
  researchKind?: string;
  tagline: string;
  overview: string;
  venue?: string;
  createdAt: string;
  updatedAt: string;
  /** Latest saved authored project change. Computed on read and excluded from stored metadata. */
  lastEditedAt?: string;
  color?: string;
  icon?: string;
  links: ProjectLink[];
  collaborators?: string[];
  /** Hide from the default project list when set. */
  archivedAt?: string;
  /** Optional free-form project label (submitted, on hold, camera ready, …). */
  label?: string;
  /** TeX compiler settings persisted with the project metadata. */
  engine?: "pdflatex" | "xelatex" | "lualatex";
  mainFile?: string;
  texliveVersion?: string;
  /** SHA-256 of the project TeX envelope. Runtime-only CAS metadata. */
  diskHash?: string;
}

export type MindmapNodeShape = "root" | "branch" | "leaf" | "note" | "callout";

import type { MindmapProgress } from "@/lib/mindmap/progress";
import type { MindmapCaution } from "@/lib/mindmap/caution";

export type { MindmapProgress } from "@/lib/mindmap/progress";

export interface MindmapNode {
  id: string;
  /**
   * Map-owned title for ordinary cards. TODO-bound card titles come from TeX.
   */
  title?: string;
  /**
   * Map-owned main text for ordinary cards.
   * Empty on TODO cards — TeX owns the text.
   */
  text: string;
  /** Map-owned text in unified collapsed Notes, including on TODO cards. */
  caption?: string;
  /** Saved caution fields share collapsed Notes with caption. New notes use caption. */
  caution?: MindmapCaution;
  /** When set, this card is a view of the TeX `\obtodo` with this id. */
  todoId?: string;
  parentId: string | null;
  shape?: MindmapNodeShape;
  /** Agent-created card awaiting explicit human Save. */
  agentDraft?: boolean;
  metadata?: Record<string, unknown>;
  contentFormat?: "plain" | "markdown" | "tex" | "html";
  /** Table presentation for Markdown cards. Wide is the default. */
  tableLayout?: "wide" | "scroll";
  /** Optional map-owned card width in canvas CSS pixels. Height follows content. */
  cardWidth?: number;
  color?: string;
  tags?: string[];
  /** Optional map-local 0–6 progress or ditched status. Absent is hidden. */
  progress?: MindmapProgress;
  /** Optional map-local priority. The value has no scientific meaning. */
  priority?: "P0" | "P1" | "P2" | "P3";
  refs?: ArtifactRef[];
  order?: number;
  createdAt?: string;
  /** Last mindmap-owned content change (text, caption, caution, refs, progress, tags, metadata). */
  updatedAt?: string;
}

export interface Mindmap {
  projectId: string;
  id?: string;
  title?: string;
  /**
   * Persisted role. `draft` is the Primary map; `planning` is a secondary map.
   * User-facing copy says Primary / secondary.
   */
  role?: "draft" | "planning";
  rootId: string;
  nodes: MindmapNode[];
  createdAt?: string;
  updatedAt: string;
  revision?: number;
  /** Map-owned Recent activity window, in calendar days. */
  activityWindowDays?: number;
  /** Map-owned card body font size in CSS pixels, 10 through 20. */
  fontSize?: number;
  diskHash?: string;
}

export type ArtifactKind =
  | "project"
  | "paper-section"
  | "paper-todo"
  | "paper-comment"
  | "wiki-page"
  | "mindmap-node"
  | "figure"
  | "web"
  | "external";

export type PaperSectionRefContext = {
  /** Source-graph file path relative to the manuscript root. */
  file?: string;
  /** Display heading captured with the reference. */
  title?: string;
  /** TeX heading level, from 1 through 6. */
  level?: number;
  /** Enclosing heading titles in source order. */
  headingPath?: string[];
  /** Hash of the section body, independent of its positional id. */
  bodyHash?: string;
  /** TeX label when one was present at the time of capture. */
  label?: string;
  /** Source-file hash and range captured for diagnostics and migration. */
  sourceHash?: string;
  sourceRange?: { from: number; to: number };
  order?: number;
};

export interface ArtifactRef {
  /** Map-local image width as a percentage of the card content area. */
  imageWidth?: number;
  kind: ArtifactKind;
  id: string;
  label?: string;
  url?: string;
  /** Explicit map identity for mindmap-node references. */
  mapId?: string;
  /** Source-derived identity for durable paper-section references. */
  sectionContext?: PaperSectionRefContext;
}

export interface WikiPage {
  projectId: string;
  slug: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  tags?: string[];
  bodyHash?: string;
  stateHash?: string;
  format?: "tex" | "markdown" | "html";
  bodyPath?: string;
}
