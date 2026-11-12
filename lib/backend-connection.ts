const transportErrors = new WeakSet<object>();

export function markBackendTransportError(reason: unknown): Error {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  transportErrors.add(error);
  return error;
}

export function isBackendTransportError(reason: unknown): boolean {
  return typeof reason === "object" && reason !== null && transportErrors.has(reason);
}
