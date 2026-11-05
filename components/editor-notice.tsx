"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import * as Popover from "@radix-ui/react-popover"
import { PopoverSurface } from "./pop"
import { AlertCircle, Check, ChevronDown, Copy, Download, LockKeyhole, X } from "lucide-react"
import { copyText } from "@/lib/copy-text"
import styles from "./overleaf-sync-notice.module.css"

type Props = {
  project: string
  title: string
  label: string
  message: string
  report?: string
  paused?: boolean
  triggerLabel?: string
  onOpen?: () => void
  children?: ReactNode
}

/** One floating, accessible design for editor errors and synchronization conflicts. */
export function EditorNotice({ project, title, label, message, report, paused, triggerLabel = "Editor conflict details", onOpen, children }: Props) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState("")
  const [copying, setCopying] = useState(false)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const [capturedAt, setCapturedAt] = useState("")
  const panelRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const onOpenRef = useRef(onOpen)
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
  useEffect(() => { if (open) { setCopied(false); setCopyError(""); setCapturedAt(new Date().toISOString()); onOpenRef.current?.() } }, [open])
  useEffect(() => { setCopied(false) }, [message, report])
  const diagnosticReport = open && typeof window !== "undefined" ? [
    "OpenBar diagnostic report",
    `Title: ${title}`,
    `Project: ${project}`,
    `Page: ${window.location.origin}${window.location.pathname}`,
    `Captured: ${capturedAt || new Date().toISOString()}`,
    `Browser: ${navigator.userAgent}`,
    `Secure context: ${window.isSecureContext}`,
    `Online: ${navigator.onLine}`,
    `Editing paused: ${Boolean(paused)}`,
    `\nMessage:\n${message}`,
    report ? `\nOperation diagnostics:\n${report}` : "",
    copyError ? `\nClipboard failure:\n${copyError}` : "",
  ].filter(Boolean).join("\n").replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[redacted]").replace(/((?:access[_-]?token|api[_-]?key|password)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1[redacted]") : ""
  const copy = async () => {
    setCopying(true)
    try {
      await copyText(diagnosticReport)
      setCopied(true)
      setCopyError("")
    } catch (error) {
      setCopied(false)
      setCopyError(error instanceof Error ? error.message : "The browser declined clipboard access.")
      setDiagnosticsOpen(true)
    } finally { setCopying(false) }
  }
  const download = () => {
    const url = URL.createObjectURL(new Blob([diagnosticReport], { type: "text/plain;charset=utf-8" }))
    const link = document.createElement("a")
    link.href = url
    link.download = `openbar-${project.replace(/[^a-z0-9_-]/gi, "-").slice(0, 64)}-diagnostics.txt`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <div className={styles.anchor} data-editor-notice>
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className={styles.trigger} aria-label={triggerLabel} title={message} onMouseEnter={keepOpen} onMouseLeave={closeSoon} onClick={event => { event.preventDefault(); keepOpen() }}>
          {paused ? <LockKeyhole size={13} /> : <AlertCircle size={13} />}<span>{label}</span><ChevronDown size={12} />
        </button>
      </Popover.Trigger>
      <PopoverSurface ref={panelRef} onMouseEnter={keepOpen} onMouseLeave={closeSoon} onOpenAutoFocus={event => event.preventDefault()} className={styles.panel} side="bottom" align="center" sideOffset={8} collisionPadding={12} aria-label={title}>
        <header><strong>{title}</strong><Popover.Close aria-label="Close error details"><X size={15} /></Popover.Close></header>
        <p className={styles.message} role="status">{message}</p>
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
  </div>
}
