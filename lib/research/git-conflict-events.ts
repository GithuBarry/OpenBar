import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { openBarPaths } from "@/lib/config/openbar-paths";
import { assertPublicDemoProject } from "@/lib/server/demo-mode";
import { getProjectMetadata, listVisibleProjects, projectContentDir } from "@/lib/store";
import { sha256, withWriteLock, writeTextAtomic } from "@/lib/tex-project/codec";
import type { ConflictKind, ConflictNotification } from "./agent-inbox-contract";
import type { InboxEventTarget } from "./agent-inbox-events";

export type { ConflictKind, ConflictNotification } from "./agent-inbox-contract";

export type RecordGitConflictInput = {
  kind: ConflictKind;
  code: string;
  message: string;
  mapId?: string;
  nodeIds?: readonly string[];
  files?: readonly string[];
  branch?: string;
  ahead?: number;
  behind?: number;
  localCommit?: string;
  remoteCommit?: string;
  expectedHash?: string;
  currentHash?: string;
};

export type GitConflictRecord = {
  id: string;
  slot: string;
  kind: ConflictKind;
  code: string;
  message: string;
  createdAt: string;
  mapId?: string;
  nodeIds?: string[];
  files?: string[];
  branch?: string;
  ahead?: number;
  behind?: number;
  localCommit?: string;
  remoteCommit?: string;
  expectedHash?: string;
  currentHash?: string;
};

type ActiveConflictRecord = GitConflictRecord & { fingerprint: string };

type GitConflictStore = {
  version: 1;
  active: Record<string, ActiveConflictRecord>;
  journal?: {
    previous?: string;
    entries: GitConflictRecord[];
  };
};

export type GitConflictEventItem = ConflictNotification & { cursor: string };

const CONFLICT_EVENT_LIMIT = 200;
const ACTIVE_SAVE_CONFLICT_TTL_MS = 30 * 60 * 1000;
const ACTIVE_GIT_CONFLICT_TTL_MS = 2 * 60 * 60 * 1000;
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const HASH_OR_ZERO = /^(?:0|[a-f0-9]{64})$/;
const MULTI_CURSOR_PREFIX = "m1.";
const MAX_MULTI_CURSOR_LENGTH = 16_384;
const EMITTER_SYMBOL = Symbol.for("openbar.gitConflictEmitter");

type NormalizedTarget =
  | { readonly kind: "single"; readonly project: string }
  | { readonly kind: "subset"; readonly projects: readonly string[] }
  | { readonly kind: "all" };

function conflictEmitter(): EventEmitter {
  const globalStore = globalThis as Record<symbol, EventEmitter | undefined>;
  let emitter = globalStore[EMITTER_SYMBOL];
  if (!emitter) {
    emitter = new EventEmitter();
    emitter.setMaxListeners(0);
    globalStore[EMITTER_SYMBOL] = emitter;
  }
  return emitter;
}

export function gitConflictFile(projectDir: string): string {
  return path.join(openBarPaths().runtimeRoot, "git-conflicts", `${sha256(path.resolve(projectDir))}.json`);
}

export function conflictSlot(kind: ConflictKind, mapId?: string): string {
  if (kind === "mindmap") {
    const clean = mapId?.trim();
    return `mindmap:${clean && SLUG.test(clean) ? clean : "draft"}`;
  }
  return kind;
}

export function conflictResolutionGuidance(kind: ConflictKind): string {
  if (kind === "git") {
    return 'Inspect the conflict with sync_project (action: "inspect", refresh: true) and action: "review_pull". Resolve it if you are confident both sides\' intent is clear and nothing will be lost; otherwise summarize both sides and wait for the human to tell you what to do.';
  }
  return "A human's unsaved browser edit conflicted with the saved file on disk. Inspect the saved state (get_mindmap / get_project_state / sync_project). Resolve any underlying conflict if you are confident nothing (including the human's unsaved browser edits) will be lost; otherwise summarize what changed and wait for the human to tell you what to do.";
}

