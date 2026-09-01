/**
 * OpenBarry — shared domain types.
 *
 * These are the contract that every feature module (mindmap, draft editor,
 * wiki, daily notes, slides, MCP server) reads and writes against. Keep this
 * file free of runtime dependencies so it can be imported from anywhere,
 * including the MCP server and edge routes.
 */

// ---------------------------------------------------------------------------
// Maturity — the spine of the whole platform.
//
// Every claim, section, figure, and node carries a maturity level. The core
// philosophy: a research artifact starts as an empty scaffold and is slowly
// *matured* — never finished in one shot, never turned into a changelog. The
// platform surfaces immaturity everywhere so nothing provisional silently
// hardens into "final".
// ---------------------------------------------------------------------------

export const MATURITY_LEVELS = [
  "empty", // placeholder / nothing real here yet
  "hypothesized", // a reasoned hypothesis, awaiting evidence
  "draft", // real content, actively being worked
  "review", // believed correct, awaiting a second look
  "final", // verified, grounded, done
] as const;

export type Maturity = (typeof MATURITY_LEVELS)[number];

export const MATURITY_META: Record<
  Maturity,
  { label: string; rank: number; color: string; blurb: string }
> = {
  empty: { label: "Empty", rank: 0, color: "m-empty", blurb: "Placeholder — nothing real here yet." },
  hypothesized: { label: "Hypothesized", rank: 1, color: "m-hypo", blurb: "A reasoned hypothesis, awaiting evidence." },
  draft: { label: "Draft", rank: 2, color: "m-draft", blurb: "Real content, actively being worked." },
  review: { label: "Review", rank: 3, color: "m-review", blurb: "Believed correct, awaiting a second look." },
  final: { label: "Final", rank: 4, color: "m-final", blurb: "Verified, grounded, done." },
};

/** Inline markers the maturity engine recognizes inside prose. */
export type MaturityMarkerKind =
  | "hypothesized"
  | "notfinal"
  | "todo"
  | "placeholder"
  | "citation-needed"
  | "verify";

