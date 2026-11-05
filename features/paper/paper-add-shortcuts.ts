import { DEFAULT_COMMENT_KINDS } from "@/lib/comment-kinds";

type AddAction = "comment" | "todo";

export function paperAddShortcut(action: AddAction, mac: boolean, kind?: string) {
  const preset = action === "comment" && kind !== undefined
    ? DEFAULT_COMMENT_KINDS.findIndex(item => item.value === kind.trim().toLowerCase())
    : -1;
  if (preset >= 0) {
    const digit = preset + 1;
    return {
      label: mac ? `⌘⌥${digit}` : `Ctrl+Alt+${digit}`,
      aria: `${mac ? "Meta" : "Control"}+Alt+${digit}`,
    };
  }
  const modifier = action === "comment" ? "Shift" : "Alt";
  return {
    label: mac ? `⌘${action === "comment" ? "⇧" : "⌥"}↵` : `Ctrl+${modifier}+Enter`,
    aria: `${mac ? "Meta" : "Control"}+${modifier}+Enter`,
  };
}

export function handlePaperAddShortcut(event: KeyboardEvent, actions: { comment: (kind?: string) => void; todo: () => void }): boolean {
  if (event.defaultPrevented || event.isComposing || event.repeat || event.getModifierState("AltGraph")) return false;
  if (event.ctrlKey === event.metaKey || event.shiftKey === event.altKey) return false;
  if (event.key === "Enter") {
    event.preventDefault();
    if (event.shiftKey) actions.comment();
    else actions.todo();
    return true;
  }
  if (!event.altKey) return false;
  const digit = /^Digit([1-5])$/.exec(event.code)
    || (!event.code ? /^([1-5])$/.exec(event.key) : null);
  if (!digit) return false;
  event.preventDefault();
  actions.comment(DEFAULT_COMMENT_KINDS[Number(digit[1]) - 1].value);
  return true;
}
