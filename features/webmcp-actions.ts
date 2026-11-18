"use client";

/**
 * Client bridge for server actions used by page-scoped WebMCP tools.
 *
 * The tool contracts remain browser-safe. Next turns these imported actions
 * into callable server references when a page registers its tools.
 */
import {
  syncProjectReviewAction,
  getProjectStateAction,
  listWorkspaceProjectsAction,
  getWorkspaceLayoutAction,
  moveWorkspaceProjectToolAction,
  openWorkspaceProjectAction,
  readProjectSkillAction,
  resolveProjectNavigationAction,
  searchWorkspaceProjectsAction,
  updateProjectAction,
  readProjectFilesAction,
  applyProjectEditsAction,
  writeWorkspaceAgentsMdAction,
} from "@/app/actions";
import { runProjectFileOperation } from "./project-files-bridge";
import type { ProjectFilesReadInput, ProjectFilesEditInput } from "@/lib/research/project-files-contract";
import type { WorkspaceInstructionsPatch } from "@/lib/research/webmcp-shared-contract";
import { okResult } from "@/lib/research/operation-result";

export const sharedWebMcpActions = {
  updateWorkspaceInstructions: (project: string, input: WorkspaceInstructionsPatch) => runProjectFileOperation(project, true, async () => okResult(await writeWorkspaceAgentsMdAction(input.body, input.expectedHash))),
  readProjectFiles: (project: string, input: ProjectFilesReadInput) => runProjectFileOperation(project, false, () => readProjectFilesAction(project, input)),
  applyProjectEdits: (project: string, input: ProjectFilesEditInput, actor: "human" | "webmcp" = "webmcp") => runProjectFileOperation(project, !input.dryRun, () => applyProjectEditsAction(project, input, actor)),
  syncProject: syncProjectReviewAction,
  getProjectState: getProjectStateAction,
  resolveNavigation: resolveProjectNavigationAction,
  readProjectSkill: readProjectSkillAction,
  updateProject: updateProjectAction,
};

export const workspaceWebMcpActions = {
  listProjects: listWorkspaceProjectsAction,
  getWorkspaceLayout: getWorkspaceLayoutAction,
  moveProject: moveWorkspaceProjectToolAction,
  searchProjects: searchWorkspaceProjectsAction,
  openProject: openWorkspaceProjectAction,
};
