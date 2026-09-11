#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { openBarPaths, type OpenBarPaths } from "../lib/config/openbar-paths";
import {
  findWorkspaceRegistryDuplicates,
  readWorkspaceRegistrySnapshot,
  type WorkspaceRegistryDuplicates,
} from "../lib/workspace/registry";
import type { RegisteredProject, WorkspaceRegistryV1 } from "../lib/workspace/registry-types";

type ParsedArgs = {
  positionals: string[];
  json: boolean;
};

type CheckoutReport = {
  id?: string;
  kind?: "project" | "skill-pack" | "repository";
  checkoutPath: string;
  exists: boolean;
  isGitRoot: boolean;
  branch?: string;
  dirty?: boolean;
  changedFileCount?: number;
  issue?: "missing_checkout" | "not_git_repository" | "checkout_not_git_root" | "git_status_failed";
};

type RegistryDoctorSummary = {
  path: string;
  exists: boolean;
  syntaxValid: boolean;
  schemaVersion?: 1;
  projectCount?: number;
  skillPackCount?: number;
  hash?: string;
};

const SUPPORTED_PRODUCT_INVENTORY_LABEL = "Supported product inventory: web content-store project inventory";
const EXPERIMENTAL_REGISTRY_LABEL = "Experimental CLI inventory: workspace registry";
const REGISTRY_INVENTORY_NOTE =
  "Registry results are separate from web results until registration and web integration share one inventory.";
const REGISTRY_INVENTORY_METADATA = {
  source: "workspace-registry",
  status: "experimental",
  supportedProductInventory: "web content-store project inventory",
  relationship: "separate-until-registration-and-web-integration-share-one-inventory",
  note: REGISTRY_INVENTORY_NOTE,
} as const;

const CLI_USAGE = `Usage: openbar doctor --all [--json]
       openbar doctor --repo <path> [--json]
       openbar credentials list [--json]
       openbar projects list [--json]

Inventory policy:
  ${SUPPORTED_PRODUCT_INVENTORY_LABEL}
  ${EXPERIMENTAL_REGISTRY_LABEL}
  ${REGISTRY_INVENTORY_NOTE}`;

function parseArgs(args: string[]): ParsedArgs {
  const positionals: string[] = [];
  let json = false;
  for (const arg of args) {
    if (arg === "--") continue;
    if (arg === "--json") json = true;
    else if (arg === "--repo" || arg === "--all") positionals.push(arg);
    else if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
    else positionals.push(arg);
  }
  return { positionals, json };
}

function gitEnvironment(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH || "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin",
    HOME: process.env.HOME || os.homedir(),
    LANG: "C",
    LC_ALL: "C",
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_OPTIONAL_LOCKS: "0",
  } as unknown as NodeJS.ProcessEnv;
}

function gitOutput(cwd: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      env: gitEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 1024 * 1024,
    });
  } catch {
    return undefined;
  }
}

function countPorcelainEntries(output: string): number {
  const records = output ? output.split("\0").filter(Boolean) : [];
  let count = 0;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] || "";
    count += 1;
    if (record.length >= 2 && (record[0] === "R" || record[0] === "C")) index += 1;
  }
  return count;
}

