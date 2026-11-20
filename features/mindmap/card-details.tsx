"use client";

import { useState } from "react";
import { Check, ChevronRight, Globe, Link2, Pencil, Plus, Trash2, X } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { Select } from "@/components/select";
import { FastTooltip } from "@/components/fast-tooltip";
import { PopoverSurface } from "@/components/pop";
import { artifactRefSchema } from "@/lib/schemas";
import { artifactHref } from "@/lib/research/artifact-link";
import { safeUrl } from "@/lib/safe-url";
import type { ArtifactRef } from "@/lib/types";
import { CardDestinationLink, useLinkedCard } from "./linked-card";
import { InspectorSummary } from "./inspector-summary";
import styles from "./card-details.module.css";
import linkStyles from "./card-links.module.css";

function isWebLink(ref: Pick<ArtifactRef, "kind">): boolean {
  return ref.kind === "web" || ref.kind === "external";
}

function LinkDestinationIcon({ href, external, className = "" }: { href: string; external: boolean; className?: string }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const safeHref = external ? safeUrl(href) : undefined;
  const source = safeHref ? `${new URL(safeHref).origin}/favicon.ico` : undefined;
  const iconClassName = external ? linkStyles.destinationIcon : `${linkStyles.destinationIcon} ${className}`;
  const destinationIcon = source && failedSource !== source
    ? <img className={iconClassName} src={source} alt="" width={14} height={14} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedSource(source)} />
    : external ? <Globe className={iconClassName} size={14} aria-hidden="true" /> : <Link2 className={iconClassName} size={14} aria-hidden="true" />;
  return external ? <span className={`${linkStyles.webDestination} ${className}`} aria-hidden="true"><Link2 className={linkStyles.linkMark} size={11} />{destinationIcon}</span> : destinationIcon;
}

export function hasCardLinks(refs: ArtifactRef[] = []): boolean {
  return refs.some(ref => ref.kind !== "figure");
}

const RELATION_PRESETS = ["supports", "refutes", "ablates", "depends-on", "supersedes", "motivates"] as const;

export type LinkPickerOptions = {
  sections?: Array<{ id: string; label: string }>;
  todos?: Array<{ id: string; label: string }>;
  nodes?: Array<{ id: string; label: string }>;
  wiki?: Array<{ id: string; label: string }>;
};

export function CardMetadataPills({ metadata }: { metadata?: Record<string, unknown> }) {
  if (!metadata) return null;
  const entries = Object.entries(metadata).filter(([, v]) => (
    typeof v === "string" || typeof v === "number" || typeof v === "boolean"
  ));
  if (!entries.length) return null;
  const compact = entries.filter(([k, v]) => k.length <= 16 && String(v).length <= 18);
  const shown = (compact.length ? compact : entries).slice(0, 2);
  const hiddenCount = entries.length - shown.length;
  const formatVal = (v: unknown) => typeof v === "boolean" ? (v ? "yes" : "no") : String(v);
  return <>
    {shown.map(([key, val]) => (
      <span key={key} className="mindmap-node-tag font-mono tabular-nums" title={`${key}: ${formatVal(val)}`}>
        {key}: {formatVal(val).slice(0, 16)}
      </span>
    ))}
    {hiddenCount > 0 && (
      <span className="mindmap-node-tag font-mono" title={entries.slice(2).map(([k, v]) => `${k}: ${formatVal(v)}`).join("\n")}>
        +{hiddenCount}
      </span>
    )}
  </>;
}

