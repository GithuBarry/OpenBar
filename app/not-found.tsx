import Link from "next/link";
import { GitBranch } from "lucide-react";

export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center bg-canvas px-6">
      <div className="text-center">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-accent text-accent-ink">
          <GitBranch size={22} />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Not found</h1>
        <p className="mt-2 text-muted">That page or project doesn’t exist.</p>
        <Link href="/" className="btn-primary mt-6">
          Back to projects
        </Link>
      </div>
    </div>
  );
}
