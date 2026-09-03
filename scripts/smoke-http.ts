#!/usr/bin/env npx tsx

export type FetchRetryOptions = {
  timeoutMs?: number;
  intervalMs?: number;
  retryStatuses?: readonly number[];
};

const DEFAULT_RETRY_STATUSES = [502, 503, 504] as const;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: FetchRetryOptions = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? 300_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const retryStatuses = new Set(options.retryStatuses ?? DEFAULT_RETRY_STATUSES);
  const deadline = Date.now() + timeoutMs;

  while (true) {
    let response: Response;
    try {
      response = await fetch(input, init);
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await wait(Math.min(intervalMs, Math.max(1, deadline - Date.now())));
      continue;
    }

    if (!retryStatuses.has(response.status) || Date.now() >= deadline) return response;
    await response.body?.cancel();
    await wait(Math.min(intervalMs, Math.max(1, deadline - Date.now())));
  }
}