export function CardLinkIndicator({ project, refs, sourceId }: { project: string; refs: ArtifactRef[]; sourceId: string }) {
  const links = refs.filter(ref => ref.kind !== "figure").map(ref => ({ ...ref, href: artifactHref(project, ref) }));
  const singleCard = useLinkedCard(links.length === 1 ? links[0].href : "");
  if (!links.length) return null;
  if (singleCard) {
    const link = links[0];
    return <span className={`${styles.linkIndicator} nodrag nopan`}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
      onDoubleClick={event => event.stopPropagation()}
      onKeyDown={event => event.stopPropagation()}>
      <CardDestinationLink href={link.href} sourceId={sourceId} className={styles.linkTrigger}>
        <Link2 size={13} aria-hidden="true" />
        {link.relation && <span className={linkStyles.relationPill}>{link.relation}</span>}
        <span className={styles.linkDestination}>{link.label || singleCard.title || "Linked card"}</span>
      </CardDestinationLink>
    </span>;
  }
  const external = links.find(ref => ref.kind === "web" || ref.kind === "external");
  const first = external || links[0]!;
  let destination = first.label?.trim() || first.kind.replaceAll("-", " ");
  if (external && !first.label?.trim()) {
    try { destination = new URL(first.href).hostname.replace(/^www\./, ""); } catch { /* The safe link fallback keeps its label. */ }
  }
  const characters = Array.from(destination)
  const displayLabel = characters.length > 28 ? `${characters.slice(0, 27).join("").trimEnd()}…` : destination
  return <span className={`${styles.linkIndicator} nodrag nopan`}
    onPointerDown={event => event.stopPropagation()}
    onClick={event => event.stopPropagation()}
    onDoubleClick={event => event.stopPropagation()}
    onKeyDown={event => event.stopPropagation()}>
    <Popover.Root>
      <FastTooltip label={links.map(ref => `${ref.relation ? `[${ref.relation}] ` : ""}${ref.label ? `${ref.label}: ` : ""}${ref.href}`).join("\n")}><Popover.Trigger asChild>
        <button type="button" className={styles.linkTrigger} aria-label={`${links.length} saved ${links.length === 1 ? "link" : "links"}: ${destination}`}>
          <LinkDestinationIcon href={first.href} external={Boolean(external)} />
          {first.relation && <span className={linkStyles.relationPill}>{first.relation}</span>}
          <span className={styles.linkDestination}>{displayLabel}</span>
          {links.length > 1 && <span className={styles.linkCount}>+{links.length - 1}</span>}
        </button>
      </Popover.Trigger></FastTooltip>
      <PopoverSurface className={styles.linkPopover} side="top" align="end" sideOffset={6} aria-label="Saved links">
        {links.map((ref, index) => <CardDestinationLink key={`${ref.href}:${index}`} href={ref.href} sourceId={sourceId}>
          <LinkDestinationIcon href={ref.href} external={isWebLink(ref)} className={linkStyles.popoverIcon} />
          <span>{ref.relation && <em className={linkStyles.relationPill}>{ref.relation}</em>} {ref.label || ref.href}{ref.label && <small>{ref.href}</small>}</span>
        </CardDestinationLink>)}
      </PopoverSurface>
    </Popover.Root>
  </span>;
}

