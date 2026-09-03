import { WorkspaceMark } from "@/components/workspace-mark";
import { getWorkspaceSettings } from "@/lib/workspace";

export default function UnauthorizedPage() {
  const workspace = getWorkspaceSettings();

  return (
    <main className="min-h-screen bg-canvas px-6 py-6">
      <WorkspaceMark name={workspace.name} tagline={workspace.tagline} compactTagline="Serving Draft" />
      <div className="mx-auto max-w-lg space-y-3 pt-20">
        <h1 className="font-serif text-2xl font-semibold">401 — Unauthorized</h1>
        <p className="text-sm text-muted">
          This workbench requires a verified Cloudflare Access identity or a bearer token.
        </p>
      </div>
    </main>
  );
}