export interface MaturityMarker {
  kind: MaturityMarkerKind;
  /** The text the author wrapped, if any. */
  content: string;
  /** Optional note the author attached: {?hypothesized: because X}. */
  note?: string;
  /** Character offset in the source, for editor decorations. */
  start: number;
  end: number;
  /** 1-based line number for jump-to. */
  line: number;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export interface ProjectLink {
  label: string;
  url: string;
  kind: "overleaf" | "latex" | "gdoc" | "gslides" | "repo" | "arxiv" | "web" | "colab";
}

export interface Project {
  id: string;
  slug: string;
  title: string;
  /** Research shape. Review pages use this to ask the right kind of question. */
  mode?: ProjectMode;
  /** Free-form research kind. Prefer this over closed `mode` presets. */
  researchKind?: string;
  /** One-line pitch — the elevator description. Empty means hidden. */
  tagline: string;
  /** Longer markdown overview shown on the project home. */
  overview: string;
  status: "active" | "incubating" | "paused" | "submitted" | "archived";
  /** Target venue / deadline, free text. */
  venue?: string;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  color?: string; // hex accent override for this project
  icon?: string; // emoji or short icon shown in project lists/navigation
  links: ProjectLink[];
  /** Collaborators, free-form. */
  collaborators?: string[];
  /** Dated project goals shown on the agenda. Stored in project metadata, not the paper. */
  milestones?: Array<{
    id: string;
    title: string;
    due?: string;
    status?: "open" | "done";
  }>;
}

// ---------------------------------------------------------------------------
// Mindmap — left-to-right, XMind-style, LaTeX-capable nodes.
// ---------------------------------------------------------------------------

export type MindmapNodeShape = "root" | "branch" | "leaf" | "note" | "callout";

export interface MindmapNode {
  id: string;
  /** Markdown + LaTeX ($...$ / $$...$$) content. First line is the title. */
  text: string;
  /** Parent node id; null only for the single root. */
  parentId: string | null;
  /** Legacy import coordinates. Saved mindmaps derive positions from the tree. */
  x?: number;
  y?: number;
  shape?: MindmapNodeShape;
  /** Collapsed subtrees hide their descendants. */
  collapsed?: boolean;
  /** Evidence overlays and other derived cards. */
  derivedKind?: string;
  metadata?: Record<string, unknown>;
  contentFormat?: "plain" | "markdown" | "tex" | "html";
  /** Maturity of the idea this node represents. */
  maturity?: Maturity;
  /** Accent color override. */
  color?: string;
  /** Open-ended labels used to group and filter planning work. */
  tags?: string[];
  /** Fine-grained completion for this topic, from 0 to 100. */
  progress?: number;
  /** Cross-references to other artifacts (draft sections, wiki pages, links). */
  refs?: ArtifactRef[];
  /** Ordering hint among siblings (top-to-bottom). */
  order?: number;
  /** Immutable first-save timestamp for this card. */
  createdAt?: string;
  /** Last substantive card update, used by activity highlights. */
  updatedAt?: string;
}

export interface Mindmap {
  projectId: string;
  /** Stable id within the project. `"draft"` is the paper-linked planning map. */
  id?: string;
  title?: string;
  /** `draft` maps may link to paper claims/todos. Other maps are free planning canvases. */
  role?: "draft" | "planning";
  /** The single root id. */
  rootId: string;
  nodes: MindmapNode[];
  createdAt?: string;
  updatedAt: string;
  /** Compare-and-swap token. Incremented on durable writes. */
  revision?: number;
  /** Derived compare-and-swap token for the complete semantic map state. */
  diskHash?: string;
}

// ---------------------------------------------------------------------------
// Cross-references — the connective tissue. Any artifact can point at any
// other so the platform reads as one linked system.
// ---------------------------------------------------------------------------

export type ArtifactKind =
  | "project"
  | "draft-section"
  | "draft-claim"
  | "draft-todo"
  | "wiki-page"
  | "daily-note"
  | "mindmap-node"
  | "slide"
  | "figure"
  | "dataset"
  | "experiment"
  | "web"
  | "html-document"
  | "markdown-document"
  | "custom"
  | "external";

export interface ArtifactRef {
  kind: ArtifactKind;
  /** Stable id within its kind (slug, node id, section id…). */
  id: string;
  /** Human label for rendering. */
  label?: string;
  /** For external refs. */
  url?: string;
}

// ---------------------------------------------------------------------------
// Research graph — lean, file-backed records that tie claims to evidence.
// ---------------------------------------------------------------------------

/** Named presets. Projects may also use a free-form `researchKind` string. */
export type ProjectMode =
  | "paper"
  | "benchmark"
  | "security-attack"
  | "privacy-audit"
  | "rebuttal"
  | "exploration"
  | "tooling"
  | "artifact-release"
  | (string & {});

/**
 * @deprecated Display ladder only. Claim identity is text + tags + assessments,
 * evaluated per purpose — not membership in this enum.
 */
export type ClaimState =
  | "seed"
  | "hypothesis"
  | "weak-evidence"
  | "moderate-evidence"
  | "strong-evidence"
  | "paper-ready"
  | "submitted"
  | "killed";

export interface ClaimAssessment {
  id: string;
  dimension: string;
  value: string | number | boolean;
  scope?: string;
  rationale?: string;
  sourceIds?: string[];
  createdBy?: "human" | "agent" | "system";
  createdAt: string;
}

export interface ClaimCard {
  projectId: string;
  id: string;
  title: string;
  /** Atomic research claim. Keep this narrower than paper prose. */
  claim: string;
  /** Where the claim should appear, e.g. `results.layer_sweep`. */
  paperSection?: string;
  /**
   * @deprecated Display ladder for existing UI. Not readiness identity;
   * use `tags` / `assessments` and evaluate per purpose.
   */
  state: ClaimState;
  maturity: Maturity;
  confidence?: "low" | "medium" | "high";
  scope?: string;
  owner?: string;
  evidenceIds: string[];
  objectionIds?: string[];
  /** Same relation as `objectionIds`; preferred name on the annotated claim. */
  challengeIds?: string[];
  tags?: string[];
  assessments?: ClaimAssessment[];
  notes?: string[];
  refs: ArtifactRef[];
  currentWeakness?: string;
  nextAction?: string;
  lastCheckedAt?: string;
  createdAt?: string;
  updatedAt: string;
}

export type EvidenceSourceKind =
  | "github"
  | "wandb"
  | "local"
  | "remote"
  | "google-doc"
  | "google-slide"
  | "overleaf"
  | "codex-memory"
  | "slack"
  | "external";

export interface EvidenceReceipt {
  projectId: string;
  id: string;
  title: string;
  sourceKind: EvidenceSourceKind;
  source: string;
  summary: string;
  claimIds: string[];
  rawInputRefs?: ArtifactRef[];
  intermediateRefs?: ArtifactRef[];
  outputRefs?: ArtifactRef[];
  metricRefs?: ArtifactRef[];
  excerpts?: string[];
  sampleCount?: number;
  reviewer?: string;
  reviewedAt?: string;
  verdict?: "supports" | "weakens" | "mixed" | "inconclusive";
  limitations?: string;
  refs: ArtifactRef[];
  createdAt?: string;
  updatedAt: string;
}

export interface SourceManifestEntry {
  id: string;
  projectId: string;
  kind: EvidenceSourceKind | "drive" | "chat-export";
  label: string;
  uri: string;
  sha256?: string;
  sizeBytes?: number;
  mtime?: string;
  fetchedAt?: string;
  selectedExcerpt?: string;
  anchors?: { label?: string; selector: string; excerpt?: string }[];
  metadata?: Record<string, unknown>;
  tags?: string[];
  linkedWikiPages?: string[];
  linkedClaimIds?: string[];
  notes?: string;
}

export type ChallengeType =
  | "claim-evidence"
  | "metric-validity"
  | "raw-inspection"
  | "failure-story"
  | "baseline"
  | "speed-unit"
  | "taste-choice"
  | "advisor-prediction"
  | "reviewer-objection"
  | "writing-crux";

export interface MicroChallenge {
  id: string;
  projectId: string;
  targetRef?: ArtifactRef;
  type: ChallengeType;
  question: string;
  recommendedAnswer?: string;
  whyNow: string;
  expectedArtifact: string;
  severity: "low" | "medium" | "high" | "gate";
  status: "active" | "completed" | "deferred" | "retired";
  fingerprint: string;
  createdAt: string;
  lastRaisedAt?: string;
  cooldownUntil?: string;
  repeatCount?: number;
  resolvedByRefs?: ArtifactRef[];
  userReason?: string;
}

export interface MonthlyReview {
  projectId: string;
  month: string; // YYYY-MM
  whatChanged?: string;
  whyItMatters?: string;
  /** A question to carry into the next team, collaborator, or advisor discussion. */
  discussionAsk?: string;
  /** Legacy persisted field. Records are normalized to `discussionAsk` on read and write. */
  daphneAsk?: string;
  taste: string;
  evidence: string;
  paper: string;
  momentum: string;
  decisions: string[];
  nextBets: string[];
  refs: ArtifactRef[];
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Maturing draft — the LaTeX/markdown document that slowly turns from a
// scaffold into a complete draft.
// ---------------------------------------------------------------------------

export interface DraftSection {
  id: string;
  /** Heading depth 1..4. */
  depth: number;
  title: string;
  /** Raw markdown body of this section (excluding the heading line). */
  body: string;
  /** Author-declared maturity for the whole section (front-matter override). */
  declaredMaturity?: Maturity;
  /** Computed maturity from markers + emptiness. */
  computedMaturity: Maturity;
  markers: MaturityMarker[];
  /** Char span in the source document. */
  start: number;
  end: number;
  line: number;
  /** Detected structural placeholders. */
  placeholders: {
    emptyTables: number;
    missingFigures: number;
    todos: number;
    emptyBody: boolean;
  };
}

export interface MaturedDraft {
  projectId: string;
  slug: string;
  title: string;
  /** Raw source (markdown with maturity markers + $latex$). */
  source: string;
  sections: DraftSection[];
  /** Rolled-up completion 0..1 across sections, weighted by length. */
  completion: number;
  overallMaturity: Maturity;
  updatedAt: string;
  /** Optional link to the source LaTeX / gdoc this mirrors. */
  sourceLink?: ProjectLink;
}

// ---------------------------------------------------------------------------
// Wiki — the LLM-facing project knowledge base.
// ---------------------------------------------------------------------------

export interface WikiPage {
  projectId: string;
  slug: string;
  title: string;
  /** Short summary used in the MCP context bundle and search. */
  summary: string;
  body: string; // markdown + latex
  tags: string[];
  refs: ArtifactRef[];
  createdAt: string;
  updatedAt: string;
  /** Stored body format. Absent means infer from bytes. */
  format?: "tex" | "markdown" | "html";
  htmlMode?: "static" | "interactive";
  /** SHA-256 of stored body bytes, useful for content-only comparisons. */
  bodyHash?: string;
  /** SHA-256 of body plus saved metadata. Required for atomic web edits. */
  stateHash?: string;
  /** If true, always included in the MCP project-context bundle. */
  pinnedForAgents?: boolean;
}

// ---------------------------------------------------------------------------
// Daily notes — the running lab notebook.
// ---------------------------------------------------------------------------

export interface DailyNote {
  projectId: string;
  /** YYYY-MM-DD. */
  date: string;
  body: string; // markdown + latex
  /** Structured highlights the note-generator / MCP can emit. */
  did?: string[];
  next?: string[];
  blockers?: string[];
  refs: ArtifactRef[];
  createdAt?: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Weekly slides — the picture-of-progress gallery (mirrors Google Slides).
// ---------------------------------------------------------------------------

export interface Slide {
  id: string;
  caption: string;
  /** Image path under content or a remote URL. */
  image?: string;
  /** Optional markdown/latex body for text slides. */
  body?: string;
  refs?: ArtifactRef[];
}

export interface SlideDeck {
  projectId: string;
  /** ISO week key, e.g. 2026-W27. */
  week: string;
  title: string;
  /** Link to the source Google Slides deck. */
  source?: ProjectLink;
  slides: Slide[];
  createdAt?: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Aggregate project context — what the MCP server hands a coding agent.
// ---------------------------------------------------------------------------

export interface ProjectContextBundle {
  project: Project;
  mindmapOutline: string; // rendered LTR outline
  claims: {
    id: string;
    title: string;
    /** @deprecated Display hint from `state=`. Not readiness identity. */
    state?: string;
    purpose: string;
    assessment: "ready" | "needs-work";
    maturity: Maturity;
    evidenceIds: string[];
    currentWeakness?: string;
    nextAction?: string;
  }[];
  evidence: {
    id: string;
    title: string;
    sourceKind: EvidenceSourceKind;
    claimIds: string[];
    verdict?: EvidenceReceipt["verdict"];
    limitations?: string;
  }[];
  sourceRefs: {
    id: string;
    kind: string;
    label: string;
    uri: string;
    sha256?: string;
    selectedExcerpt?: string;
    anchors?: { label?: string; selector: string; excerpt?: string }[];
    notes?: string;
    linkedWikiPages?: string[];
    linkedClaimIds?: string[];
  }[];
  challenges: {
    id: string;
    type: ChallengeType;
    targetRef?: ArtifactRef;
    question: string;
    recommendedAnswer?: string;
    whyNow: string;
    severity: MicroChallenge["severity"];
    status: MicroChallenge["status"];
    expectedArtifact: string;
    resolvedByRefs?: ArtifactRef[];
  }[];
  monthlyReviews: { month: string; whatChanged?: string; whyItMatters?: string; discussionAsk?: string; decisions: string[]; nextBets: string[] }[];
  drafts: {
    slug: string;
    title: string;
    completion: number;
    overallMaturity: Maturity;
    /** The explicit list of not-done items an agent must not claim as done. */
    openItems: { section: string; kind: MaturityMarkerKind | "empty-section"; text: string }[];
  }[];
  pinnedWiki: { slug: string; title: string; summary: string; body: string; refs: ArtifactRef[] }[];
  recentNotes: { date: string; did?: string[]; next?: string[]; blockers?: string[] }[];
  /** The research-philosophy guardrails, injected verbatim. */
  guardrails: string[];
  generatedAt: string;
}
