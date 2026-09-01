/**
 * Bounded external process runner for Pandoc, Git, and TeX.
 */

import { spawn } from "node:child_process";

export type RunToolOptions = {
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  env?: NodeJS.ProcessEnv;
  input?: string;
};

export type RunToolResult = {
  ok: boolean;
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
};

export async function runTool(bin: string, args: string[], options: RunToolOptions = {}): Promise<RunToolResult> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxOutputBytes = options.maxOutputBytes ?? 2_000_000;
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const take = (current: string, chunk: Buffer): string => {
      const next = current + chunk.toString("utf8");
      if (Buffer.byteLength(next, "utf8") <= maxOutputBytes) return next;
      truncated = true;
      return Buffer.from(next, "utf8").subarray(0, maxOutputBytes).toString("utf8");
    };
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = take(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = take(stderr, chunk);
    });
    if (options.input) child.stdin.end(options.input, "utf8");
    else child.stdin.end();
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 3_000);
    }, timeoutMs);
    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      resolve({
        ok: !timedOut && code === 0,
        code,
        signal,
        stdout,
        stderr,
        durationMs: Date.now() - started,
        timedOut,
        truncated,
      });
    };
    child.on("error", (error) => {
      stderr = (error as NodeJS.ErrnoException).code === "ENOENT" ? `${bin} is not installed` : error.message;
      finish(null, null);
    });
    child.on("close", finish);
  });
}

export function toolFailureExcerpt(result: RunToolResult, category: string): {
  category: string;
  exitStatus: number | null;
  durationMs: number;
  excerpt: string;
} {
  const blob = `${result.stderr}\n${result.stdout}`.trim();
  return {
    category,
    exitStatus: result.timedOut ? 124 : result.code,
    durationMs: result.durationMs,
    excerpt: blob.slice(-2_000),
  };
}
