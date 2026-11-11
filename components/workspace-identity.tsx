import type { WorkspaceSettings } from "@/lib/workspace";

/** The workspace name and tagline are fixed display text. */
export function WorkspaceIdentity({ workspace }: { workspace: WorkspaceSettings }) {
  return (
    <div className="ob-workspace-identity flex min-w-0 flex-col">
      <div className="ob-workspace-name truncate text-ink">{workspace.name}</div>
      {workspace.tagline && (
        <>
          <div className="ob-workspace-tagline ob-workspace-tagline-full truncate text-muted">{workspace.tagline}</div>
          <div className="ob-workspace-tagline ob-workspace-tagline-compact truncate text-muted">
            {workspace.tagline.length > 20 ? "Serving Draft" : workspace.tagline}
          </div>
        </>
      )}
    </div>
  );
}
