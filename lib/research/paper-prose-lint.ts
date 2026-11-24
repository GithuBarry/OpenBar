import type { OperationDiagnostic } from "./operation-result";

const EXTERNAL_VERSION_PREFIXES = new Set([
  "api", "nmt", "http", "https", "tls", "ssl", "usb", "cuda", "rocm", "onnx", "oauth",
  "basic", "cloud", "translation", "translate", "agentdojo", "llama", "qwen", "gemma",
  "deepseek", "gemini", "gpt", "glm", "claude", "mistral", "phi", "olmo", "kimi", "muse",
  "yolo", "squad", "glue", "superglue", "bleu", "rouge", "mmlu", "humaneval", "wildjailbreak",
  "harmbench", "advbench", "apache", "gpl", "lgpl", "mit", "cc", "python", "pytorch", "torch",
  "transformers", "vllm", "sglang", "spec", "draft", "rfc", "iso", "ieee", "cuda", "triton",
]);

function stripNonProseTex(source: string): string {
  // Remove TeX line comments (preserving escaped \%)
  let cleaned = source.replace(/(^|[^\\])%[^\n]*/g, "$1");
  // Remove \obtodo / \obcomment macros (planning annotations, not reader prose)
  cleaned = cleaned.replace(/\\ob(?:todo|comment)(?:\[[^\]]*\])?\{(?:[^{}]|\{[^{}]*\})*\}/g, " ");
  // Remove TeX labels, refs, citations, URLs, and figure file paths
  cleaned = cleaned.replace(/\\(?:label|ref|cref|Cref|eqref|pageref|cite[a-z]*|includegraphics|input|include|bibliography|bibliographystyle|url|href)(?:\[[^\]]*\])?\{[^}]*\}/g, " ");
  // Unescape LaTeX underscores so \texttt{scripts/run\_eval.py} and post\_env.json are checked cleanly
  cleaned = cleaned.replace(/\\_/g, "_");
  return cleaned;
}

export function findInternalPaperJargon(source: string): string[] {
  const prose = stripNonProseTex(source);
  const findings: string[] = [];
  const seen = new Set<string>();
  const add = (snippet: string) => {
    const clean = snippet.replace(/\s+/g, " ").trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(clean);
  };

  // 1. Explicit version comparisons or parenthetical internal tags: "v1 / v2", "(v2)", "v1 -> v2"
  for (const match of prose.matchAll(/\bv[1-9]\s*(?:\/|vs\.?|to|→|\\to)\s*v[1-9]\b(?!\.\d)/gi)) {
    add(match[0]);
  }
  for (const match of prose.matchAll(/\(\s*v[1-9](?:\s*[/,&]\s*v[1-9])*\s*\)/gi)) {
    add(match[0]);
  }

  // 2. Named internal method/pipeline version labels (e.g. "OPF v2", "Method v1", "pipeline v3")
  // Excludes semver like v1.2.2 and known external APIs/models/benchmarks.
  for (const match of prose.matchAll(/\b([A-Za-z][A-Za-z0-9_-]{1,30})\s+(v[1-9])\b(?!\.\d)/g)) {
    const prefix = match[1]!.toLowerCase();
    if (EXTERNAL_VERSION_PREFIXES.has(prefix)) continue;
    add(match[0]);
  }

  // 3. Harness scripts & internal run artifact files leaked into manuscript prose
  for (const match of prose.matchAll(/\bscripts\/[A-Za-z0-9_.-]+\.(?:py|sh|ts|js)\b/g)) {
    add(match[0]);
  }
  for (const match of prose.matchAll(/\b(?:pre_env|post_env|observations|verdict|case_result|run_manifest|spend_ledger)\.json\b/gi)) {
    add(match[0]);
  }
  for (const match of prose.matchAll(/\b[a-z][a-z0-9_]+_(?:env|result|results|log|logs|ledger|trace|traces|verdict)\.(?:json|jsonl|csv|sqlite|db)\b/g)) {
    add(match[0]);
  }

  // 4. Internal execution-log bookkeeping phrases
  for (const match of prose.matchAll(/\b(?:\d+\s+technical\s+failures?|confirmatory\s+(?:smoke|wave|waves|matrix|run|banking)|smoke\s+run|spend\s+ledgers?|trace-repaired)\b/gi)) {
    add(match[0]);
  }

  return findings;
}

function isManuscriptTexPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  if (!/\.tex$/i.test(normalized)) return false;
  if (/(?:^|\/)(?:\.openbar|openbar|wiki)\//i.test(normalized)) return false;
  return true;
}

/** Non-blocking hint when an edit introduces or retains internal version/harness jargon in manuscript TeX. */
export function paperProseDiagnostics(
  writes: ReadonlyArray<{ filePath: string; next: string | null }>,
): OperationDiagnostic[] {
  const diagnostics: OperationDiagnostic[] = [];
  for (const write of writes) {
    if (write.next === null || !isManuscriptTexPath(write.filePath)) continue;
    const text = Buffer.from(write.next, "base64").toString("utf8");
    const findings = findInternalPaperJargon(text);
    if (!findings.length) continue;
    const sample = findings.slice(0, 5).map(item => JSON.stringify(item)).join(", ");
    diagnostics.push({
      severity: "warning",
      code: "paper_internal_jargon_hint",
      message: `${write.filePath}: Manuscript prose contains internal version or harness jargon (${sample}). Write for an external peer reviewer: remove internal method/run versions (e.g. v1/v2), harness scripts/JSON filenames, and execution-log bookkeeping; present one coherent final design and frame variant comparisons as named component ablations (keep run provenance in mindmap Notes or wiki).`,
    });
  }
  return diagnostics;
}
