export type TodoCardRecovery = {
  todoId: string;
  title: string;
  body: string;
  sourceHash: string;
};

export function todoCardRecoveryKey(project: string, todoId: string): string {
  return `openbar:todo-card-recovery:v1:${encodeURIComponent(project)}:${encodeURIComponent(todoId)}`;
}

export function readTodoCardRecovery(storage: Pick<Storage, "getItem">, project: string, todoId: string): TodoCardRecovery | null {
  try {
    const value = JSON.parse(storage.getItem(todoCardRecoveryKey(project, todoId)) || "null");
    return value?.version === 1 && value.todoId === todoId && typeof value.title === "string" && typeof value.body === "string"
      && typeof value.sourceHash === "string" && /^[a-f0-9]{64}$/i.test(value.sourceHash)
      ? { todoId, title: value.title, body: value.body, sourceHash: value.sourceHash } : null;
  } catch { return null; }
}

export function writeTodoCardRecovery(storage: Pick<Storage, "setItem">, project: string, value: TodoCardRecovery): void {
  try { storage.setItem(todoCardRecoveryKey(project, value.todoId), JSON.stringify({ version: 1, ...value })); }
  catch { /* The mounted map retains its recovery copy while storage is unavailable. */ }
}
