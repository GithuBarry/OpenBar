/**
 * Agent-facing TeX Git onboarding guide. Lives here so MCP can return it
 * without a browser WebMCP hop. Paper-page WebMCP does not register this.
 */

export const TEX_REPO_SETUP_KINDS = ["existing", "empty", "overleaf", "other-git"] as const;
export type TexRepoSetupKind = (typeof TEX_REPO_SETUP_KINDS)[number];

const COMMON = {
  durableState:
    "Paper text and OpenBarry records live in .tex bodies or % OB-DATA comment envelopes. Git carries those files between OpenBarry and the remote.",
  credentials:
    "Use SSH or the operating-system Git credential helper. Supply a credential-free remote URL. Keep tokens, passwords, private keys, and embedded URL credentials outside .tex, Git, MCP arguments, tool output, logs, and browser storage.",
};

const FLOWS: Record<TexRepoSetupKind, Record<string, unknown>> = {
  existing: {
    nextTool: "inspect_tex_git_repo",
    required: ["An allowed local path to the checked-out TeX Git repository"],
    steps: [
      "Inspect the repository and list its TeX files.",
      "Identify the main TeX entry point and preserve arbitrary arXiv files, packages, figures, bibliography, appendix, and unknown TeX byte-for-byte.",
      "Ask the user to confirm the import choice before any conversion that could change source meaning.",
    ],
  },
  empty: {
    nextTool: "initialize_minimal_tex_repo",
    required: ["An allowed empty directory", "A project slug and title"],
    steps: [
      "Create a minimal Git repository with manuscript/paper.tex and manuscript/openbarry/project.tex.",
      "Open the paper page and edit through the live TeX editor. TeX remains the source of truth.",
    ],
  },
  overleaf: {
    nextTools: ["inspect_tex_git_repo", "configure_overleaf_remote"],
    required: ["An allowed existing TeX Git repository path", "A credential-free Overleaf Git URL", "A remote name such as overleaf"],
    steps: [
      "Ask whether the user prefers SSH or the operating-system credential helper.",
      "Inspect the local repository, configure the remote, then push only manuscript and paper asset paths after user approval.",
    ],
  },
  "other-git": {
    nextTools: ["inspect_tex_git_repo", "configure_overleaf_remote"],
    required: ["An allowed existing TeX Git repository path", "A credential-free Git URL", "A remote name"],
    steps: [
      "Ask whether the user prefers SSH or the operating-system Git credential helper.",
      "Inspect the local repository and configure the remote after user approval.",
    ],
  },
};

export function explainTexRepoSetup(kind: string):
  | { ok: true; kind: TexRepoSetupKind; durableState: string; credentials: string; flow: Record<string, unknown> }
  | { ok: false; message: string } {
  if (!TEX_REPO_SETUP_KINDS.includes(kind as TexRepoSetupKind)) {
    return { ok: false, message: "Choose existing, empty, overleaf, or other-git." };
  }
  return { ok: true, kind: kind as TexRepoSetupKind, ...COMMON, flow: FLOWS[kind as TexRepoSetupKind] };
}