function conflictHref(project: string, record: Pick<GitConflictRecord, "kind" | "mapId" | "nodeIds">): string {
  if (record.kind === "mindmap") {
    const mapId = record.mapId && SLUG.test(record.mapId) ? record.mapId : "draft";
    const anchor = record.nodeIds?.length === 1 ? `#${encodeURIComponent(record.nodeIds[0])}` : "";
    return `/p/${encodeURIComponent(project)}/mindmap/${encodeURIComponent(mapId)}${anchor}`;
  }
  return `/p/${encodeURIComponent(project)}/paper`;
}

function emptyStore(): GitConflictStore {
  return { version: 1, active: {} };
}

function isValidRecord(value: unknown): value is GitConflictRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && /^[a-f0-9]{64}$/.test(item.id)
    && typeof item.slot === "string" && item.slot.length > 0
    && (item.kind === "git" || item.kind === "mindmap" || item.kind === "paper")
    && typeof item.code === "string" && item.code.length > 0
    && typeof item.message === "string" && item.message.length > 0
    && typeof item.createdAt === "string" && Number.isFinite(Date.parse(item.createdAt));
}

function readConflictStore(projectDir: string): GitConflictStore {
  let source: string;
  try {
    source = fs.readFileSync(gitConflictFile(projectDir), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
    return emptyStore();
  }
  try {
    const raw = JSON.parse(source) as Partial<GitConflictStore>;
    if (!raw || raw.version !== 1 || !raw.active || typeof raw.active !== "object" || Array.isArray(raw.active)) {
      return emptyStore();
    }
    const active: Record<string, ActiveConflictRecord> = {};
    for (const [slot, entry] of Object.entries(raw.active)) {
      if (isValidRecord(entry) && typeof (entry as ActiveConflictRecord).fingerprint === "string") {
        active[slot] = entry as ActiveConflictRecord;
      }
    }
    const entries = Array.isArray(raw.journal?.entries)
      ? raw.journal.entries.filter(isValidRecord).slice(-CONFLICT_EVENT_LIMIT)
      : [];
    const previous = typeof raw.journal?.previous === "string" && /^[a-f0-9]{64}$/.test(raw.journal.previous)
      ? raw.journal.previous
      : undefined;
    return {
      version: 1,
      active,
      ...(entries.length || previous ? { journal: { ...(previous ? { previous } : {}), entries } } : {}),
    };
  } catch {
    return emptyStore();
  }
}

function activeTtlMs(kind: ConflictKind): number {
  return kind === "git" ? ACTIVE_GIT_CONFLICT_TTL_MS : ACTIVE_SAVE_CONFLICT_TTL_MS;
}

function isActiveRecordFresh(record: GitConflictRecord, now: number): boolean {
  const created = Date.parse(record.createdAt);
  return Number.isFinite(created) && now - created < activeTtlMs(record.kind);
}

function cleanStringList(values: readonly string[] | undefined, maxItems: number, maxLength: number): string[] | undefined {
  if (!values?.length) return undefined;
  const cleaned = [...new Set(values.map(item => item.trim().slice(0, maxLength)).filter(Boolean))].slice(0, maxItems);
  return cleaned.length ? cleaned : undefined;
}

function cleanShortString(value: string | undefined, maxLength: number): string | undefined {
  const cleaned = value?.trim().slice(0, maxLength);
  return cleaned || undefined;
}

function cleanSafeInt(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function toNotification(project: string, record: GitConflictRecord): ConflictNotification {
  const { slot: _slot, ...rest } = record;
  return {
    ...rest,
    project,
    href: conflictHref(project, record),
    guidance: conflictResolutionGuidance(record.kind),
  };
}

/** Record a conflict event atomically and wake any subscribed MCP event streams. */
export function recordGitConflict(projectDir: string, input: RecordGitConflictInput): GitConflictRecord | null {
  const message = input.message.replace(/\s+/g, " ").trim().slice(0, 1000);
  const code = input.code.trim().slice(0, 80);
  if (!message || !code) return null;

  const mapId = input.kind === "mindmap"
    ? (input.mapId?.trim() && SLUG.test(input.mapId.trim()) ? input.mapId.trim() : "draft")
    : undefined;
  const slot = conflictSlot(input.kind, mapId);
  const nodeIds = cleanStringList(input.nodeIds, 50, 120);
  const files = cleanStringList(input.files, 50, 300);
  const branch = cleanShortString(input.branch, 200);
  const ahead = cleanSafeInt(input.ahead);
  const behind = cleanSafeInt(input.behind);
  const localCommit = cleanShortString(input.localCommit, 64);
  const remoteCommit = cleanShortString(input.remoteCommit, 64);
  const expectedHash = cleanShortString(input.expectedHash, 64);
  const currentHash = cleanShortString(input.currentHash, 64);

  const fingerprint = sha256(JSON.stringify({
    slot,
    kind: input.kind,
    code,
    message,
    ...(mapId ? { mapId } : {}),
    ...(nodeIds ? { nodeIds } : {}),
    ...(files ? { files } : {}),
    ...(branch ? { branch } : {}),
    ...(ahead !== undefined ? { ahead } : {}),
    ...(behind !== undefined ? { behind } : {}),
    ...(localCommit ? { localCommit } : {}),
    ...(remoteCommit ? { remoteCommit } : {}),
    ...(expectedHash ? { expectedHash } : {}),
    ...(currentHash ? { currentHash } : {}),
  }));

  const file = gitConflictFile(projectDir);
  let emitted = false;
  const recorded = withWriteLock(file, () => {
    const store = readConflictStore(projectDir);
    const now = Date.now();
    const existing = store.active[slot];
    if (existing && existing.fingerprint === fingerprint && isActiveRecordFresh(existing, now)) {
      const { fingerprint: _fp, ...plain } = existing;
      return plain;
    }

    const createdAt = new Date(now).toISOString();
    const journal = store.journal ||= { entries: [] };
    const previousHead = journal.entries.at(-1)?.id || journal.previous || "0";
    const id = sha256(JSON.stringify([fingerprint, previousHead, createdAt]));

    const record: GitConflictRecord = {
      id,
      slot,
      kind: input.kind,
      code,
      message,
      createdAt,
      ...(mapId ? { mapId } : {}),
      ...(nodeIds ? { nodeIds } : {}),
      ...(files ? { files } : {}),
      ...(branch ? { branch } : {}),
      ...(ahead !== undefined ? { ahead } : {}),
      ...(behind !== undefined ? { behind } : {}),
      ...(localCommit ? { localCommit } : {}),
      ...(remoteCommit ? { remoteCommit } : {}),
      ...(expectedHash ? { expectedHash } : {}),
      ...(currentHash ? { currentHash } : {}),
    };

    store.active[slot] = { ...record, fingerprint };
    journal.entries.push(record);
    while (journal.entries.length > CONFLICT_EVENT_LIMIT) {
      journal.previous = journal.entries.shift()!.id;
    }
    writeTextAtomic(file, `${JSON.stringify(store)}\n`);
    emitted = true;
    return record;
  });

  if (emitted) conflictEmitter().emit("change", file);
  return recorded;
}

/** Clear an active conflict slot once resolved while preserving journal history for cursors. */
export function clearGitConflict(projectDir: string, kind: ConflictKind, mapId?: string): boolean {
  const file = gitConflictFile(projectDir);
  if (!fs.existsSync(file)) return false;
  const slot = conflictSlot(kind, mapId);
  return withWriteLock(file, () => {
    const store = readConflictStore(projectDir);
    if (!Object.hasOwn(store.active, slot)) return false;
    delete store.active[slot];
    writeTextAtomic(file, `${JSON.stringify(store)}\n`);
    return true;
  });
}

/** Read currently active (non-expired) conflict alerts for a project without spawning Git. */
export function readActiveConflicts(projectDir: string, project: string, now = Date.now()): ConflictNotification[] {
  const store = readConflictStore(projectDir);
  return Object.values(store.active)
    .filter(record => isActiveRecordFresh(record, now))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.slot.localeCompare(b.slot))
    .map(({ fingerprint: _fp, ...record }) => toNotification(project, record));
}

function normalizeTarget(target: InboxEventTarget): NormalizedTarget {
  if (typeof target === "string") return { kind: "single", project: target };
  if (target.kind === "subset") {
    const projects = [...new Set(target.projects)].sort();
    if (!projects.length) throw new RangeError("Choose at least one accessible OpenBar project.");
    return { kind: "subset", projects };
  }
  return target;
}

function accessibleProjectDir(project: string, scope?: readonly string[]): string {
  assertPublicDemoProject(project);
  if ((scope && !scope.includes(project)) || !getProjectMetadata(project)) {
    throw new Error("Choose an accessible OpenBar project.");
  }
  return projectContentDir(project);
}

function accessibleProjects(scope?: readonly string[]): string[] {
  return listVisibleProjects()
    .map(project => project.slug)
    .filter(slug => !scope || scope.includes(slug))
    .sort();
}

function projectsRoot(): string {
  return path.join(process.env.OPENBAR_CONTENT || path.join(process.cwd(), "content"), "projects");
}

function encodeMultiCursor(stream: string, heads: Record<string, string>): string {
  const ordered: Record<string, string> = {};
  for (const key of Object.keys(heads).sort()) ordered[key] = heads[key]!;
  return MULTI_CURSOR_PREFIX + Buffer.from(JSON.stringify({ v: 1, s: stream, p: ordered }), "utf8").toString("base64url");
}

function decodeMultiCursor(after: string, stream: string): Record<string, string> {
  if (!after.startsWith(MULTI_CURSOR_PREFIX) || after.length > MAX_MULTI_CURSOR_LENGTH) {
    throw new RangeError("Invalid cursor for this conflict watch.");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(after.slice(MULTI_CURSOR_PREFIX.length), "base64url").toString("utf8")); }
  catch { throw new RangeError("Invalid cursor for this conflict watch."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new RangeError("Invalid cursor for this conflict watch.");
  const record = parsed as Record<string, unknown>;
  if (record.v !== 1 || record.s !== stream || !record.p || typeof record.p !== "object" || Array.isArray(record.p)) {
    throw new RangeError("Invalid cursor for this conflict watch.");
  }
  const heads: Record<string, string> = {};
  for (const [slug, head] of Object.entries(record.p as Record<string, unknown>)) {
    if (!SLUG.test(slug) || typeof head !== "string" || !HASH_OR_ZERO.test(head)) {
      throw new RangeError("Invalid cursor for this conflict watch.");
    }
    heads[slug] = head;
  }
  return heads;
}

function readSingleProjectConflictEvents(project: string, after?: string, scope?: readonly string[]) {
  const store = readConflictStore(accessibleProjectDir(project, scope));
  const journal = store.journal;
  const entries = journal?.entries || [];
  const stream = sha256(JSON.stringify(["git-conflict-events", project]));
  if (after !== undefined && (!after.startsWith(stream + ".") || !HASH_OR_ZERO.test(after.slice(stream.length + 1)))) {
    throw new RangeError("Invalid cursor for this project conflict watch.");
  }
  const base = journal?.previous || "0";
  const head = entries.at(-1)?.id || base;
  const cursor = stream + "." + head;
  const last = after?.slice(stream.length + 1);
  const index = entries.findIndex(entry => entry.id === last);
  const reset = last !== undefined && last !== head && last !== base && index < 0;
  const start = last === base ? 0 : index + 1;
  const events: GitConflictEventItem[] = last === undefined || last === head || reset
    ? []
    : entries.slice(start).map(entry => ({
      ...toNotification(project, entry),
      cursor: stream + "." + entry.id,
    }));
  return { cursor, events, reset };
}

/** An absent cursor starts at the current head. An expired cursor resets to the latest head. */
export function readGitConflictEvents(target: InboxEventTarget, after?: string, scope?: readonly string[]) {
  const normalized = normalizeTarget(target);
  if (normalized.kind === "single") return readSingleProjectConflictEvents(normalized.project, after, scope);

  const projects = normalized.kind === "subset"
    ? normalized.projects.map(project => { accessibleProjectDir(project, scope); return project; })
    : accessibleProjects(scope);
  const stream = sha256(JSON.stringify(normalized.kind === "subset"
    ? ["git-conflict-events-subset", projects]
    : ["git-conflict-events-all"])).slice(0, 16);
  const prevHeads = after === undefined ? undefined : decodeMultiCursor(after, stream);

  const latestHeads: Record<string, string> = {};
  const runningHeads: Record<string, string> = {};
  const pending: Array<ConflictNotification & { seq: number }> = [];
  let reset = false;

  for (const project of projects) {
    const store = readConflictStore(projectContentDir(project));
    const journal = store.journal;
    const entries = journal?.entries || [];
    const base = journal?.previous || "0";
    const head = entries.at(-1)?.id || base;
    latestHeads[project] = head;
    if (!prevHeads) continue;

    const prev = Object.hasOwn(prevHeads, project) ? prevHeads[project] : undefined;
    if (prev === undefined) {
      runningHeads[project] = "0";
      if (base !== "0") { reset = true; continue; }
      entries.forEach((entry, seq) => pending.push({ ...toNotification(project, entry), seq }));
      continue;
    }
    runningHeads[project] = prev;
    const index = entries.findIndex(entry => entry.id === prev);
    if (prev !== head && prev !== base && index < 0) { reset = true; continue; }
    if (prev !== head) {
      const start = prev === base ? 0 : index + 1;
      entries.slice(start).forEach((entry, seq) => pending.push({ ...toNotification(project, entry), seq }));
    }
  }

  const cursor = encodeMultiCursor(stream, latestHeads);
  if (!prevHeads || reset) return { cursor, events: [] as GitConflictEventItem[], reset };

  pending.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.project.localeCompare(b.project) || a.seq - b.seq);
  const events: GitConflictEventItem[] = pending.map(({ seq: _seq, ...item }) => {
    runningHeads[item.project] = item.id;
    return { ...item, cursor: encodeMultiCursor(stream, runningHeads) };
  });
  return { cursor, events, reset: false };
}

/** Watch conflict journals via both in-process pubsub (instant) and fs.watchFile (cross-process). */
export function watchGitConflictEvents(
  target: InboxEventTarget,
  onChange: () => void,
  signal: AbortSignal,
  scope?: readonly string[],
): () => void {
  const normalized = normalizeTarget(target);
  const initialSlugs = normalized.kind === "single"
    ? (accessibleProjectDir(normalized.project, scope), [normalized.project])
    : normalized.kind === "subset"
      ? normalized.projects.map(project => { accessibleProjectDir(project, scope); return project; })
      : accessibleProjects(scope);

  const watched = new Set<string>();
  const listener = () => { if (!signal.aborted) onChange(); };
  const emitter = conflictEmitter();
  const onEmit = (changedFile: string) => {
    if (signal.aborted) return;
    if (watched.has(changedFile)) { onChange(); return; }
    if (normalized.kind === "all") {
      syncWatchers(accessibleProjects(scope));
      if (watched.has(changedFile)) onChange();
    }
  };
  const syncWatchers = (slugs: readonly string[]) => {
    const next = new Set(slugs.map(slug => gitConflictFile(projectContentDir(slug))));
    for (const file of watched) {
      if (!next.has(file)) { fs.unwatchFile(file, listener); watched.delete(file); }
    }
    for (const file of next) {
      if (!watched.has(file)) { fs.watchFile(file, { persistent: false, interval: 1000 }, listener); watched.add(file); }
    }
  };

  let watchedRoot: string | undefined;
  const onRootChange = () => {
    if (signal.aborted) return;
    syncWatchers(accessibleProjects(scope));
    onChange();
  };

  const stop = () => {
    emitter.off("change", onEmit);
    for (const file of watched) fs.unwatchFile(file, listener);
    watched.clear();
    if (watchedRoot) { fs.unwatchFile(watchedRoot, onRootChange); watchedRoot = undefined; }
    signal.removeEventListener("abort", stop);
  };

  if (!signal.aborted) {
    syncWatchers(initialSlugs);
    emitter.on("change", onEmit);
    if (normalized.kind === "all") {
      watchedRoot = projectsRoot();
      fs.watchFile(watchedRoot, { persistent: false, interval: 2000 }, onRootChange);
    }
    signal.addEventListener("abort", stop, { once: true });
  }
  return stop;
}
