/** Bounded external process execution for manuscript converters. */

import { redactSensitiveText } from "@/lib/server/git-url";

export type RunToolOptions = {
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  env?: NodeJS.ProcessEnv;
  input?: string;
  cancelSignal?: AbortSignal;
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
  const { execa } = await import("execa");
  const result = await execa(bin, args, {
    cwd: options.cwd,
    env: options.env,
    extendEnv: options.env === undefined,
    input: options.input,
    stdin: options.input === undefined ? "ignore" : "pipe",
    encoding: "buffer",
    stripFinalNewline: false,
    timeout: options.timeoutMs ?? 30_000,
    forceKillAfterDelay: 3_000,
    maxBuffer: options.maxOutputBytes ?? 2_000_000,
    cancelSignal: options.cancelSignal,
    reject: false,
  });
  return {
    ok: !result.failed,
    code: result.exitCode ?? null,
    signal: result.signal ?? null,
    stdout: (result.stdout && Buffer.from(result.stdout).toString("utf8")) || "",
    stderr: (result.stderr && Buffer.from(result.stderr).toString("utf8")) || (result.code === "ENOENT"
      ? `${bin} is not installed` : redactSensitiveText(result.originalMessage || "")),
    durationMs: result.durationMs,
    timedOut: result.timedOut,
    truncated: result.isMaxBuffer,
  };
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
