"use client";

import { ChoiceButtons } from "@/components/choice-buttons";
import { useProjectWriteSession } from "@/components/project-session/project-write-session";
import { registerProjectFileEditor } from "@/features/project-files-bridge";
import { AGENT_GUIDANCE } from "@/lib/research/agent-guidance";
import { OPENBAR_EXPECTATIONS } from "@/lib/research/expectations";
import { failResult } from "@/lib/research/operation-result";

import { LoaderCircle,Plus,Save,Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect,useRef,useState,useTransition } from "react";

import {
deleteProjectSkillAction,
deleteWorkspaceSkillAction,
readProjectSkillAction,
writeAgentsMdAction,
writeProjectSkillAction,
writeWorkspaceAgentsMdAction,
writeWorkspaceSkillAction,
} from "@/app/actions";
import type { ProjectSkill } from "@/lib/research/project-skills";

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
  const { writable, setPendingWork } = useProjectWriteSession();
  const [body, setBody] = useState(agentsBody);
  const [hash, setHash] = useState(agentsHash);
  const [workspaceBody, setWorkspaceBody] = useState(workspaceAgentsBody);
  const [workspaceHash, setWorkspaceHash] = useState(workspaceAgentsHash);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<SkillDraft>({ id: "", name: "", body: "", source: "project" });
  const baseline = useRef({ slug, body: agentsBody, workspaceBody: workspaceAgentsBody });

  useEffect(() => registerProjectFileEditor(slug, async (operation, writing) => {
    if (body !== baseline.current.body || workspaceBody !== baseline.current.workspaceBody || draft.id || draft.body || pending) return failResult("conflict", "Save the open instruction draft before accessing project files.");
    const result = await operation();
    if (result.ok && writing) router.refresh();
    return result;
  }), [body, workspaceBody, draft.id, draft.body, pending, router, slug]);

  useEffect(() => {
    setPendingWork("instructions", body !== baseline.current.body || workspaceBody !== baseline.current.workspaceBody || Boolean(draft.id || draft.body) || pending);
    return () => setPendingWork("instructions", false);
  }, [body, workspaceBody, draft.id, draft.body, pending, setPendingWork]);

  useEffect(() => {
    const previous = baseline.current;
    if (previous.slug !== slug || body === previous.body) {
      setBody(agentsBody);
      setHash(agentsHash);
    }
    if (previous.slug !== slug || workspaceBody === previous.workspaceBody) {
      setWorkspaceBody(workspaceAgentsBody);
      setWorkspaceHash(workspaceAgentsHash);
    }
    baseline.current = { slug, body: agentsBody, workspaceBody: workspaceAgentsBody };
  }, [slug, agentsBody, agentsHash, workspaceAgentsBody, workspaceAgentsHash]);

  const saveAgents = (shared: boolean) => {
    setError(null);
    startTransition(async () => {
      try {
        if (shared) {
          const next = await writeWorkspaceAgentsMdAction(workspaceBody, workspaceHash);
          setWorkspaceHash(next.hash);
          baseline.current.workspaceBody = workspaceBody;
        } else {
          const next = await writeAgentsMdAction(slug, body, hash);
          setHash(next.hash);
          baseline.current.body = body;
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
        const full = await readProjectSkillAction(slug, skill.id, skill.source);
        setDraft({
          id: skill.id,
          name: skill.name,
          body: full.body,
          source: skill.source === "workspace" ? "workspace" : "project",
          expectedHash: full.hash,
        });
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Could not read the skill.");
      }
    });
  };

  return (
    <fieldset disabled={!writable} className="space-y-8">
      <section className="space-y-3" aria-label="Instruction layers">
        <h2 className="text-base font-semibold">Instruction layers</h2>
        <nav className="grid gap-3 sm:grid-cols-3" aria-label="Instruction scopes">
          {[["project-instructions", "1. Project", "Paper-specific context and skills"], ["user-instructions", "2. User / workspace", "Your preferences across projects"], ["system-instructions", "3. System guidance", "OpenBar’s built-in agent prompt"]].map(([id, title, description]) => <a key={id} href={`#${id}`} className="rounded-lg border border-line p-3"><strong className="block text-sm">{title}</strong><span className="text-xs text-muted">{description}</span></a>)}
        </nav>
        <p className="text-xs leading-5 text-muted">Project → user/workspace → system shows the scope of each layer. The connected agent controls instruction precedence and supplies its own system prompt. OpenBar provides the built-in guidance shown below through its agent connection.</p>
      </section>
      <EditorBlock
        id="project-instructions"
        title="Project instructions (AGENTS.md)"
        hint={`${agentsPath} — included automatically in get_project_state.`}
        value={body}
        pending={pending}
        onChange={setBody}
        onSave={() => saveAgents(false)}
        onReload={hash !== agentsHash ? () => { setBody(agentsBody); setHash(agentsHash); setError(null); } : undefined}
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
        id="user-instructions"
        title="User / workspace instructions"
        hint={`${workspaceAgentsPath} — saved preferences and approved comments are shared with connected agents across projects at startup.`}
        value={workspaceBody}
        pending={pending}
        onChange={setWorkspaceBody}
        onSave={() => saveAgents(true)}
        onReload={workspaceHash !== workspaceAgentsHash ? () => { setWorkspaceBody(workspaceAgentsBody); setWorkspaceHash(workspaceAgentsHash); setError(null); } : undefined}
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

      <section id="system-instructions" className="space-y-3 scroll-mt-6" aria-label="System guidance">
        <div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">OpenBar system guidance</h2><span className="text-xs text-muted">Read only</span></div>
        <p className="text-xs leading-5 text-muted">This is the exact built-in prompt OpenBar sends to connected agents. The agent provider manages its own system prompt separately.</p>
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-surface p-4 font-mono text-xs leading-6">{AGENT_GUIDANCE}</pre>
        <details><summary className="cursor-pointer text-sm font-medium">Shared product rules</summary><ol className="mt-3 list-decimal space-y-2 pl-5 text-xs leading-5 text-muted">{OPENBAR_EXPECTATIONS.map(rule => <li key={rule}>{rule}</li>)}</ol></details>
      </section>
      {error && <p className="text-xs text-danger" role="alert">{error}</p>}
    </fieldset>
  );
}

