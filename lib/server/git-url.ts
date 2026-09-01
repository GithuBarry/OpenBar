/**
 * Git remote URLs: no secrets in userinfo, query, or fragment.
 */

export type GitRemoteInspection = {
  ok: boolean;
  redacted?: string;
  reason?: string;
};

export function inspectGitRemote(value: string): GitRemoteInspection {
  const remote = value.trim();
  if (!remote || /\s/.test(remote)) return { ok: false, reason: "invalid" };
  if (/^git@[A-Za-z0-9.-]+:[^:@?#\s]+$/.test(remote)) {
    return { ok: true, redacted: remote };
  }
  try {
    const url = new URL(remote);
    if (!["https:", "ssh:", "git:"].includes(url.protocol)) {
      return { ok: false, reason: "scheme" };
    }
    const sshUser = (url.protocol === "ssh:" || url.protocol === "git:") && url.username === "git" && !url.password;
    if ((url.username || url.password) && !sshUser) {
      return { ok: false, reason: "userinfo", redacted: redactGitRemote(remote) };
    }
    if (url.search) {
      return { ok: false, reason: "query", redacted: redactGitRemote(remote) };
    }
    if (url.hash) {
      return { ok: false, reason: "fragment", redacted: redactGitRemote(remote) };
    }
    url.username = "";
    url.password = "";
    return { ok: true, redacted: url.toString() };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

export function isCredentialFreeGitRemote(value: string): boolean {
  return inspectGitRemote(value).ok;
}

export function redactGitRemote(remoteUrl: string | undefined): string | undefined {
  if (!remoteUrl) return remoteUrl;
  try {
    const parsed = new URL(remoteUrl);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return remoteUrl
      .replace(/(\/\/)[^/@]+@/g, "$1[credentials-redacted]@")
      .replace(/[?#].*$/, "");
  }
}

export function redactSensitiveText(message: string): string {
  return message
    .replace(/https?:\/\/[^\s<>"']+/gi, (remote) => redactGitRemote(remote) || remote)
    .replace(/(https?:\/\/)[^\s/@]+@/gi, "$1[credentials-redacted]@")
    .replace(/((?:token|password|secret|api[-_]?key|access_token)\s*[=:]\s*)[^\s,;]+/gi, "$1[redacted]")
    .replace(/([?&#][^=]*?(?:token|password|secret|api[_-]?key)[^=]*=)[^&#\s]*/gi, "$1[redacted]");
}
