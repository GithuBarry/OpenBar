type EditIntentEvent = {
  type: string;
  currentTarget: Element;
  target: EventTarget | null;
  clientX?: number;
  clientY?: number;
  key?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  clipboardData?: { types: readonly string[] };
  dataTransfer?: { files?: { length: number } };
};

const DISABLED_EDIT_CONTROL = "button:disabled, input:disabled, textarea:disabled, select:disabled, [aria-disabled=true]";
const IGNORED_CONTROLS = "[data-resume-edit], [data-backend-connection], [data-ob-modal], .react-flow__controls, [data-nav-only]";

function isDisabledEditElement(el: Element): boolean {
  if (el.closest(IGNORED_CONTROLS)) return false;
  if (el.closest('button[aria-label^="Collapse"], button[aria-label^="Expand"]')) return false;
  if (el.closest(DISABLED_EDIT_CONTROL)) return true;
  return Boolean(el.closest("fieldset:disabled") && el.closest("button, input, textarea, select, label, [role=button], [role=slider]"));
}

/** Recognize write gestures while keeping map navigation and text selection available. */
export function isLockedMindmapEditIntent(event: EditIntentEvent): boolean {
  const target = event.target;
  if (!(target instanceof Element) || target.closest("[data-resume-edit], [data-backend-connection], [data-ob-modal]")) return false;

  if (event.type === "pointerdown") {
    if (isDisabledEditElement(target)) return true;
    // Browsers often retarget pointerdown on disabled controls to their parent container; inspect elements under the pointer.
    if (typeof document !== "undefined" && typeof event.clientX === "number" && typeof event.clientY === "number") {
      const hit = document.elementsFromPoint(event.clientX, event.clientY);
      for (const el of hit) {
        if (el === event.currentTarget) break;
        if (isDisabledEditElement(el)) return true;
      }
    }
    return false;
  }

  if (!event.currentTarget.contains(target)) return false;

  if (event.type === "dblclick") {
    return Boolean(target.closest("[data-mind-node]")
      && !target.closest("button, a, input, textarea, select, summary, nav, [data-card-images], .cm-editor"));
  }
  if (event.type === "drop") {
    return Boolean(event.dataTransfer?.files?.length);
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
