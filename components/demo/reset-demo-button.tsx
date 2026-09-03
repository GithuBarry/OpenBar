"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LoaderCircle, RotateCcw } from "lucide-react";

export function ResetDemoButton({ slug }: { slug: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reset() {
    if (!window.confirm("Reset the shared demo to its original papers and maps?")) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/demo/reset", { method: "POST" });
      const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Could not reset the demo.");
      router.push(`/p/${encodeURIComponent(slug)}/paper`);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not reset the demo.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button type="button" className="btn-outline text-xs" onClick={() => void reset()} disabled={pending}>
        {pending ? <LoaderCircle size={12} className="animate-spin" /> : <RotateCcw size={12} />}
        Reset demo
      </button>
      {error && <span className="max-w-48 text-[11px] text-danger" role="alert">{error}</span>}
    </div>
  );
}