function inspectCheckout(inputPath: string, metadata: Pick<CheckoutReport, "id" | "kind"> = {}): CheckoutReport {
  const checkoutPath = path.resolve(inputPath);
  const base: CheckoutReport = { ...metadata, checkoutPath, exists: false, isGitRoot: false };
  let realPath: string;
  try {
    if (!fs.statSync(checkoutPath).isDirectory()) return { ...base, issue: "missing_checkout" };
    realPath = fs.realpathSync.native(checkoutPath);
  } catch {
    return { ...base, issue: "missing_checkout" };
  }
  const reportedRoot = gitOutput(realPath, ["rev-parse", "--show-toplevel"]);
  const inside = gitOutput(realPath, ["rev-parse", "--is-inside-work-tree"])?.trim();
  if (!reportedRoot || inside !== "true") return { ...base, exists: true, issue: "not_git_repository" };
  let gitRoot: string;
  try {
    gitRoot = fs.realpathSync.native(reportedRoot.trim());
  } catch {
    return { ...base, exists: true, issue: "not_git_repository" };
  }
  if (gitRoot !== realPath) return { ...base, exists: true, issue: "checkout_not_git_root" };
  const branch = gitOutput(realPath, ["rev-parse", "--abbrev-ref", "HEAD"])?.trim();
  const status = gitOutput(realPath, ["--no-optional-locks", "status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (branch === undefined || status === undefined) {
    return { ...base, exists: true, isGitRoot: true, issue: "git_status_failed" };
  }
  const changedFileCount = countPorcelainEntries(status);
  return {
    ...base,
    exists: true,
    isGitRoot: true,
    branch: branch || undefined,
    dirty: changedFileCount > 0,
    changedFileCount,
  };
}

function duplicateOk(duplicates: WorkspaceRegistryDuplicates): boolean {
  return !duplicates.projectIds.length && !duplicates.skillPackIds.length && !duplicates.checkoutPaths.length;
}

function inspectRegistry(paths: OpenBarPaths):
  | { ok: boolean; inventory: typeof REGISTRY_INVENTORY_METADATA; registry: RegistryDoctorSummary; duplicates: WorkspaceRegistryDuplicates; checkouts: CheckoutReport[] }
  | { ok: false; inventory: typeof REGISTRY_INVENTORY_METADATA; registry: RegistryDoctorSummary; error: "invalid_workspace_registry" } {
  try {
    const snapshot = readWorkspaceRegistrySnapshot(paths);
    const duplicates = findWorkspaceRegistryDuplicates(snapshot.registry);
    const checkouts: CheckoutReport[] = [
      ...snapshot.registry.projects.map((project) => inspectCheckout(project.checkoutPath, { id: project.id, kind: "project" })),
      ...snapshot.registry.skillPacks.map((skillPack) => inspectCheckout(skillPack.checkoutPath, { id: skillPack.id, kind: "skill-pack" })),
    ];
    const ok = duplicateOk(duplicates) && checkouts.every((checkout) => checkout.exists && checkout.isGitRoot && !checkout.issue);
    return {
      ok,
      inventory: REGISTRY_INVENTORY_METADATA,
      registry: {
        path: paths.workspaceFile,
        exists: snapshot.exists,
        syntaxValid: true,
        schemaVersion: snapshot.registry.schemaVersion,
        projectCount: snapshot.registry.projects.length,
        skillPackCount: snapshot.registry.skillPacks.length,
        ...(snapshot.hash ? { hash: snapshot.hash } : {}),
      },
      duplicates,
      checkouts,
    };
  } catch {
    return { ok: false, inventory: REGISTRY_INVENTORY_METADATA, registry: { path: paths.workspaceFile, exists: fs.existsSync(paths.workspaceFile), syntaxValid: false }, error: "invalid_workspace_registry" };
  }
}

function projectList(registry: WorkspaceRegistryV1): Array<RegisteredProject> {
  return registry.projects.map((project) => ({ ...project }));
}

function printRegistryInventoryNotice(): void {
  console.log(EXPERIMENTAL_REGISTRY_LABEL);
  console.log(SUPPORTED_PRODUCT_INVENTORY_LABEL);
  console.log(REGISTRY_INVENTORY_NOTE);
}

function credentialStatus(paths: OpenBarPaths) {
  let exists = false;
  let mode: number | undefined;
  try {
    const stat = fs.statSync(paths.credentialProfilesFile);
    exists = stat.isFile();
    mode = stat.mode & 0o777;
  } catch {
    // A missing profile file is a valid pre-Task-4 state.
  }
  return {
    path: paths.credentialProfilesFile,
    exists,
    ...(mode === undefined ? {} : { mode, modeIsPrivate: mode === 0o600 }),
  };
}

function humanCheckout(checkout: CheckoutReport): string {
  if (checkout.issue === "missing_checkout") return `${checkout.id || checkout.checkoutPath}: missing checkout`;
  if (checkout.issue === "not_git_repository") return `${checkout.id || checkout.checkoutPath}: exists, not a Git repository`;
  if (checkout.issue === "checkout_not_git_root") return `${checkout.id || checkout.checkoutPath}: exists, path is inside a Git repository`;
  if (checkout.issue === "git_status_failed") return `${checkout.id || checkout.checkoutPath}: Git root, status unavailable`;
  return `${checkout.id || checkout.checkoutPath}: Git root, branch=${checkout.branch || "detached"}, dirty=${checkout.dirty ? "yes" : "no"}, changedFiles=${checkout.changedFileCount || 0}`;
}

function printHuman(value: unknown): void {
  if (typeof value === "string") {
    console.log(value);
    return;
  }
  const result = value as { ok?: boolean; registry?: RegistryDoctorSummary; duplicates?: WorkspaceRegistryDuplicates; checkouts?: CheckoutReport[]; checkout?: CheckoutReport; credentials?: ReturnType<typeof credentialStatus>; projects?: RegisteredProject[] };
  if (result.credentials) {
    console.log(`Credential profile file: ${result.credentials.exists ? "present" : "absent"}`);
    if (result.credentials.mode !== undefined) console.log(`Credential profile mode: ${result.credentials.mode.toString(8)}`);
    return;
  }
  if (result.projects) {
    printRegistryInventoryNotice();
    console.log(`Workspace-registry projects: ${result.projects.length}`);
    for (const project of result.projects) console.log(`${project.id}: ${project.checkoutPath}`);
    return;
  }
  if (result.checkout) {
    console.log(`Repository: ${result.ok ? "healthy" : "needs attention"}`);
    console.log(humanCheckout(result.checkout));
    return;
  }
  if (result.registry && result.duplicates && result.checkouts) {
    printRegistryInventoryNotice();
    console.log(`Workspace registry: ${result.ok ? "healthy" : "needs attention"}`);
    console.log(`Projects: ${result.registry.projectCount || 0}, skill packs: ${result.registry.skillPackCount || 0}`);
    if (result.duplicates.projectIds.length || result.duplicates.skillPackIds.length || result.duplicates.checkoutPaths.length) {
      console.log(`Duplicate project ids: ${result.duplicates.projectIds.join(", ") || "none"}`);
      console.log(`Duplicate skill-pack ids: ${result.duplicates.skillPackIds.join(", ") || "none"}`);
      console.log(`Duplicate checkout paths: ${result.duplicates.checkoutPaths.join(", ") || "none"}`);
    }
    for (const checkout of result.checkouts) console.log(humanCheckout(checkout));
    return;
  }
  printRegistryInventoryNotice();
  console.log("Workspace registry: invalid syntax");
}

function emit(value: unknown, json: boolean): void {
  if (json) console.log(JSON.stringify(value, null, 2));
  else printHuman(value);
}

function usage(): never {
  throw new Error(CLI_USAGE);
}

function printHelp(): void {
  console.log(CLI_USAGE);
}

function runDoctor(args: string[], paths: OpenBarPaths): void {
  const parsed = parseArgs(args);
  if (parsed.positionals[0] !== "doctor") usage();
  if (parsed.positionals[1] === "--repo") {
    const repositoryPath = parsed.positionals[2];
    if (!repositoryPath || parsed.positionals.length !== 3) usage();
    const checkout = inspectCheckout(repositoryPath, { kind: "repository" });
    const ok = checkout.exists && checkout.isGitRoot && !checkout.issue;
    emit({ ok, checkout }, parsed.json);
    if (!ok) process.exitCode = 1;
    return;
  }
  if (parsed.positionals[1] !== "--all" || parsed.positionals.length !== 2) usage();
  const result = inspectRegistry(paths);
  emit(result, parsed.json);
  if (!result.ok) process.exitCode = 1;
}

function runCredentials(args: string[], paths: OpenBarPaths): void {
  const parsed = parseArgs(args);
  if (parsed.positionals.join(" ") !== "credentials list") usage();
  const credentials = credentialStatus(paths);
  emit({ ok: true, credentials }, parsed.json);
}

function runProjects(args: string[], paths: OpenBarPaths): void {
  const parsed = parseArgs(args);
  if (parsed.positionals.join(" ") !== "projects list") usage();
  const snapshot = readWorkspaceRegistrySnapshot(paths);
  const projects = projectList(snapshot.registry);
  emit({ ok: true, projects, inventory: REGISTRY_INVENTORY_METADATA, ...(snapshot.hash ? { hash: snapshot.hash } : {}) }, parsed.json);
}

function main(): void {
  const args = process.argv.slice(2);
  if (args[0] === "--") args.shift();
  if (args[0] === "help" && args.length === 1) {
    printHelp();
    return;
  }
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }
  const paths = openBarPaths();
  if (args[0] === "doctor") runDoctor(args, paths);
  else if (args[0] === "credentials") runCredentials(args, paths);
  else if (args[0] === "projects") runProjects(args, paths);
  else usage();
}

try {
  main();
} catch (error) {
  const json = process.argv.includes("--json");
  const result = { ok: false, error: "invalid_command_or_workspace_registry" };
  if (json) console.error(JSON.stringify(result, null, 2));
  else console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
