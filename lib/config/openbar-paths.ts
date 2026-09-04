import os from "node:os";
import path from "node:path";

export type OpenBarPaths = {
  configRoot: string;
  dataRoot: string;
  cacheRoot: string;
  runtimeRoot: string;
  repositoriesRoot: string;
  workspaceFile: string;
  credentialProfilesFile: string;
  skillPacksFile: string;
};

function absoluteOverride(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: string,
): string {
  const value = env[name]?.trim();
  if (!value) return fallback;
  if (!path.isAbsolute(value)) {
    throw new Error(`${name} must be an absolute path when set.`);
  }
  return path.resolve(value);
}

/** Resolve machine-local OpenBar paths without creating anything on disk. */
export function openBarPaths(
  env: NodeJS.ProcessEnv = process.env,
  homeDir = os.homedir(),
): OpenBarPaths {
  const home = path.resolve(homeDir);
  const configRoot = absoluteOverride(env, "OPENBAR_CONFIG_HOME", path.join(home, ".config", "openbar"));
  const dataRoot = absoluteOverride(env, "OPENBAR_DATA_HOME", path.join(home, ".local", "share", "openbar"));
  const cacheRoot = absoluteOverride(env, "OPENBAR_CACHE_HOME", path.join(home, ".cache", "openbar"));
  const runtimeRoot = absoluteOverride(env, "OPENBAR_RUNTIME_HOME", path.join(cacheRoot, "runtime"));

  return {
    configRoot,
    dataRoot,
    cacheRoot,
    runtimeRoot,
    repositoriesRoot: path.join(dataRoot, "repositories"),
    workspaceFile: path.join(configRoot, "workspace.json"),
    credentialProfilesFile: path.join(configRoot, "git-credentials.json"),
    skillPacksFile: path.join(configRoot, "skill-packs.json"),
  };
}
