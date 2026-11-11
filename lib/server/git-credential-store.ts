/**
 * Git credentials live in the host environment or its credential helper.
 * An Overleaf token is supplied only for HTTPS requests to git.overleaf.com.
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
  if (env.OVERLEAF_GIT_TOKEN?.trim()) {
    env.OVERLEAF_GIT_TOKEN = env.OVERLEAF_GIT_TOKEN.trim();
    const start = /^\d{1,4}$/.test(env.GIT_CONFIG_COUNT || "") ? Number(env.GIT_CONFIG_COUNT) : 0;
    // Reset inherited helpers for this host so they cannot persist the token.
    env[`GIT_CONFIG_KEY_${start}`] = "credential.https://git.overleaf.com.helper";
    env[`GIT_CONFIG_VALUE_${start}`] = "";
    env[`GIT_CONFIG_KEY_${start + 1}`] = "credential.https://git.overleaf.com.helper";
    env[`GIT_CONFIG_VALUE_${start + 1}`] =
      '!f() { [ "$1" = get ] || exit 0; https=0; overleaf=0; while IFS= read -r line; do case "$line" in protocol=https) https=1;; host=git.overleaf.com) overleaf=1;; esac; done; if [ "$https$overleaf" = 11 ]; then printf "%s\\n" username=git "password=$OVERLEAF_GIT_TOKEN"; fi; }; f';
    env.GIT_CONFIG_COUNT = String(start + 2);
  }
  return env as unknown as NodeJS.ProcessEnv;
}

export function credentialStoreTouchesPath(targetDir: string, storeDir = gitCredentialHome()): boolean {
  const store = path.resolve(storeDir);
  const target = path.resolve(targetDir);
  return store === target || store.startsWith(target + path.sep) || target.startsWith(store + path.sep);
}
