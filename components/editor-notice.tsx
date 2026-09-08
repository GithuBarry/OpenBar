"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import * as Popover from "@radix-ui/react-popover"
import { AlertCircle, Check, ChevronDown, Copy, LockKeyhole, X } from "lucide-react"
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
  const panelRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen
  const keepOpen = () => { clearTimeout(closeTimer.current); setOpen(true) }
  const closeSoon = () => {
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => {
      if (panelRef.current?.querySelector("dialog[open]")) return
      setOpen(false)
    }, 180)
  }
  useEffect(() => () => clearTimeout(closeTimer.current), [])
  useEffect(() => { if (open) { setCopied(false); onOpenRef.current?.() } }, [open])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${title}\nProject: ${project}\nPage: ${window.location.href}\n\n${report || message}`)
      setCopied(true)
      setCopyError("")
    } catch { setCopyError("Select and copy the message above.") }
  }
  return <div className={styles.anchor} data-editor-notice>
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className={styles.trigger} aria-label={triggerLabel} title={message} onMouseEnter={keepOpen} onMouseLeave={closeSoon} onClick={event => { event.preventDefault(); keepOpen() }}>
          {paused ? <LockKeyhole size={13} /> : <AlertCircle size={13} />}<span>{label}</span><ChevronDown size={12} />
        </button>
      </Popover.Trigger>
      <Popover.Portal><Popover.Content ref={panelRef} onMouseEnter={keepOpen} onMouseLeave={closeSoon} onOpenAutoFocus={event => event.preventDefault()} className={styles.panel} side="bottom" align="center" sideOffset={8} collisionPadding={12} aria-label={title}>
        <header><strong>{title}</strong><Popover.Close aria-label="Close error details"><X size={15} /></Popover.Close></header>
        <p role="status">{message}</p>
        {children}
        <button type="button" className={styles.copy} onClick={() => void copy()}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? "Copied" : "Copy error for agent"}</button>
        {copyError && <p role="status">{copyError}</p>}
      </Popover.Content></Popover.Portal>
    </Popover.Root>
  </div>
}
