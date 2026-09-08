"use client";

import { ChoiceButtons } from "@/components/choice-buttons";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Plus, Save, Trash2 } from "lucide-react";

import {
  deleteProjectSkillAction,
  deleteWorkspaceSkillAction,
  readProjectSkillAction,
  writeAgentsMdAction,
  writeProjectSkillAction,
  writeWorkspaceAgentsMdAction,
  writeWorkspaceSkillAction,
} from "@/app/actions";
import { instructionsWebMcpActions, sharedWebMcpActions } from "@/features/webmcp-actions";
import type { ProjectSkill } from "@/lib/research/project-skills";

import { useInstructionsWebMcp } from "./use-instructions-webmcp";

type SkillDraft = { id: string; name: string; body: string; source: "project" | "workspace"; expectedHash?: string };

export function ProjectInstructionsClient({
  slug,
  agentsPath,
  agentsBody,
  agentsHash,
  skills,
  workspaceAgentsPath,
  workspaceAgentsBody,
  workspaceAgentsHash,
  workspaceSkills,
}: {
  slug: string;
  agentsPath: string;
  agentsBody: string;
  agentsHash: string;
  skills: ProjectSkill[];
  workspaceAgentsPath: string;
  workspaceAgentsBody: string;
  workspaceAgentsHash: string;
  workspaceSkills: ProjectSkill[];
}) {
  const router = useRouter();
  useInstructionsWebMcp({
    project: slug,
    actions: instructionsWebMcpActions,
    sharedActions: sharedWebMcpActions,
    refresh: () => router.refresh(),
    navigate: (href) => router.push(href),
    current: () => ({ kind: "instructions", href: `/p/${slug}/instructions` }),
  });
  const [body, setBody] = useState(agentsBody);
  const [hash, setHash] = useState(agentsHash);
  const [workspaceBody, setWorkspaceBody] = useState(workspaceAgentsBody);
  const [workspaceHash, setWorkspaceHash] = useState(workspaceAgentsHash);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<SkillDraft>({ id: "", name: "", body: "", source: "project" });

  const saveAgents = (shared: boolean) => {
    setError(null);
    startTransition(async () => {
      try {
        if (shared) {
          const next = await writeWorkspaceAgentsMdAction(workspaceBody, workspaceHash);
          setWorkspaceHash(next.hash);
        } else {
          const next = await writeAgentsMdAction(slug, body, hash);
          setHash(next.hash);
        }
        router.refresh();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Could not save instructions.");
      }
    });
  };

  const saveSkill = () => {
    if (!draft.id.trim() || !draft.body.trim()) return;
    setError(null);
    startTransition(async () => {
      try {
        const spec = { id: draft.id.trim(), name: draft.name.trim() || draft.id.trim(), body: draft.body };
        if (draft.source === "workspace") await writeWorkspaceSkillAction(spec, draft.expectedHash);
        else await writeProjectSkillAction(slug, spec, draft.expectedHash);
        setDraft({ id: "", name: "", body: "", source: draft.source });
        router.refresh();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Could not save the skill.");
      }
    });
  };

  const editSkill = (skill: ProjectSkill) => {
    startTransition(async () => {
      try {
        const full = await readProjectSkillAction(slug, skill.id);
        setDraft({
          id: skill.id,
          name: skill.name,
          body: full.body,
          source: skill.source === "workspace" ? "workspace" : "project",
          expectedHash: skill.hash,
        });
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Could not read the skill.");
      }
    });
  };

  return (
    <div className="space-y-8">
      <EditorBlock
        title="AGENTS.md"
        hint={`${agentsPath} — included automatically in get_project_state.`}
        value={body}
        pending={pending}
        onChange={setBody}
        onSave={() => saveAgents(false)}
      />

      <SkillList
        title="Project skills"
        hint="Listed in project state. Agents read a skill when it is relevant."
        skills={skills}
        pending={pending}
        onEdit={editSkill}
        onDelete={(skill) => {
          if (!window.confirm(`Delete skill ${skill.id}?`)) return;
          startTransition(async () => {
            try {
              if (!skill.hash) throw new Error("Reload the skill before deleting it.");
              await deleteProjectSkillAction(slug, skill.id, skill.hash);
              router.refresh();
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : "Could not delete the skill.");
            }
          });
        }}
      />

      <SkillForm
        draft={draft}
        pending={pending}
        onChange={setDraft}
        onSave={saveSkill}
      />

      <EditorBlock
        title="Shared instructions"
        hint={`${workspaceAgentsPath} — workspace AGENTS.md for every project.`}
        value={workspaceBody}
        pending={pending}
        onChange={setWorkspaceBody}
        onSave={() => saveAgents(true)}
      />

      <SkillList
        title="Workspace skills"
        hint="Shared SKILL.md files under the workspace content directory."
        skills={workspaceSkills}
        pending={pending}
        onEdit={editSkill}
        onDelete={(skill) => {
          if (!window.confirm(`Delete workspace skill ${skill.id}?`)) return;
          startTransition(async () => {
            try {
              if (!skill.hash) throw new Error("Reload the skill before deleting it.");
              await deleteWorkspaceSkillAction(skill.id, skill.hash);
              router.refresh();
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : "Could not delete the skill.");
            }
          });
        }}
      />

      {error && <p className="text-xs text-danger" role="alert">{error}</p>}
    </div>
  );
}

