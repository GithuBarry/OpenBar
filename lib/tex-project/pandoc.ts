/**
 * Explicit Pandoc conversion with sandbox, resource paths, and size limits.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runTool, toolFailureExcerpt } from "./run-tool";
import { expandProjectForConversion } from "./latexpand";
import { pandocSafeMacros } from "./pandoc-macros";
import { locateTexRoot } from "./source-graph";
import { splitBundleSource } from "./source-bundle-format";
import { writeTextAtomic } from "./codec";

export type ConversionLoss = "none" | "partial" | "unsupported";

export type ConversionArtifact = {
  output: string;
  diagnostics: string[];
  loss: ConversionLoss;
  unsupported: string[];
  sourceHash: string;
  outputHash: string;
  toolchainHash: string;
  sourceFileHash?: string;
  sourceBundleHash?: string;
  converterVersion?: string;
  expandMethod?: "latexpand" | "graph" | "none";
};

const FILTER = path.join(path.dirname(fileURLToPath(import.meta.url)), "pandoc-openbarry.lua");
const cache = new Map<string, ConversionArtifact>();

let jobs = 0;
const MAX_JOBS = 2;

export const PANDOC_LIMITS = {
  timeoutMs: 20_000,
  maxOutputBytes: 1_500_000,
  maxInputBytes: 1_500_000,
};

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function conversionSourceHash(value: string): string {
  return hash(value);
}

function classifyLoss(stderr: string, output: string): { loss: ConversionLoss; unsupported: string[] } {
  const unsupported: string[] = [];
  if (/Could not parse|unexpected|PandocLuaError/i.test(stderr)) {
    return { loss: "unsupported", unsupported: [stderr.trim().slice(0, 400)] };
  }
  if (/ob-tex-unknown|raw-tex/i.test(output) || /not supported/i.test(stderr)) {
    unsupported.push("raw-tex");
    return { loss: "partial", unsupported };
  }
  return { loss: "none", unsupported };
}

export async function convertWithPandoc(input: {
  source: string;
  cwd: string;
  from?: string;
  to?: string;
  macros?: string;
  resourcePaths?: string[];
}): Promise<ConversionArtifact> {
  if (Buffer.byteLength(input.source, "utf8") > PANDOC_LIMITS.maxInputBytes) {
    return {
      output: "",
      diagnostics: ["Input exceeds Pandoc size limit."],
      loss: "unsupported",
      unsupported: ["input-too-large"],
      sourceHash: hash(input.source),
      outputHash: hash(""),
      toolchainHash: hash("oversize"),
    };
  }
  const sourceHash = hash(input.source);
  const macros = input.macros || "";
  const optionsKey = JSON.stringify({
    from: input.from || "latex+raw_tex+latex_macros",
    to: input.to || "html5",
    cwd: input.cwd,
    resourcePaths: input.resourcePaths || [],
  });
  const toolchainHash = hash(`pandoc|${FILTER}|${optionsKey}|${macros}`);
  const cacheKey = `${sourceHash}:${toolchainHash}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  while (jobs >= MAX_JOBS) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  jobs += 1;
  try {
    const resource = (input.resourcePaths || [input.cwd]).join(path.delimiter);
    const args = [
      "--sandbox",
      `--from=${input.from || "latex+raw_tex+latex_macros"}`,
      `--to=${input.to || "html5"}`,
      "--mathml",
      "--wrap=none",
      `--lua-filter=${FILTER}`,
      `--resource-path=${resource}`,
    ];
    const result = await runTool("pandoc", args, {
      cwd: input.cwd,
      timeoutMs: PANDOC_LIMITS.timeoutMs,
      maxOutputBytes: PANDOC_LIMITS.maxOutputBytes,
      input: macros ? `${macros}\n${input.source}` : input.source,
    });
    const failure = toolFailureExcerpt(result, "pandoc");
    const { loss, unsupported } = result.ok
      ? classifyLoss(result.stderr, result.stdout)
      : { loss: "unsupported" as const, unsupported: [failure.excerpt || "pandoc failed"] };
    const artifact: ConversionArtifact = {
      output: result.ok ? result.stdout : "",
      diagnostics: result.ok ? (result.stderr ? [result.stderr.trim()] : []) : [failure.excerpt || "pandoc failed"],
      loss,
      unsupported,
      sourceHash,
      outputHash: hash(result.stdout),
      toolchainHash,
    };
    if (result.ok) cache.set(cacheKey, artifact);
    return artifact;
  } finally {
    jobs -= 1;
  }
}


export type ConversionPlan = {
  id: string;
  projectId: string;
  filePath: string;
  toFormat: string;
  manuscriptDir?: string;
  artifact: ConversionArtifact;
};

const conversionPlans = new Map<string, ConversionPlan>();

export function rememberConversionPlan(plan: ConversionPlan): ConversionPlan {
  conversionPlans.set(plan.id, plan);
  if (plan.manuscriptDir) {
    try {
      const dir = path.join(plan.manuscriptDir, ".openbarry", "conversion-plans");
      fs.mkdirSync(dir, { recursive: true });
      writeTextAtomic(path.join(dir, `${plan.id}.json`), `${JSON.stringify(plan)}\n`);
    } catch {
      // The in-memory plan remains usable for the current process. A later
      // apply reports an unknown plan when durable storage is unavailable.
    }
  }
  return plan;
}

export function getConversionPlan(id: string, manuscriptDir?: string): ConversionPlan | undefined {
  const current = conversionPlans.get(id);
  if (current || !manuscriptDir || !/^conv-[A-Za-z0-9-]+$/.test(id)) return current;
  try {
    const raw = fs.readFileSync(path.join(manuscriptDir, ".openbarry", "conversion-plans", `${id}.json`), "utf8");
    const parsed = JSON.parse(raw) as ConversionPlan;
    if (parsed.id !== id || parsed.manuscriptDir !== manuscriptDir) return undefined;
    conversionPlans.set(id, parsed);
    return parsed;
  } catch {
    return undefined;
  }
}

export async function previewProjectConversion(input: {
  projectId: string;
  filePath: string;
  source: string;
  cwd: string;
  to?: string;
  macros?: string;
  expandProject?: boolean;
}): Promise<ConversionPlan> {
  const expansion = input.expandProject
    ? await expandProjectForConversion(input.cwd)
    : null;
  const source = expansion ? expansion.source : input.source;
  const artifact = await convertWithPandoc({
    source,
    cwd: input.cwd,
    to: input.to,
    macros: input.macros,
    resourcePaths: [input.cwd],
  });
  artifact.expandMethod = expansion?.method || "none";
  if (!expansion && splitBundleSource(source).length > 0) {
    artifact.sourceBundleHash = artifact.sourceHash;
  }
  if (expansion?.diagnostics.length) {
    artifact.diagnostics = [
      ...artifact.diagnostics,
      ...expansion.diagnostics.map((item) => item.message),
    ];
  }
  return rememberConversionPlan({
    id: `conv-${hash(input.source || source).slice(0, 12)}-${Date.now().toString(36)}`,
    projectId: input.projectId,
    filePath: input.filePath,
    toFormat: input.to || "html5",
    manuscriptDir: input.cwd,
    artifact,
  });
}

function readUtf8IfPresent(file: string): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

export function manuscriptFilePath(
  manuscriptDir: string,
  filePath: string,
): { ok: true; abs: string } | { ok: false; message: string } {
  if (!filePath || filePath.includes("\0") || filePath.includes("\\")) {
    return { ok: false, message: "Conversion path must stay inside the manuscript." };
  }
  if (/^[A-Za-z]:[\\/]/.test(filePath)) {
    return { ok: false, message: "Conversion path must stay inside the manuscript." };
  }
  const normalized = path.posix.normalize(filePath);
  if (path.posix.isAbsolute(normalized) || normalized === ".." || normalized.startsWith("../")) {
    return { ok: false, message: "Conversion path must stay inside the manuscript." };
  }
  const lexicalRoot = path.resolve(manuscriptDir);
  let root: string;
  try {
    root = fs.realpathSync.native(lexicalRoot);
  } catch {
    // Preview callers can validate a safe future path before the project
    // directory exists. Existing roots still receive the realpath checks
    // below, which protect symlinked files and parents.
    if (fs.existsSync(lexicalRoot)) {
      return { ok: false, message: "Manuscript directory is unavailable." };
    }
    root = lexicalRoot;
  }
  const abs = path.resolve(root, normalized);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    return { ok: false, message: "Conversion path must stay inside the manuscript." };
  }
  if (!fs.existsSync(root)) return { ok: true, abs };
  try {
    if (fs.existsSync(abs)) {
      if (!fs.statSync(abs).isFile()) {
        return { ok: false, message: "Conversion path must name a file." };
      }
      const real = fs.realpathSync.native(abs);
      if (real !== root && !real.startsWith(root + path.sep)) {
        return { ok: false, message: "Conversion path must stay inside the manuscript." };
      }
    } else {
      let parent = path.dirname(abs);
      while (parent !== root && !fs.existsSync(parent)) parent = path.dirname(parent);
      const realParent = fs.realpathSync.native(parent);
      if (realParent !== root && !realParent.startsWith(root + path.sep)) {
        return { ok: false, message: "Conversion path must stay inside the manuscript." };
      }
    }
  } catch {
    return { ok: false, message: "Conversion path is unavailable." };
  }
  return { ok: true, abs };
}

/** Shared preview used by the server action and browser WebMCP setup tools. */
export async function previewManuscriptConversion(input: {
  projectId: string;
  manuscriptDir: string;
  filePath: string;
  source?: string;
  to?: string;
  expandProject?: boolean;
  requireExistingFile?: boolean;
}): Promise<{ ok: true; plan: ConversionPlan } | { ok: false; message: string }> {
  const expandProject = input.expandProject === true;
  const requestedPath = expandProject
    ? path.relative(input.manuscriptDir, locateTexRoot(input.manuscriptDir)).split(path.sep).join("/")
    : input.filePath;
  const resolved = manuscriptFilePath(input.manuscriptDir, requestedPath);
  if (!resolved.ok) return resolved;
  if (input.requireExistingFile && !expandProject && !fs.existsSync(/*turbopackIgnore: true*/ resolved.abs)) {
    return { ok: false, message: "File not found." };
  }
  const source = expandProject
    ? ""
    : (input.source !== undefined ? input.source : readUtf8IfPresent(resolved.abs));
  const sourceFile = expandProject
    ? locateTexRoot(input.manuscriptDir)
    : resolved.abs;
  const sourceFilePath = path.relative(input.manuscriptDir, sourceFile).split(path.sep).join("/");
  const sourceFileText = readUtf8IfPresent(sourceFile);
  const sourceFileHash = fs.existsSync(sourceFile) ? hash(sourceFileText) : undefined;
  const sty = readUtf8IfPresent(path.join(input.manuscriptDir, "openbarry.sty"));
  const paper = readUtf8IfPresent(path.join(input.manuscriptDir, "paper.tex"));
  const macros = pandocSafeMacros(sty, /\\documentclass\b/.test(source || paper) ? "" : paper);
  const plan = await previewProjectConversion({
    projectId: input.projectId,
    filePath: expandProject ? sourceFilePath : requestedPath,
    source,
    cwd: input.manuscriptDir,
    to: input.to,
    macros,
    expandProject,
  });
  plan.artifact.sourceFileHash = sourceFileHash;
  rememberConversionPlan(plan);
  return { ok: true, plan };
}
