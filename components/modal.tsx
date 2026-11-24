"use client"

import { useRef, type ReactNode, type ReactElement } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { cn } from "@/lib/utils"

export function Modal({ open, onClose, title, children, className, busy = false, closeOnBackdropClick = false, trigger }: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  className?: string
  busy?: boolean
  closeOnBackdropClick?: boolean
  trigger?: ReactElement
}) {
  const previousFocus = useRef<HTMLElement | null>(null)
  return <Dialog.Root open={open} onOpenChange={next => { if (!next && !busy) onClose() }}>
    {trigger && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}
    <Dialog.Portal>
      <Dialog.Overlay className="ob-modal-backdrop" onClick={closeOnBackdropClick ? event => {
        // A parent of the portal can stop the outside pointer event.
        event.stopPropagation()
        if (event.target === event.currentTarget && !busy) onClose()
      } : undefined} />
      <Dialog.Content className={cn("p-dialog ob-modal", className)} aria-describedby={undefined} data-ob-modal
        onOpenAutoFocus={() => { previousFocus.current = document.activeElement as HTMLElement | null }}
        onCloseAutoFocus={trigger ? undefined : event => { event.preventDefault(); previousFocus.current?.focus() }}>
        <Dialog.Title className="sr-only">{title}</Dialog.Title>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}
