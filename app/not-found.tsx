import Link from "next/link";

import { WorkspaceMark } from "@/components/workspace-mark";
import { getWorkspaceSettings } from "@/lib/workspace";

export default function NotFound() {
  const workspace = getWorkspaceSettings();

  return (
    <main className="min-h-screen bg-canvas px-6 py-6">
      <WorkspaceMark name={workspace.name} tagline={workspace.tagline} compactTagline="Serving Draft" />
      <div className="grid min-h-[70vh] place-items-center">
        <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Not found</h1>
        <p className="mt-2 text-muted">That page or project doesn’t exist.</p>
        <Link href="/" className="btn-primary mt-6">
          Back to projects
        </Link>
        </div>
      </div>
    </main>
  );
}
