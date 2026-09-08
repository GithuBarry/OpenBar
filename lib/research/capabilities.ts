/**
 * Startup capability reporting for Git, Pandoc, TeX, and document modes.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { discoverTexBinDirs, resolveLatexpandBin } from "@/lib/tex-project/latexpand";

export type ToolCapability = {
  name: string;
  available: boolean;
  version?: string;
  detail?: string;
};

export type RuntimeCapabilities = {
  git: ToolCapability;
  pandoc: ToolCapability;
  latexmk: ToolCapability;
  pdflatex: ToolCapability;
  synctex: ToolCapability;
  latexpand: ToolCapability;
  writableContent: ToolCapability;
  documentModes: Array<"tex" | "markdown" | "html-static" | "html-interactive">;
  cloudflareAccess: boolean;
};

function probeEnv(): NodeJS.ProcessEnv {
  const extra = discoverTexBinDirs();
  return { ...process.env, PATH: [...new Set([process.env.PATH || "", ...extra].filter(Boolean))].join(path.delimiter) };
}

function probe(name: string, bin: string, args: string[]): ToolCapability {
  try {
    const stdout = execFileSync(bin, args, {
      encoding: "utf8",
      timeout: 4_000,
      stdio: ["ignore", "pipe", "ignore"],
      env: probeEnv(),
    });
    const version = stdout.trim().split(/\r?\n/)[0];
    return { name, available: true, version };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      name,
      available: false,
      detail: code === "ENOENT" ? `${bin} is not installed` : error instanceof Error ? error.message : String(error),
    };
  }
}

function writableDir(dir: string): ToolCapability {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probeFile = path.join(dir, `.ob-write-probe-${process.pid}`);
    fs.writeFileSync(probeFile, "ok");
    fs.unlinkSync(probeFile);
    return { name: "writableContent", available: true, detail: dir };
  } catch (error) {
    return {
      name: "writableContent",
      available: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export function getRuntimeCapabilities(contentRoot = process.env.OPENBARRY_CONTENT || path.join(process.cwd(), "content")): RuntimeCapabilities {
  return {
    git: probe("git", "git", ["--version"]),
    pandoc: probe("pandoc", "pandoc", ["--version"]),
    latexmk: probe("latexmk", "latexmk", ["-v"]),
    pdflatex: probe("pdflatex", "pdflatex", ["-version"]),
    synctex: probe("synctex", "synctex", ["help"]),
    latexpand: probe("latexpand", resolveLatexpandBin(), ["--help"]),
    writableContent: writableDir(contentRoot),
    documentModes: ["tex", "markdown", "html-static", "html-interactive"],
    cloudflareAccess: Boolean(process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN && process.env.CLOUDFLARE_ACCESS_AUD),
  };
}
