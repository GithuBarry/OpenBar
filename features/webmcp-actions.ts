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
} from "@/app/actions";
import { runProjectFileOperation } from "./project-files-bridge";
import type { ProjectFilesReadInput, ProjectFilesEditInput } from "@/lib/research/project-files-contract";

export const sharedWebMcpActions = {
  readProjectFiles: (project: string, input: ProjectFilesReadInput) => runProjectFileOperation(project, false, () => readProjectFilesAction(project, input)),
  applyProjectEdits: (project: string, input: ProjectFilesEditInput) => runProjectFileOperation(project, !input.dryRun, () => applyProjectEditsAction(project, input)),
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
