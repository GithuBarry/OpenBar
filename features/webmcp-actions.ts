"use client";

/**
 * Client bridge for server actions used by page-scoped WebMCP tools.
 *
 * The tool contracts remain browser-safe. Next turns these imported actions
 * into callable server references when a page registers its tools.
 */
import {
  applyConversionAction,
  applyRepositoryMigrationAction,
  getAgendaAction,
  getCapabilitiesAction,
  getProjectContextAction,
  getProjectStateAction,
  inspectRepositoryAction,
  patchDocumentAction,
  patchWikiPageAction,
  planRepositoryMigrationAction,
  previewConversionAction,
  readDocumentAction,
  readProjectSkillAction,
  renderPreviewAction,
  resolveProjectNavigationAction,
  searchProjectAction,
} from "@/app/actions";

export const sharedWebMcpActions = {
  getProjectState: getProjectStateAction,
  searchProject: searchProjectAction,
  resolveNavigation: resolveProjectNavigationAction,
  readProjectSkill: readProjectSkillAction,
  getProjectContext: getProjectContextAction,
  getCapabilities: getCapabilitiesAction,
  inspectRepository: inspectRepositoryAction,
  planRepositoryMigration: planRepositoryMigrationAction,
  applyRepositoryMigration: applyRepositoryMigrationAction,
  previewConversion: previewConversionAction,
  applyConversion: applyConversionAction,
  getAgenda: getAgendaAction,
};

export const documentWebMcpActions = {
  readDocument: readDocumentAction,
  patchDocument: patchDocumentAction,
  patchWikiPage: patchWikiPageAction,
  renderPreview: renderPreviewAction,
};
