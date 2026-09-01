/**
 * Explicit full-project expansion via `latexpand` in an isolated temp copy.
 * Regular editing stays on source files. Missing binary falls back to the
 * in-process include-graph expander.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { isPassthroughInclude } from "./source-bundle-format";
import { expandIncludesForConversion, locateTexRoot, type SourceDiagnostic } from "./source-graph";
import { runTool, toolFailureExcerpt } from "./run-tool";

const COPY_EXT = new Set([".tex", ".sty", ".cls", ".bib", ".def", ".clo", ".cfg", ".ltx"]);
const SKIP_DIRS = new Set([".git", "figures", "figure_candidates", "node_modules"]);
const KEEP_MARK = "% OB-LATEXPAND-KEEP ";

export type ProjectExpansion = {
  source: string;
  diagnostics: SourceDiagnostic[];
  method: "latexpand" | "graph";
};

export function discoverTexBinDirs(): string[] {
  const dirs = new Set<string>();
  const configured = process.env.OPENBARRY_TEX_BIN;
  if (configured) dirs.add(path.resolve(configured));
  for (const dir of ["/Library/TeX/texbin", "/usr/local/bin", "/opt/homebrew/bin", "/usr/bin"]) {
    dirs.add(dir);
  }

  const texLiveRoot = "/usr/local/texlive";
  try {
    const years = fs
      .readdirSync(/*turbopackIgnore: true*/ texLiveRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d{4}$/.test(entry.name))
      .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
    for (const year of years) {
      const binRoot = path.join(texLiveRoot, year.name, "bin");
      try {
        for (const arch of fs.readdirSync(/*turbopackIgnore: true*/ binRoot, { withFileTypes: true })) {
          if (arch.isDirectory()) dirs.add(path.join(binRoot, arch.name));
        }
      } catch {
        // A partial TeX Live installation can omit its platform directory.
      }
    }
  } catch {
    // TeX Live is optional. The normal PATH and common install locations remain.
  }
  return [...dirs];
}

export function resolveLatexpandBin(): string {
  const extras = [
    process.env.OPENBARRY_LATEXPAND,
    ...discoverTexBinDirs().map((dir) => path.join(dir, "latexpand")),
  ].filter((item): item is string => Boolean(item));
  for (const abs of extras) {
    if (path.isAbsolute(abs) && fs.existsSync(abs)) return abs;
  }
  return "latexpand";
}

function copyManuscriptSources(src: string, dest: string): void {
  const walk = (dir: string) => {
    for (const name of fs.readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue;
      const from = path.join(dir, name);
      const rel = path.relative(src, from);
      const to = path.join(dest, rel);
      const stat = fs.lstatSync(from);
      // A temporary conversion copy must never dereference a symlink. The
      // graph expander validates local symlinks against the manuscript root
      // and supplies the safe fallback when latexpand cannot use the copy.
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        fs.mkdirSync(to, { recursive: true });
        walk(from);
        continue;
      }
      if (!COPY_EXT.has(path.extname(name).toLowerCase())) continue;
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
  };
  fs.mkdirSync(dest, { recursive: true });
  walk(src);
}

function protectPassthroughIncludes(source: string): string {
  return source.replace(/\\(input|include)\s*\{([^}]+)\}/g, (all, _cmd: string, raw: string) => {
    return isPassthroughInclude(raw) ? `${KEEP_MARK}${all}` : all;
  });
}

function restoreProtectedIncludes(source: string): string {
  return source.replaceAll(KEEP_MARK, "");
}

function protectTree(root: string): void {
  const walk = (dir: string) => {
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name);
      if (fs.statSync(abs).isDirectory()) {
        walk(abs);
        continue;
      }
      if (path.extname(name).toLowerCase() !== ".tex") continue;
      const next = protectPassthroughIncludes(fs.readFileSync(abs, "utf8"));
      fs.writeFileSync(abs, next);
    }
  };
  walk(root);
}

export async function expandProjectForConversion(
  manuscriptDir: string,
  rootFile?: string,
): Promise<ProjectExpansion> {
  const fallback = (): ProjectExpansion => {
    const expanded = expandIncludesForConversion(manuscriptDir, rootFile);
    return { ...expanded, method: "graph" };
  };

  const bin = resolveLatexpandBin();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ob-latexpand-"));
  try {
    copyManuscriptSources(manuscriptDir, temp);
    protectTree(temp);
    const rootAbs = locateTexRoot(temp, rootFile);
    const rootName = path.relative(temp, rootAbs).split(path.sep).join("/");
    if (!fs.existsSync(rootAbs)) {
      return {
        source: fallback().source,
        diagnostics: [{
          severity: "warning",
          code: "latexpand_missing_root",
          message: "latexpand skipped because the TeX root was missing in the isolated copy.",
        }],
        method: "graph",
      };
    }
    const result = await runTool(bin, ["--keep-comments", "--empty-comments", rootName], {
      cwd: temp,
      timeoutMs: 20_000,
      maxOutputBytes: 1_500_000,
    });
    if (!result.ok || !result.stdout.trim()) {
      const failure = toolFailureExcerpt(result, "latexpand");
      const graph = fallback();
      return {
        source: graph.source,
        diagnostics: [
          ...graph.diagnostics,
          {
            severity: "warning",
            code: "latexpand_unavailable",
            message: failure.excerpt || "latexpand failed; used the include-graph expander.",
          },
        ],
        method: "graph",
      };
    }
    return {
      source: restoreProtectedIncludes(result.stdout),
      diagnostics: result.stderr.trim()
        ? [{ severity: "info", code: "latexpand", message: result.stderr.trim().slice(0, 400) }]
        : [],
      method: "latexpand",
    };
  } catch (error) {
    const graph = fallback();
    return {
      source: graph.source,
      diagnostics: [
        ...graph.diagnostics,
        {
          severity: "warning",
          code: "latexpand_unavailable",
          message: error instanceof Error ? error.message : String(error),
        },
      ],
      method: "graph",
    };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