function EditorBlock({
  id,
  title,
  hint,
  value,
  pending,
  onChange,
  onSave,
  onReload,
}: {
  id?: string;
  title: string;
  hint: string;
  value: string;
  pending: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  onReload?: () => void;
}) {
  return (
    <section id={id} className="space-y-2 scroll-mt-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-xs text-faint">{hint}</p>
        </div>
        <button type="button" className="p-button p-button-primary btn-primary text-xs" onClick={onSave} disabled={pending}>
          {pending ? <LoaderCircle size={13} className="animate-spin" /> : <Save size={13} />}
          Save
        </button>
      </div>
      <textarea
        aria-label={title}
        className="p-field input min-h-[16rem] !w-full resize-y font-mono text-xs leading-5"
        value={value}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
      {onReload && <p className="flex items-center gap-2 text-xs text-warn" role="status">Newer saved instructions are available.<button type="button" className="p-button p-button-default btn-outline" disabled={pending} onClick={onReload}>Reload saved instructions</button></p>}
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
            <button type="button" className="min-w-0 text-left" disabled={pending} onClick={() => onEdit(skill)}>
              <p className="text-sm font-medium">{skill.name}</p>
              <p className="text-xs text-muted">{skill.description}</p>
              <p className="mt-0.5 font-mono text-[10px] text-faint">{skill.path}</p>
            </button>
            <button type="button" className="p-button p-button-borderless btn-ghost text-xs" disabled={pending} onClick={() => onDelete(skill)}>
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
      <fieldset disabled={pending} className="space-y-2">
      <div className="flex gap-2">
        <ChoiceButtons label="Skill scope" value={draft.source} options={[{value:"project",label:"Project"},{value:"workspace",label:"Workspace"}]} onChange={(value) => onChange({ ...draft, source: value as SkillDraft["source"], expectedHash: undefined })} />
        <input className="p-field input h-8 flex-1 text-xs" placeholder="id" value={draft.id} onChange={(event) => onChange({ ...draft, id: event.target.value, expectedHash: undefined })} />
      </div>
      <input className="p-field input h-8 text-xs" placeholder="name" value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} />
      <textarea className="p-field input min-h-32 !w-full resize-y font-mono text-xs" placeholder="SKILL.md body" value={draft.body} onChange={(event) => onChange({ ...draft, body: event.target.value })} />
      <button type="submit" className="p-button p-button-default btn-outline text-xs" disabled={pending || !draft.id.trim() || !draft.body.trim()}>Save skill</button>
      </fieldset>
    </form>
  );
}
