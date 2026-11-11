import type { OverleafConflictChoice, OverleafPullReview } from "@/lib/tex-project/overleaf-git";

type PrepareResult = { ok: true; review: OverleafPullReview } | { ok: false; message: string };
type FinishResult = { ok: boolean; message: string; applied?: boolean };
type PrepareRequest = { action: "prepare" };
type FinishRequest = { action: "finish"; token: string; choices: OverleafConflictChoice[]; cancel?: boolean };

export function requestGitReview(project: string, input: PrepareRequest, onLog?: (line: string) => void): Promise<PrepareResult>;
export function requestGitReview(project: string, input: FinishRequest): Promise<FinishResult>;
export async function requestGitReview(project: string, input: PrepareRequest | FinishRequest, onLog?: (line: string) => void): Promise<PrepareResult | FinishResult> {
  let response: Response;
  try {
    response = await fetch(`/api/p/${encodeURIComponent(project)}/git/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input.action === "prepare" && onLog ? { ...input, stream: true } : input),
      cache: "no-store",
    });
  } catch {
    throw new Error("The Git review request could not reach OpenBar. Check your connection and try again.");
  }
  const contentType = response.headers.get("content-type") || "unknown content type";
  let body: unknown;
  if (response.ok && contentType.toLowerCase().includes("ndjson")) {
    if (!response.body) throw new Error("Git review received an empty response stream.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalResult: unknown;
    let receivedResult = false;
    const readLine = (line: string) => {
      if (!line.trim()) return;
      let record: { type?: unknown; line?: unknown; result?: unknown; message?: unknown };
      try { record = JSON.parse(line); }
      catch { throw new Error("Git review received an invalid progress update."); }
      if (!record || typeof record !== "object") throw new Error("Git review received an invalid progress update.");
      if (record.type === "log" && typeof record.line === "string") onLog?.(record.line);
      else if (record.type === "started" || record.type === "heartbeat") return;
      else if (record.type === "result") { finalResult = record.result; receivedResult = true; }
      else if (record.type === "error") throw new Error(typeof record.message === "string" ? record.message : "Git review failed.");
      else throw new Error("Git review received an invalid progress update.");
    };
    try {
      for (;;) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) readLine(line);
        if (done) break;
      }
      if (buffer.trim()) readLine(buffer);
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    } finally { reader.releaseLock(); }
    if (!receivedResult) throw new Error("The Git review connection ended before the result arrived.");
    body = { result: finalResult };
  } else {
    const source = await response.text();
    try { body = JSON.parse(source); }
    catch {
      const text = contentType.toLowerCase().startsWith("text/plain") ? source.trim().slice(0, 500) : "";
      const detail = response.redirected ? " The request was redirected. Check your sign-in session." : "";
      throw new Error(`Git review received an invalid server response (HTTP ${response.status}, ${contentType}).${text ? ` ${text}` : ""}${detail}`);
    }
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error(`Git review received an invalid server response (HTTP ${response.status}).`);
  const value = body as { error?: unknown; result?: unknown };
  if (!response.ok) {
    throw new Error(typeof value.error === "string" && value.error.trim() ? `${value.error} (HTTP ${response.status})` : `Git review failed (HTTP ${response.status}).`);
  }
  if (!value.result || typeof value.result !== "object" || typeof (value.result as { ok?: unknown }).ok !== "boolean") {
    throw new Error(`Git review received an incomplete server response (HTTP ${response.status}).`);
  }
  const result = value.result as { ok: boolean; message?: unknown; review?: unknown };
  if ((!result.ok && typeof result.message !== "string") || (input.action === "finish" && typeof result.message !== "string")) {
    throw new Error(`Git review received an incomplete server response (HTTP ${response.status}).`);
  }
  if (input.action === "prepare" && result.ok) {
    const review = result.review as Partial<OverleafPullReview> | null;
    if (!review || typeof review !== "object" || typeof review.token !== "string" || typeof review.localCommit !== "string"
      || typeof review.remoteCommit !== "string" || !Array.isArray(review.files) || !Array.isArray(review.conflicts)) {
      throw new Error(`Git review received an incomplete server response (HTTP ${response.status}).`);
    }
  }
  return value.result as PrepareResult | FinishResult;
}
