"use client";

import { useEffect, useRef } from "react";
import { useProjectWriteSession } from "@/components/project-session/project-write-session";
import { buildSessionWebMcpTools } from "@/lib/research/webmcp-session-contract";
import { registerWebMcpToolsIndependent, waitForModelContext } from "@/lib/research/webmcp-register";

export function SessionWebMcp({ disabled = false }: { disabled?: boolean }) {
  const session = useProjectWriteSession();
  const sessionRef = useRef(session);
  sessionRef.current = session;
  useEffect(() => {
    if (disabled) return;
    const controller = new AbortController();
    let release: (() => void) | undefined;
    void (async () => {
      const modelContext = await waitForModelContext(30_000, controller.signal);
      if (!modelContext || controller.signal.aborted) return;
      const registration = await registerWebMcpToolsIndependent(modelContext, buildSessionWebMcpTools({
        inspect: () => sessionRef.current.inspect(),
        resumeEdit: generation => sessionRef.current.resumeEdit(generation),
        pendingLocalWork: () => sessionRef.current.pendingLocalWork,
        canRelease: () => sessionRef.current.canRelease,
        release: () => sessionRef.current.release(),
      }), controller.signal, "shared");
      release = registration.release;
      if (controller.signal.aborted) release();
    })();
    return () => { controller.abort(); release?.(); };
  }, [disabled]);
  return null;
}
