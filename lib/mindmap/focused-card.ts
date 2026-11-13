/** The card whose editable input currently owns browser focus. */
export function focusedMindmapCardId(selectedId?: string, ownerDocument: Document | undefined = typeof document === "undefined" ? undefined : document): string | undefined {
  const active = ownerDocument?.activeElement;
  if (!active || !(active instanceof HTMLElement)) return;
  const input = active.closest<HTMLElement>('textarea, input, [contenteditable="true"], [contenteditable="plaintext-only"]');
  if (!input || input.matches(':disabled, [readonly], [aria-readonly="true"], [type="search"], [role="searchbox"]')
    || input.closest('[inert], [aria-readonly="true"], [role="search"]')) return;
  if (input instanceof HTMLInputElement && !["text", "url", "email", "tel", "password", "number"].includes(input.type)) return;
  if (!(input instanceof HTMLInputElement) && !(input instanceof HTMLTextAreaElement) && !active.isContentEditable) return;
  return input.closest<HTMLElement>("[data-mind-node]")?.dataset.mindNode
    || (input.closest("#mindmap-card-menu") ? selectedId : undefined);
}
