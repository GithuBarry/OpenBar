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
  inspectRepositoryAction,
  patchDocumentAction,
  patchWikiPageAction,
  planRepositoryMigrationAction,
  previewConversionAction,
  readDocumentAction,
  renderPreviewAction,
} from "@/app/actions";

export const sharedWebMcpActions = {
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
