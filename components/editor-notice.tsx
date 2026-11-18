"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import * as Popover from "@radix-ui/react-popover"
import { PopoverSurface } from "./pop"
import { AlertCircle, Check, ChevronDown, Copy, Download, LockKeyhole, X } from "lucide-react"
import { copyText } from "@/lib/copy-text"
import { useProjectWriteSession } from "./project-session/project-write-session"
import type { EditorIssue } from "@/lib/editor-issue-priority"
import styles from "./overleaf-sync-notice.module.css"

type Props = {
  project: string
  title: string
  label: string
  message: string
  report?: string
  diagnosticContext?: () => unknown
  relatedIssues?: readonly EditorIssue[]
  icon?: ReactNode
  suppressed?: boolean
  preserveContent?: boolean
  triggerClassName?: string
  paused?: boolean
  inline?: boolean
  floating?: boolean
  attentionRequest?: number
  attention?: boolean
  triggerLabel?: string
  onOpen?: () => void
  openRequest?: number
  primaryAction?: ReactNode
  children?: ReactNode
}

function captureDiagnostics(read?: () => unknown) {
  try { return read?.() }
  catch (error) { return { diagnosticCaptureError: error instanceof Error ? error.message : String(error) } }
}

function redactDiagnosticText(value: string) {
  return value.replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[redacted]").replace(/((?:access[_-]?token|api[_-]?key|password)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1[redacted]")
}

