/**
 * Project agenda assembled from manuscript TODOs, comments, and conversion warnings.
 */

import { buildAgenda, type AgendaItem, type ProjectMilestone } from "./agenda";
import { taskFromAttrs } from "./tasks";
import { buildProjectPaperGraph } from "@/lib/paper-graph";
import { findMacroMatches, parseAnchorAttrs } from "@/lib/marker-codec";
import { getPaperSource, getProject, listDrafts } from "@/lib/store";

export function projectAgenda(projectId: string, milestones?: ProjectMilestone[]): AgendaItem[] {
  const fromProject = getProject(projectId)?.milestones;
  const resolved = milestones ?? fromProject ?? [];
  const graph = buildProjectPaperGraph(projectId);
  const tasks = graph.todos.map((todo) => {
    const drafts = listDrafts(projectId);
    const source = getPaperSource(projectId, drafts[0] || "paper") || "";
    let from = 0;
    let to = 0;
    for (const match of findMacroMatches(source, ["obtodo"])) {
      if (parseAnchorAttrs(match.attrs).id === todo.id) {
        from = match.index;
        to = match.index + match.length;
        break;
      }
    }
    return taskFromAttrs(
      {
        id: todo.id,
        claim: todo.claimId || "",
        priority: todo.priority || "",
        due: todo.due || "",
        created: todo.createdAt || "",
      },
      todo.text,
      { from, to },
    );
  });
  const comments = graph.comments
    .filter((comment) => /action|todo|please|fix/i.test(comment.text))
    .map((comment) => ({
      id: `comment-${comment.line}`,
      kind: "comment" as const,
      title: comment.text,
      href: `/p/${projectId}/paper`,
    }));
  return [...buildAgenda({ projectId, tasks, milestones: resolved }), ...comments];
}