function EditorBlock({
  title,
  hint,
  value,
  pending,
  onChange,
  onSave,
}: {
  title: string;
  hint: string;
  value: string;
  pending: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-xs text-faint">{hint}</p>
        </div>
        <button type="button" className="btn-primary text-xs" onClick={onSave} disabled={pending}>
          {pending ? <LoaderCircle size={13} className="animate-spin" /> : <Save size={13} />}
          Save
        </button>
      </div>
      <textarea
        className="input min-h-[16rem] !w-full resize-y font-mono text-xs leading-5"
        value={value}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
    </section>
  );
}

function SkillList({
  title,
  hint,
  skills,
  pending,
  onEdit,
  onDelete,
}: {
  title: string;
  hint: string;
  skills: ProjectSkill[];
  pending: boolean;
  onEdit: (skill: ProjectSkill) => void;
  onDelete: (skill: ProjectSkill) => void;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="text-xs text-faint">{hint}</p>
      {skills.length === 0 && <p className="text-sm text-faint">None yet.</p>}
      <ul className="space-y-2">
        {skills.map((skill) => (
          <li key={`${skill.source}-${skill.id}`} className="flex items-start justify-between gap-2 rounded-lg border border-line px-3 py-2">
            <button type="button" className="min-w-0 text-left" onClick={() => onEdit(skill)}>
              <p className="text-sm font-medium">{skill.name}</p>
              <p className="text-xs text-muted">{skill.description}</p>
              <p className="mt-0.5 font-mono text-[10px] text-faint">{skill.path}</p>
            </button>
            <button type="button" className="btn-ghost text-xs" disabled={pending} onClick={() => onDelete(skill)}>
              <Trash2 size={13} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SkillForm({
  draft,
  pending,
  onChange,
  onSave,
}: {
  draft: SkillDraft;
  pending: boolean;
  onChange: (draft: SkillDraft) => void;
  onSave: () => void;
}) {
  return (
    <form
      className="space-y-2 rounded-lg border border-dashed border-line p-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <p className="flex items-center gap-1 text-xs font-semibold">
        <Plus size={12} /> {draft.id ? "Edit skill" : "New skill"}
      </p>
      <div className="flex gap-2">
        <ChoiceButtons label="Skill scope" value={draft.source} options={[{value:"project",label:"Project"},{value:"workspace",label:"Workspace"}]} onChange={(value) => onChange({ ...draft, source: value as SkillDraft["source"] })} />
        <input className="input h-8 flex-1 text-xs" placeholder="id" value={draft.id} onChange={(event) => onChange({ ...draft, id: event.target.value })} />
      </div>
      <input className="input h-8 text-xs" placeholder="name" value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} />
      <textarea className="input min-h-32 !w-full resize-y font-mono text-xs" placeholder="SKILL.md body" value={draft.body} onChange={(event) => onChange({ ...draft, body: event.target.value })} />
      <button type="submit" className="btn-outline text-xs" disabled={pending || !draft.id.trim() || !draft.body.trim()}>Save skill</button>
    </form>
  );
}
