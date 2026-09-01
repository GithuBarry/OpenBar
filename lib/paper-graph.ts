import { analyzePaper } from "@/lib/research/paper-analysis";
import { evaluateClaimForPurpose, type Claim, type ClaimAssessment } from "@/lib/research/claim-model";
import { getPaperSource, listDrafts } from "./store";
import { MATURITY_META, type Maturity } from "./types";

export interface PaperGraphClaim {
  id: string;
  title?: string;
  text: string;
  state?: string;
  section?: string;
  evidenceIds: string[];
  challengeIds: string[];
  tags: string[];
  assessments: ClaimAssessment[];
  source: string;
  line: number;
  scope?: string;
  weakness?: string;
  next?: string;
}

/** Map a paper-graph claim onto the evaluable Claim shape. */
export function asEvaluableClaim(claim: PaperGraphClaim): Claim {
  return {
    id: claim.id,
    text: claim.text,
    evidenceIds: claim.evidenceIds,
    challengeIds: claim.challengeIds,
    tags: claim.tags,
    assessments: claim.assessments,
    state: claim.state,
  };
}

export interface PaperGraphEvidence {
  id: string;
  summary: string;
  claimIds: string[];
  sourceRef?: string;
  rawRefs: string[];
  metricRefs: string[];
  sampleCount?: number;
  source: string;
  line: number;
  limitations?: string;
}

export interface PaperGraphTodo {
  id: string;
  text: string;
  claimId?: string;
  section?: string;
  priority?: string;
  due?: string;
  owner?: string;
  createdAt?: string;
  source: string;
  line: number;
}

export interface PaperGraphComment {
  text: string;
  section?: string;
  source: string;
  line: number;
}

export interface PaperGraph {
  claims: PaperGraphClaim[];
  evidence: PaperGraphEvidence[];
  comments: PaperGraphComment[];
  todos: PaperGraphTodo[];
}

export function buildProjectPaperGraph(project: string): PaperGraph {
  const graph: PaperGraph = { claims: [], evidence: [], comments: [], todos: [] };
  for (const draftSlug of listDrafts(project)) {
    const source = getPaperSource(project, draftSlug);
    if (!source) continue;
    mergeGraph(graph, parsePaperGraphSource(source, `draft/${draftSlug}`));
  }
  return graph;
}

/** Cheap dashboard maturity from purpose evaluation — not a stored status ladder. */
export function paperGraphMaturity(graph: PaperGraph): Maturity {
  const levels: Maturity[] = graph.claims.map((claim) => claimEvaluationMaturity(claim));
  if (graph.todos.length > 0) levels.push("draft");
  if (levels.length === 0) return graph.evidence.length > 0 ? "draft" : "empty";
  const minRank = Math.min(...levels.map((level) => MATURITY_META[level].rank));
  return (Object.keys(MATURITY_META) as Maturity[]).find((key) => MATURITY_META[key].rank === minRank) ?? "empty";
}

export function claimEvaluationMaturity(claim: PaperGraphClaim): Maturity {
  if (claim.tags.some((tag) => tag.toLowerCase() === "killed") || (claim.state || "").toLowerCase() === "killed") {
    return "empty";
  }
  const evaluation = evaluateClaimForPurpose(asEvaluableClaim(claim), "paper-synthesis");
  if (evaluation.assessment === "ready") return "review";
  return evaluation.considerations.some((item) => item.severity === "high") ? "hypothesized" : "draft";
}

export type PaperClaimReviewRow = {
  claim: PaperGraphClaim;
  assessment: "ready" | "needs-work";
  purpose: string;
  maturity: Maturity;
};

export function summarizePaperClaims(graph: PaperGraph, purpose = "paper-synthesis"): {
  rows: PaperClaimReviewRow[];
  needsWork: PaperClaimReviewRow[];
  ready: PaperClaimReviewRow[];
} {
  const rows = graph.claims.map((claim) => {
    const evaluation = evaluateClaimForPurpose(asEvaluableClaim(claim), purpose);
    return {
      claim,
      assessment: evaluation.assessment,
      purpose: evaluation.purpose,
      maturity: claimEvaluationMaturity(claim),
    };
  });
  return {
    rows,
    needsWork: rows.filter((row) => row.assessment === "needs-work"),
    ready: rows.filter((row) => row.assessment === "ready"),
  };
}

export function parsePaperGraphSource(source: string, sourceName: string): PaperGraph {
  const analysis = analyzePaper(source);
  return {
    claims: analysis.claims.map((claim) => ({
      id: claim.id || claim.attrs.id || `claim-${sourceName}-${claim.line}`,
      text: claim.text,
      state: claim.state,
      section: claim.section,
      evidenceIds: claim.evidenceIds,
      challengeIds: claim.challengeIds,
      tags: claim.tags,
      assessments: claim.assessments,
      source: sourceName,
      line: claim.line,
      scope: claim.attrs.scope,
      weakness: claim.attrs.weakness,
      next: claim.attrs.next,
    })),
    evidence: analysis.evidence.map((item) => ({
      id: item.id || item.attrs.id || `evidence-${sourceName}-${item.line}`,
      summary: item.summary,
      claimIds: item.claimIds,
      sourceRef: item.sourceRef,
      rawRefs: item.rawRefs,
      metricRefs: item.metricRefs,
      sampleCount: item.sampleCount,
      source: sourceName,
      line: item.line,
      limitations: item.limitations,
    })),
    comments: analysis.comments
      .filter((note) => note.kind === "comment")
      .map((note) => ({
        text: note.text,
        section: note.section,
        source: sourceName,
        line: note.line,
      })),
    todos: analysis.todos.map((todo) => ({
      id: todo.id || todo.attrs.id || `todo-${sourceName}-${todo.line}`,
      text: todo.text,
      claimId: todo.claimId,
      section: todo.section,
      priority: todo.priority,
      due: todo.due,
      owner: todo.owner,
      createdAt: todo.createdAt,
      source: sourceName,
      line: todo.line,
    })),
  };
}

function mergeGraph(target: PaperGraph, next: PaperGraph) {
  target.claims.push(...next.claims);
  target.evidence.push(...next.evidence);
  target.comments.push(...next.comments);
  target.todos.push(...next.todos);
}
