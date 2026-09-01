/**
 * Git credentials live in the OS helper / SSH agent, never in repository
 * metadata or `content/projects`. This module only records where an optional
 * extra helper file may live if an operator creates one by hand.
 */

import os from "node:os";
import path from "node:path";

export function gitCredentialHome(): string {
  if (process.env.OPENBARRY_GIT_CREDENTIAL_DIR) {
    return path.resolve(process.env.OPENBARRY_GIT_CREDENTIAL_DIR);
  }
  return path.join(os.homedir(), ".config", "openbarry", "git");
}

export function gitProcessEnv(base: Record<string, string | undefined> = process.env): NodeJS.ProcessEnv {
  const env = { ...base };
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_ASKPASS = "echo";
  return env as unknown as NodeJS.ProcessEnv;
}

export function credentialStoreTouchesPath(targetDir: string, storeDir = gitCredentialHome()): boolean {
  const store = path.resolve(storeDir);
  const target = path.resolve(targetDir);
  return store === target || store.startsWith(target + path.sep) || target.startsWith(store + path.sep);
}
