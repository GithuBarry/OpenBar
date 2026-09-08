"use client"

import { useEffect, useRef } from "react"
import { buildDocumentWebMcpTools, type DocumentWebMcpHost } from "@/lib/research/webmcp-document-contract"
import { registerWebMcpToolsIndependent, waitForModelContext } from "@/lib/research/webmcp-register"

export function useWikiWebMcp(host: DocumentWebMcpHost): void {
  const latest = useRef(host)
  latest.current = host
  useEffect(() => {
    const controller = new AbortController()
    let release: (() => void) | undefined
    void (async () => {
      const context = await waitForModelContext(30_000, controller.signal)
      if (!context || controller.signal.aborted) return
      const tools = buildDocumentWebMcpTools(latest.current).filter(tool => tool.annotations.readOnlyHint)
      const registration = await registerWebMcpToolsIndependent(context, tools, controller.signal, "wiki")
      release = registration.release
      if (controller.signal.aborted) release()
    })()
    return () => { controller.abort(); release?.() }
  }, [host.project, host.documentId])
}
