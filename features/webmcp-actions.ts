"use client";

/**
 * Client bridge for server actions used by page-scoped WebMCP tools.
 *
 * The tool contracts remain browser-safe. Next turns these imported actions
 * into callable server references when a page registers its tools.
 */
import {
  syncProjectReviewAction,
  applyConversionAction,
  deleteProjectSkillAction,
  deleteWikiPageAction,
  deleteWorkspaceSkillAction,
  getCapabilitiesAction,
  getProjectStateAction,
  listWorkspaceProjectsAction,
  getWorkspaceLayoutAction,
  moveWorkspaceProjectToolAction,
  openWorkspaceProjectAction,
  inspectRepositoryAction,
  patchDocumentAction,
  patchWikiPageAction,
  previewConversionAction,
  readDocumentAction,
  readProjectSkillAction,
  renderPreviewAction,
  renameWikiPageAction,
  resolveProjectNavigationAction,
  saveWikiAction,
  searchWorkspaceProjectsAction,
  searchProjectAction,
  updateProjectAction,
  writeAgentsMdAction,
  writeProjectSkillAction,
  writeWorkspaceAgentsMdAction,
  writeWorkspaceSkillAction,
} from "@/app/actions";

export const sharedWebMcpActions = {
  syncProject: syncProjectReviewAction,
  getProjectState: getProjectStateAction,
  searchProject: searchProjectAction,
  resolveNavigation: resolveProjectNavigationAction,
  readProjectSkill: readProjectSkillAction,
  getCapabilities: getCapabilitiesAction,
  inspectRepository: inspectRepositoryAction,
  previewConversion: previewConversionAction,
  applyConversion: applyConversionAction,
  updateProject: updateProjectAction,
};

export const workspaceWebMcpActions = {
  listProjects: listWorkspaceProjectsAction,
  getWorkspaceLayout: getWorkspaceLayoutAction,
  moveProject: moveWorkspaceProjectToolAction,
  searchProjects: searchWorkspaceProjectsAction,
  openProject: openWorkspaceProjectAction,
};

export const documentWebMcpActions = {
  readDocument: readDocumentAction,
  patchDocument: patchDocumentAction,
  patchWikiPage: patchWikiPageAction,
  renderPreview: renderPreviewAction,
  createWikiPage: async (project: string, slug: string, title: string, body = "") => {
    const now = new Date().toISOString();
    return saveWikiAction({
      projectId: project,
      slug,
      title,
      body,
      createdAt: now,
      updatedAt: now,
    });
  },
  deleteWikiPage: deleteWikiPageAction,
  renameWikiPage: renameWikiPageAction,
};

export const instructionsWebMcpActions = {
  writeAgentsMd: writeAgentsMdAction,
  writeProjectSkill: writeProjectSkillAction,
  deleteProjectSkill: deleteProjectSkillAction,
  writeWorkspaceAgentsMd: writeWorkspaceAgentsMdAction,
  writeWorkspaceSkill: writeWorkspaceSkillAction,
  deleteWorkspaceSkill: deleteWorkspaceSkillAction,
};
