import { indexMindmap as indexMindmapTree, pruneEvidenceNodes } from "./mindmap-index";
import { getDraft, getProject, listDrafts } from "./store";
import {
  buildProjectPaperGraph,
  claimEvaluationMaturity,
  type PaperGraphClaim,
} from "./paper-graph";
import type { ClaimAssessment, Maturity, Mindmap, MindmapNode } from "./types";

export { pruneEvidenceNodes };

/**
 * Build a draft-status outline for seeding or explicitly resetting the editable
 * mindmap canvas. The manuscript remains authoritative for claims/evidence/TODOs;
 * this helper never overwrites a saved planning map by itself.
 */
type DeriveGraph = {
  claims: Array<{
    id: string;
    title?: string;
    text: string;
    state?: string;
    section?: string;
    evidenceIds?: string[];
    challengeIds?: string[];
    tags?: string[];
    assessments?: ClaimAssessment[];
  }>;
  evidence: Array<{ id: string; summary: string; claimIds: string[] }>;
  todos: Array<{ id: string; text: string; claimId?: string }>;
};

function evaluableFromDerived(
  claim: DeriveGraph["claims"][number],
  graph: DeriveGraph,
): PaperGraphClaim {
  const linked = graph.evidence.filter((item) => item.claimIds.includes(claim.id)).map((item) => item.id);
  return {
    id: claim.id,
    title: claim.title,
    text: claim.text,
    state: claim.state,
    section: claim.section,
    evidenceIds: [...new Set([...(claim.evidenceIds || []), ...linked])],
    challengeIds: claim.challengeIds || [],
    tags: claim.tags || [],
    assessments: claim.assessments || [],
    source: "derive",
    line: 0,
  };
}

/** Map id → node, plus children grouped by parentId (sibling order preserved). */
export function indexMindmap(mindmap: Mindmap): {
  nodeById: Map<string, MindmapNode>;
  children: Map<string, MindmapNode[]>;
} {
  const { nodeById, childrenByParent } = indexMindmapTree(mindmap);
  return { nodeById, children: childrenByParent };
}

export function deriveMindmapFromGraph(
  slug: string,
  project: { title: string; tagline: string },
  graph: DeriveGraph,
  updatedAt: string,
): Mindmap {
  const nodes: MindmapNode[] = [
    {
      id: "root",
      text: `${project.title}\n${project.tagline}`,
      parentId: null,
      shape: "root",
      order: 0,
      refs: [{ kind: "draft-section", id: "paper", label: "Draft" }],
    },
  ];

  const todosByClaim = new Map<string, DeriveGraph["todos"]>();
  for (const td of graph.todos) {
    if (!td.claimId) continue;
    const list = todosByClaim.get(td.claimId);
    if (list) list.push(td);
    else todosByClaim.set(td.claimId, [td]);
  }

  const claimedTodoIds = new Set<string>();
  let order = 0;

  for (const claim of graph.claims) {
    const claimNodeId = `claim-${claim.id}`;
    nodes.push({
      id: claimNodeId,
      text: `${claim.title || claim.id}\n${claim.text}`,
      parentId: "root",
      maturity: claimEvaluationMaturity(evaluableFromDerived(claim, graph)),
      order: order++,
      refs: [
        { kind: "draft-section", id: `paper#${claim.section || "results"}`, label: claim.section || "results" },
      ],
    });

    let sub = 0;
    for (const td of todosByClaim.get(claim.id) || []) {
      claimedTodoIds.add(td.id);
      nodes.push({
        id: `todo-${td.id}`,
        text: `TODO\n${td.text}`,
        parentId: claimNodeId,
        maturity: "empty",
        order: sub++,
      });
    }
  }

  for (const td of graph.todos) {
    if (claimedTodoIds.has(td.id)) continue;
    nodes.push({
      id: `todo-${td.id}`,
      text: `TODO\n${td.text}`,
      parentId: "root",
      maturity: "empty",
      order: order++,
    });
  }

  return {
    projectId: slug,
    rootId: "root",
    nodes,
    createdAt: updatedAt,
    updatedAt,
  };
}

export function deriveMindmap(slug: string): Mindmap | null {
  const project = getProject(slug);
  if (!project) return null;
  const graph = buildProjectPaperGraph(slug);
  const draft = listDrafts(slug).map((d) => getDraft(slug, d)).find(Boolean);
  return deriveMindmapFromGraph(slug, project, graph, draft?.updatedAt || project.updatedAt);
}
