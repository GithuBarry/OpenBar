/** Copy plain text while retaining the active editor's focus and selection. */
export async function copyText(text: string): Promise<void> {
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const selection = window.getSelection()
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : []
  const input = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? active : null
  const inputSelection = input && input.selectionStart !== null ? [input.selectionStart, input.selectionEnd ?? input.selectionStart, input.selectionDirection ?? "none"] as const : null
  let nativeError: unknown
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return
    }
  } catch (error) { nativeError = error }

  const field = document.createElement("textarea")
  field.value = text
  field.readOnly = true
  field.tabIndex = -1
  field.setAttribute("aria-label", "Diagnostic report clipboard transfer")
  Object.assign(field.style, { position: "fixed", left: "0", top: "0", width: "1px", height: "1px", opacity: "0", pointerEvents: "none", fontSize: "16px" })
  document.body.appendChild(field)
  try {
    field.focus({ preventScroll: true })
    field.select()
    field.setSelectionRange(0, text.length)
    if (!document.execCommand("copy")) {
      throw new Error(nativeError instanceof Error ? nativeError.message : "The browser declined both clipboard methods.")
    }
  } finally {
    field.remove()
    if (active?.isConnected) active.focus({ preventScroll: true })
    if (selection) {
      selection.removeAllRanges()
      for (const range of ranges) {
        if (range.commonAncestorContainer.isConnected) selection.addRange(range)
      }
    }
    if (input?.isConnected && inputSelection) input.setSelectionRange(...inputSelection)
  }
}
