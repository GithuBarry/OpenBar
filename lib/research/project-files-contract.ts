import { z } from "zod";

const projectPath = z.string().min(1).max(1024).describe("Path relative to the current project root. OpenBar state and Git metadata are protected.");
export const READ_PROJECT_FILES_INPUT = z.strictObject({
  paths: z.array(projectPath).min(1).max(100).optional().describe("Files to read or directories to list. Defaults to the project root."),
  offset: z.number().int().min(0).optional().describe("Byte offset for bounded file reads."),
  maxBytes: z.number().int().min(1).max(2_000_000).optional().describe("Total file content bytes to return, default 100000."),
  limit: z.number().int().min(1).max(2000).optional().describe("Maximum directory entries, default 200."),
});
export const APPLY_PROJECT_EDITS_INPUT = z.strictObject({
  edits: z.array(z.strictObject({
    path: projectPath,
    expectedHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().describe("Exact SHA256 from read_project_files. null requires a new file."),
    content: z.string().nullable().describe("Complete file content. null deletes an existing file. Move files with one batch that creates the destination and deletes the source."),
    encoding: z.enum(["utf8", "base64"]).optional().describe("Content encoding, default utf8. Use base64 for binary files."),
  })).min(1).max(100),
  dryRun: z.boolean().optional().describe("Validate the complete batch and return planned changes before writing."),
});

export type ProjectFilesReadInput = z.infer<typeof READ_PROJECT_FILES_INPUT>;
export type ProjectFilesEditInput = z.infer<typeof APPLY_PROJECT_EDITS_INPUT>;
export type ProjectFileEntry = { path: string; kind: "file" | "directory"; bytes?: number; hash?: string; content?: string; encoding?: "utf8" | "base64"; offset?: number; truncated?: boolean };
export type ProjectFilesRead = { entries: ProjectFileEntry[]; hasMore: boolean };
export type ProjectFilesEditReceipt = { files: Array<{ path: string; previousHash: string | null; hash: string | null; bytes: number }>; dryRun: boolean; derivedFiles?: string[] };

/** Authored files share a root capability while OpenBar and Git own their state. */
export function isProtectedProjectPath(relative: string, prefix = false): boolean {
  const parts = relative.replaceAll("\\", "/").toLowerCase().split("/").filter(Boolean);
  return parts.some((part, index) => part === ".git" || ([".openbar", "openbar"].includes(part)
    && !(prefix && index === parts.length - 1) && !["skills", "wiki"].includes(parts[index + 1] || "")))
    || (parts.at(-1) === "openbar-references.tex" && (parts.length === 1 || (parts.length === 2 && parts[0] === "manuscript")));
}
