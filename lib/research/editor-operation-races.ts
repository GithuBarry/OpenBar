/** Small ordering helpers shared by browser editors with asynchronous mutations. */

export type LiveEditorSnapshot = {
  source: string;
  revision: number;
};

export function hasLiveEditorChanged(before: LiveEditorSnapshot, current: LiveEditorSnapshot): boolean {
  return before.revision !== current.revision || before.source !== current.source;
}

export function removeSourceRange(source: string, from: number, to: number): string {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > source.length) return source;
  return `${source.slice(0, from)}${source.slice(to)}`;
}

export function requireAppliedRemovalSource(
  applied: boolean | undefined,
  source: string | undefined,
  todoId: string,
  hasTodo: (source: string, todoId: string) => boolean,
): string {
  if (!applied || source === undefined || hasTodo(source, todoId)) {
    throw Object.assign(
      new Error("The live paper editor did not accept the TODO removal. Reload the paper before saving."),
      { code: "stale_live_state" },
    );
  }
  return source;
}

export async function flushBeforeOperation<T>(
  flush: () => Promise<void>,
  operation: () => Promise<T>,
): Promise<T> {
  await flush();
  return operation();
}