export function CardLinks({ project, refs, sourceId, onChange, pickerOptions }: { project: string; refs: ArtifactRef[]; sourceId: string; onChange: (refs: ArtifactRef[]) => void; pickerOptions?: LinkPickerOptions }) {
  const [draft, setDraft] = useState<ArtifactRef | null>(null);
  const [original, setOriginal] = useState<ArtifactRef | null>(null);
  const [context, setContext] = useState("");
  const [error, setError] = useState("");
  const edit = (ref: ArtifactRef | null) => { setOriginal(ref); setDraft(ref ? { ...ref } : { kind: "paper-section", id: "" }); setContext(ref?.sectionContext ? JSON.stringify(ref.sectionContext, null, 2) : ""); setError(""); };
  const webLink = Boolean(draft && isWebLink(draft));
  const targetChoices = draft?.kind === "paper-section" ? pickerOptions?.sections
    : draft?.kind === "paper-todo" ? pickerOptions?.todos
      : draft?.kind === "mindmap-node" ? pickerOptions?.nodes
        : draft?.kind === "wiki-page" ? pickerOptions?.wiki
          : undefined;
  const updateUrl = (value: string) => {
    if (!draft) return;
    const separateTarget = draft.url !== undefined && draft.id !== draft.url;
    setDraft({ ...draft, id: separateTarget ? draft.id : value, ...(draft.url !== undefined ? { url: value } : {}) });
  };
  const save = () => {
    try {
      if (!draft) return;
      let candidate: ArtifactRef = { ...draft, label: draft.label?.trim() || undefined, relation: draft.relation?.trim() || undefined, ...(context.trim() ? { sectionContext: JSON.parse(context) } : { sectionContext: undefined }) };
      if (isWebLink(draft)) {
        const url = safeUrl(draft.url ?? draft.id);
        if (!url) throw new Error("Add a valid http(s) URL.");
        const separateTarget = draft.url !== undefined && draft.id.trim() && draft.id.trim() !== draft.url.trim();
        candidate = { ...candidate, id: separateTarget ? draft.id.trim() : url, ...(draft.url !== undefined ? { url } : {}) };
      }
      const result = artifactRefSchema.safeParse(candidate);
      if (!result.success) throw new Error(result.error.issues[0]?.message || "Check this link.");
      if (!result.data.id.trim()) throw new Error("Add a link target.");
      const index = original ? refs.findIndex(ref => JSON.stringify(ref) === JSON.stringify(original)) : -1;
      if (original && index < 0) throw new Error("This link changed. Reopen it before saving.");
      onChange(original ? refs.map((ref, at) => at === index ? result.data : ref) : [...refs, result.data]);
      setDraft(null);
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Check this link."); }
  };
  return <details className={`mindmap-field ${linkStyles.links}`}>
    <InspectorSummary label="Links" hasContent={refs.some(ref => ref.kind !== "figure")} />
    <div className={linkStyles.list}>
      {refs.filter(ref => ref.kind !== "figure").map((ref, index) => <div key={index} className={linkStyles.row}>
        <CardDestinationLink className={linkStyles.savedLink} href={artifactHref(project, ref)} sourceId={sourceId} title={ref.label || ref.id}><LinkDestinationIcon href={artifactHref(project, ref)} external={isWebLink(ref)} />{ref.relation && <span className={linkStyles.relationPill}>{ref.relation}</span>}<span>{ref.label || ref.id}</span></CardDestinationLink>
        <FastTooltip label="Edit link"><button type="button" className={linkStyles.iconButton} aria-label={`Edit link ${ref.label || ref.id}`} onClick={() => edit(ref)}><Pencil size={13} aria-hidden="true" /></button></FastTooltip>
        <FastTooltip label="Remove link"><button type="button" className={linkStyles.iconButton} aria-label={`Remove link ${ref.label || ref.id}`} onClick={() => onChange(refs.filter(item => item !== ref))}><Trash2 size={13} aria-hidden="true" /></button></FastTooltip>
      </div>)}
      {draft ? <div className={linkStyles.editor}>
        <div className={linkStyles.heading}>
          <Select label="Link type" value={draft.kind} options={["paper-section", "paper-todo", "paper-comment", "mindmap-node", "wiki-page", "file", "web", "external", "project"].map(value => ({ value, label: value.replaceAll("-", " ") }))} onValueChange={value => setDraft({ ...draft, kind: value as ArtifactRef["kind"], id: "" })} />
          <input aria-label="Link relation" list="ob-link-relations" placeholder="Relation (e.g. supports)" value={draft.relation || ""} onChange={event => setDraft({ ...draft, relation: event.target.value || undefined })} />
          <datalist id="ob-link-relations">{RELATION_PRESETS.map(rel => <option key={rel} value={rel} />)}</datalist>
        </div>
        {webLink ? <input aria-label="Link URL" type="url" placeholder="https://…" autoComplete="url" value={draft.url ?? draft.id} onChange={event => updateUrl(event.target.value)} />
          : targetChoices && targetChoices.length > 0 ? (
            <Select
              label="Link target"
              value={draft.id}
              options={[{ value: "", label: `Choose ${draft.kind.replaceAll("-", " ")}…` }, ...targetChoices.map(item => ({ value: item.id, label: item.label }))]}
              onValueChange={value => {
                const chosen = targetChoices.find(item => item.id === value);
                setDraft({ ...draft, id: value, label: draft.label || chosen?.label });
              }}
            />
          )
          : <input aria-label="Link target" placeholder={draft.kind === "file" ? "scripts/eval.py" : "Section, card, or page id"} value={draft.id} onChange={event => setDraft({ ...draft, id: event.target.value })} />}
        <input aria-label="Link label" placeholder="Display label (optional)" value={draft.label || ""} onChange={event => setDraft({ ...draft, label: event.target.value || undefined })} />
        <details className={linkStyles.options}>
          <summary><ChevronRight size={12} aria-hidden="true" />Reference details</summary>
          <div className={linkStyles.optionFields}>
            {webLink ? <label><span>Reference target</span><input aria-label="Link target" value={draft.id} onChange={event => setDraft({ ...draft, id: event.target.value, url: draft.url ?? draft.id })} /></label>
              : <label><span>Target id / URL</span><input aria-label="Link target raw" value={draft.id} onChange={event => setDraft({ ...draft, id: event.target.value })} /></label>}
            {(draft.kind === "mindmap-node" || draft.mapId !== undefined) && <label><span>Map</span><input aria-label="Link map" value={draft.mapId || ""} onChange={event => setDraft({ ...draft, mapId: event.target.value || undefined })} /></label>}
            {(draft.kind === "paper-section" || context.trim()) && <label><span>Section context</span><textarea aria-label="Section link context" value={context} spellCheck={false} onChange={event => setContext(event.target.value)} /></label>}
          </div>
        </details>
        <div className={linkStyles.actions}><button type="button" className="p-button p-button-default btn-outline" onClick={save}>Save link</button><button type="button" className={linkStyles.cancel} onClick={() => setDraft(null)}>Cancel</button></div>
      </div> : <button type="button" className={linkStyles.addButton} onClick={() => edit(null)}><Plus size={13} aria-hidden="true" />Add link</button>}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  </details>;
}

export function CardProperties({ value = {}, onChange }: { value?: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void }) {
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [type, setType] = useState("text");
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const update = (key: string, next: unknown) => { onChange({ ...value, [key]: next }); setError(""); };
  const add = () => {
    try {
      const key = name.trim();
      if (!key || Object.hasOwn(value, key)) throw new Error("Choose a unique property name.");
      const next = type === "text" ? text : type === "number" ? Number(text) : JSON.parse(text);
      if (type === "number" && (!text.trim() || !Number.isFinite(next))) throw new Error("Use a finite number.");
      update(key, next);
      setName("");
      setText(type === "boolean" ? "true" : type === "json" ? "{}" : "");
      setAdding(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Check this value."); }
  };
  return <details className={`mindmap-field ${styles.properties}`}>
    <InspectorSummary label="Properties" hasContent={Object.keys(value).length > 0} />
    <div className={styles.propertyList}>
      {Object.entries(value).map(([key, current]) => <div key={`${key}:${JSON.stringify(current)}`} className={styles.propertyRow}>
        <input type="text" className={styles.propertyName} aria-label={`Property name ${key}`} title={key} defaultValue={key} onBlur={event => {
          const next = event.target.value.trim();
          if (next === key) return;
          if (!next || Object.hasOwn(value, next)) { event.target.value = key; setError("Choose a unique property name."); return; }
          const properties = { ...value, [next]: current }; delete properties[key]; onChange(properties); setError("");
        }} />
        {typeof current === "boolean" ? <label className={styles.booleanValue}><input type="checkbox" aria-label={`Property value ${key}`} checked={current} onChange={event => update(key, event.target.checked)} />{current ? "Yes" : "No"}</label>
          : typeof current === "object" ? <details className={styles.structuredDisclosure}>
            <summary className={styles.structuredToggle} aria-label={`Structured value ${key}`}><ChevronRight size={12} aria-hidden="true" />{current === null ? "null" : Array.isArray(current) ? `List (${current.length})` : "Structured value"}</summary>
            <textarea aria-label={`Property value ${key}`} className={styles.structuredValue} defaultValue={JSON.stringify(current, null, 2)} onBlur={event => { try { update(key, JSON.parse(event.target.value)); } catch { setError("Use valid JSON for this structured value."); } }} />
          </details>
            : <input aria-label={`Property value ${key}`} type={typeof current === "number" ? "number" : "text"} step="any" defaultValue={String(current ?? "")} onBlur={event => {
              const next = typeof current === "number" ? Number(event.target.value) : event.target.value;
              if (typeof next === "number" && (!event.target.value.trim() || !Number.isFinite(next))) { setError("Use a finite number."); return; }
              if (next !== current) update(key, next);
            }} />}
        <FastTooltip label={`Remove property ${key}`}><button type="button" className={`${styles.iconButton} ${styles.removeButton}`} aria-label={`Remove property ${key}`} onClick={() => { const next = { ...value }; delete next[key]; onChange(next); setError(""); }}><Trash2 size={13} aria-hidden="true" /></button></FastTooltip>
      </div>)}
      {adding ? <div className={styles.addEditor}>
        <div className={styles.addFields}>
          <input type="text" aria-label="New property name" placeholder="Name" autoFocus value={name} onChange={event => setName(event.target.value)} />
          <Select label="Property type" value={type} options={[{ value: "text", label: "Text" }, { value: "number", label: "Number" }, { value: "boolean", label: "Yes / no" }, { value: "json", label: "Structured value" }]} onValueChange={next => { setType(next); setText(next === "boolean" ? "true" : next === "json" ? "{}" : ""); }} />
        </div>
        <div className={styles.addValue}>
          {type === "boolean" ? <Select label="New property value" value={text} options={[{ value: "true", label: "Yes" }, { value: "false", label: "No" }]} onValueChange={setText} />
            : type === "json" ? <textarea aria-label="New property value" className={styles.structuredValue} value={text} onChange={event => setText(event.target.value)} />
              : <input aria-label="New property value" type={type === "number" ? "number" : "text"} step="any" placeholder="Value" value={text} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); add(); } }} />}
          <FastTooltip label="Add property"><button type="button" className={styles.iconButton} aria-label="Add property" disabled={!name.trim()} onClick={add}><Check size={14} aria-hidden="true" /></button></FastTooltip>
          <FastTooltip label="Cancel adding property"><button type="button" className={styles.iconButton} aria-label="Cancel adding property" onClick={() => { setAdding(false); setError(""); }}><X size={14} aria-hidden="true" /></button></FastTooltip>
        </div>
      </div> : <button type="button" className={styles.addButton} onClick={() => { setAdding(true); setError(""); }}><Plus size={13} aria-hidden="true" />Add property</button>}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  </details>;
}
