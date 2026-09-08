import type { Mindmap, MindmapNode } from "@/lib/types";

/** The bounded commit shape returned by the existing Git history action. */
export type MindmapInfoGitCommit = {
  hash: string;
  message: string;
  author: string;
  date: string;
  files: string[];
};

export type MindmapInfoMetadata = {
  target: {
    kind: "mindmap" | "mindmap-node";
    id: string;
    todoId?: string;
  };
  /** Dates authored in the persisted map record. */
  authored: {
    createdAt?: string;
    updatedAt?: string;
  };
  /** The latest bounded Git row, kept separate from authored dates. */
  git?: {
    source: "git-history";
    scope: "project";
    hash: string;
    author: string;
    message: string;
    commitDate: string;
    files: string[];
  };
};

const MAX_PROVENANCE_FILES = 8;
const MAX_TEXT_CHARS = 240;

type MindmapInfoMap = Pick<Mindmap, "id" | "createdAt" | "updatedAt">;
type MindmapInfoNode = Pick<MindmapNode, "id" | "todoId" | "createdAt" | "updatedAt">;

function validDate(value: string | undefined): string | undefined {
  if (!value || !Number.isFinite(Date.parse(value))) return undefined;
  return value;
}

function boundedText(value: string | undefined): string {
  return (value || "").trim().slice(0, MAX_TEXT_CHARS);
}

/**
 * Select the newest valid row from the existing bounded Git history read.
 * The existing Git history action supplies the rows and their commit dates.
 */
export function latestMindmapGitProvenance(
  history: readonly MindmapInfoGitCommit[] | undefined,
): MindmapInfoMetadata["git"] {
  const latest = (history || [])
    .filter((commit) => typeof commit.hash === "string" && validDate(commit.date))
    .slice()
    .sort((left, right) => Date.parse(right.date) - Date.parse(left.date))[0];
  if (!latest) return undefined;

  return {
    source: "git-history",
    scope: "project",
    hash: latest.hash,
    author: boundedText(latest.author),
    message: boundedText(latest.message),
    commitDate: latest.date,
    files: (latest.files || []).filter((file) => typeof file === "string").slice(0, MAX_PROVENANCE_FILES),
  };
}

/**
 * Build the read-only metadata shown for a map or selected card.
 * Persisted map/card timestamps stay under `authored`. Git committer time stays
 * under `git.commitDate`, so repository provenance never becomes an authored
 * creation or edit date. The existing history action remains the sole Git read.
 */
export function buildMindmapInfoMetadata(
  map: MindmapInfoMap,
  node?: MindmapInfoNode | null,
  history?: readonly MindmapInfoGitCommit[],
): MindmapInfoMetadata {
  const target = node
    ? {
        kind: "mindmap-node" as const,
        id: node.id,
        ...(node.todoId ? { todoId: node.todoId } : {}),
        createdAt: node.createdAt,
        updatedAt: node.updatedAt,
      }
    : {
        kind: "mindmap" as const,
        id: map.id || "draft",
        createdAt: map.createdAt,
        updatedAt: map.updatedAt,
      };

  const authored = {
    ...(validDate(target.createdAt) ? { createdAt: target.createdAt } : {}),
    ...(validDate(target.updatedAt) ? { updatedAt: target.updatedAt } : {}),
  };

  const git = latestMindmapGitProvenance(history);
  return {
    target: {
      kind: target.kind,
      id: target.id,
      ...(("todoId" in target && target.todoId) ? { todoId: target.todoId } : {}),
    },
    authored,
    ...(git ? { git } : {}),
  };
}
