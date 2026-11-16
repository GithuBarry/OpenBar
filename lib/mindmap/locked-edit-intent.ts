type EditIntentEvent = {
  type: string;
  currentTarget: Element;
  target: EventTarget | null;
  key?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  clipboardData?: { types: readonly string[] };
};

/** Recognize write gestures while keeping map navigation and text selection available. */
export function isLockedMindmapEditIntent(event: EditIntentEvent): boolean {
  const target = event.target;
  if (!(target instanceof Element) || !event.currentTarget.contains(target)
    || target.closest("[data-resume-edit], [data-backend-connection], [data-ob-modal]")) return false;

  if (event.type === "pointerdown") {
    if (target.closest(".react-flow__controls")) return false;
    return Boolean(target.closest("button:disabled, input:disabled, textarea:disabled, select:disabled, [aria-disabled=true]")
      || (target.closest("fieldset:disabled") && target.closest("button, input, textarea, select, label, [role=button], [role=slider]")));
  }
  if (event.type === "dblclick") {
    return Boolean(target.closest("[data-mind-node]")
      && !target.closest("button, a, input, textarea, select, summary, nav, [data-card-images], .cm-editor"));
  }

  const textControl = target.closest("input, textarea, select, [contenteditable], .cm-editor");
  const readonlyText = Boolean(textControl && (textControl.matches("[readonly], :disabled")
    || textControl.closest(".cm-editor, fieldset:disabled") || textControl.getAttribute("contenteditable") === "false"));
  if (textControl && !readonlyText) return false;
  if (!target.closest("[data-mind-node], .mindmap-viewport, #mindmap-card-menu")) return false;
  if (event.type === "paste") return Boolean(event.clipboardData?.types.length);
  if (event.type !== "keydown") return false;

  const key = event.key || "";
  if (event.metaKey || event.ctrlKey) return !event.altKey && ["s", "z", "y", "v", "x", "b", "i"].includes(key.toLowerCase());
  if (readonlyText) return !event.altKey && (key.length === 1 || ["Enter", "Backspace", "Delete"].includes(key));
  if (target.closest("button, a, input, textarea, select, summary, nav, #mindmap-card-menu")) return false;
  if (event.altKey) return ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key);
  return ["tab", "enter", "backspace", "delete", "e"].includes(key.toLowerCase());
}