/** One floating, accessible design for editor errors and synchronization conflicts. */
export function EditorNotice({ project, title, label, message, report, diagnosticContext, relatedIssues = [], icon, suppressed = false, preserveContent = false, triggerClassName = "", paused, inline, floating, attention, attentionRequest = 0, triggerLabel = "Editor conflict details", onOpen, openRequest, primaryAction, children }: Props) {
  const { getDiagnostics } = useProjectWriteSession()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState("")
  const [copying, setCopying] = useState(false)
  const copyingRef = useRef(false)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const [capturedAt, setCapturedAt] = useState("")
  const triggerRef = useRef<HTMLButtonElement>(null)
  const lastAttentionRequest = useRef(attentionRequest)
  useEffect(() => {
    if (lastAttentionRequest.current === attentionRequest) return
    lastAttentionRequest.current = attentionRequest
    const trigger = triggerRef.current
    if (!trigger || suppressed || !paused) return
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const highlight = { boxShadow: "0 0 0 3px rgb(var(--warn) / .42)" }
    const frames = reducedMotion ? [highlight, highlight, {}] : [
      { transform: "translateY(0)" },
      { transform: "translateY(-4px)", ...highlight, offset: 0.3 },
      { transform: "translateY(1px)", offset: 0.65 },
      { transform: "translateY(0)" },
    ]
    const animation = trigger.animate(frames, { duration: 420, easing: "ease-out" })
    return () => animation.cancel()
  }, [attentionRequest, paused, suppressed])
  const panelRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const onOpenRef = useRef(onOpen)
  const lastOpenRequest = useRef(openRequest)
  onOpenRef.current = onOpen
  const keepOpen = () => { clearTimeout(closeTimer.current); setOpen(true) }
  const closeSoon = () => {
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => {
      if (document.querySelector("[data-ob-modal]") || panelRef.current?.contains(document.activeElement)) return
      setOpen(false)
    }, 180)
  }
  useEffect(() => () => clearTimeout(closeTimer.current), [])
  useEffect(() => {
    if (openRequest !== lastOpenRequest.current) {
      lastOpenRequest.current = openRequest
      clearTimeout(closeTimer.current)
      setOpen(true)
    }
  }, [openRequest])
  useEffect(() => { if (open) { setCopied(false); setCopyError(""); setCapturedAt(new Date().toISOString()); onOpenRef.current?.() } }, [open])
  useEffect(() => { setCopied(false) }, [message, report])
  const buildDiagnosticReport = (at: string) => {
    let context: string
    try {
      context = JSON.stringify({ writeSession: captureDiagnostics(getDiagnostics), editor: captureDiagnostics(diagnosticContext), relatedIssues }, (key, value) =>
        /^(?:credential|credentials|authorization|cookie|token|access[_-]?token|refresh[_-]?token|api[_-]?key|password)$/i.test(key) ? "[redacted]" : typeof value === "string" ? redactDiagnosticText(value) : value, 2)
    } catch (error) {
      context = JSON.stringify({ diagnosticCaptureError: redactDiagnosticText(error instanceof Error ? error.message : String(error)) })
    }
    const assets = Array.from(document.scripts, script => {
      try {
        const url = new URL(script.src)
        return url.origin === window.location.origin && url.pathname.includes("/_next/") ? url.pathname : ""
      } catch { return "" }
    }).filter(Boolean).slice(0, 8)
    const lines = [
      "OpenBar diagnostic report",
      "Format: 2",
      "Redaction: [redacted] marks credential patterns. Download draft contains original editor content.",
      `Title: ${title}`,
      `Project: ${project}`,
      `Page: ${window.location.origin}${window.location.pathname}`,
      `Captured: ${at}`,
      `Browser: ${navigator.userAgent}`,
      `Secure context: ${window.isSecureContext}`,
      `Online: ${navigator.onLine}`,
      `Visibility: ${document.visibilityState}`,
      `Viewport: ${window.innerWidth}x${window.innerHeight}, scale ${window.visualViewport?.scale ?? 1}`,
      `Editing paused: ${Boolean(paused)}`,
      `\nMessage:\n${message}`,
      report ? `\nOperation diagnostics:\n${report}` : "",
    ].filter(Boolean).map(redactDiagnosticText)
    lines.push(`\nStructured context:\n${context}`)
    if (assets.length) lines.push(redactDiagnosticText(`\nLoaded application assets:\n${assets.join("\n")}`))
    if (copyError) lines.push(redactDiagnosticText(`\nClipboard failure:\n${copyError}`))
    return lines.join("\n")
  }
  const diagnosticReport = open && typeof window !== "undefined" ? buildDiagnosticReport(capturedAt || new Date().toISOString()) : ""
  const copy = async () => {
    if (copyingRef.current) return
    copyingRef.current = true
    setCopying(true)
    try {
      const at = new Date().toISOString()
      setCapturedAt(at)
      await copyText(buildDiagnosticReport(at))
      setCopied(true)
      setCopyError("")
    } catch (error) {
      setCopied(false)
      setCopyError(error instanceof Error ? error.message : "The browser declined clipboard access.")
      setDiagnosticsOpen(true)
    } finally { copyingRef.current = false; setCopying(false) }
  }
  const download = () => {
    const at = new Date().toISOString()
    setCapturedAt(at)
    const url = URL.createObjectURL(new Blob([buildDiagnosticReport(at)], { type: "text/plain;charset=utf-8" }))
    const link = document.createElement("a")
    link.href = url
    link.download = `openbar-${project.replace(/[^a-z0-9_-]/gi, "-").slice(0, 64)}-diagnostics.txt`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <div className={floating ? styles.floatingAnchor : inline ? styles.inlineAnchor : styles.anchor} style={suppressed ? { display: "none" } : undefined} data-editor-notice>
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button ref={triggerRef} type="button" className={`${floating ? `${styles.inlineTrigger} ${styles.floatingTrigger}` : inline ? styles.inlineTrigger : styles.trigger} ${triggerClassName}`} data-paused={paused || undefined} data-attention={attention || undefined} aria-label={triggerLabel} title={message} onMouseEnter={keepOpen} onMouseLeave={closeSoon} onClick={event => { event.preventDefault(); keepOpen() }}>
          {icon || (paused && !inline && !floating ? <LockKeyhole size={13} /> : <AlertCircle size={13} />)}<span>{label}</span><ChevronDown size={12} />
        </button>
      </Popover.Trigger>
      <PopoverSurface ref={panelRef} data-editor-notice forceMount={preserveContent || undefined} style={suppressed || (preserveContent && !open) ? { display: "none" } : undefined} aria-hidden={suppressed || (preserveContent && !open) || undefined} onMouseEnter={keepOpen} onMouseLeave={closeSoon} onOpenAutoFocus={event => event.preventDefault()} onFocusOutside={event => {
        if (copyingRef.current || (event.target instanceof HTMLElement && event.target.getAttribute("aria-label") === "Diagnostic report clipboard transfer")) event.preventDefault()
      }} className={styles.panel} side="bottom" align="center" sideOffset={8} collisionPadding={12} aria-label={title}>
        <header><strong>{title}</strong><Popover.Close aria-label="Close error details"><X size={15} /></Popover.Close></header>
        <p className={styles.message} role="status">{message}</p>
        {relatedIssues.length > 0 && <details className={styles.changeSummary}>
          <summary>Other issues ({relatedIssues.length})</summary>
          {relatedIssues.map(issue => <div key={issue.id}><strong>{issue.title}</strong><p>{issue.message}</p></div>)}
        </details>}
        <div className={styles.footer}>
          {children && <div className={styles.recoveryActions}>{children}</div>}
          <button type="button" className={styles.copy} disabled={copying} onMouseDown={event => event.preventDefault()} onClick={() => void copy()}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? "Copied report" : copying ? "Copying…" : "Copy error for agent"}</button>
        </div>
        <details className={styles.diagnostics} open={diagnosticsOpen} onToggle={event => setDiagnosticsOpen(event.currentTarget.open)}>
          <summary>Diagnostic report</summary>
          <textarea aria-label="Diagnostic report" readOnly value={diagnosticReport} spellCheck={false} />
          <button type="button" className={styles.download} onMouseDown={event => event.preventDefault()} onClick={download}><Download size={13} />Download report</button>
        </details>
        {copyError && <p className={styles.copyError} role="status">Download the report or copy the diagnostics above. Clipboard details are included in the report.</p>}
      </PopoverSurface>
    </Popover.Root>
    {primaryAction}
  </div>
}
