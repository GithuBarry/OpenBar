import fs from 'node:fs'
import path from 'node:path'
import { assertPublicDemoProject } from '@/lib/server/demo-mode'
import { getProjectMetadata, listVisibleProjects, projectContentDir } from '@/lib/store'
import { sha256 } from '@/lib/tex-project/codec'
import { agentInboxReceiptFile, readAgentInboxReceipts } from './agent-reply-receipts'

export type InboxEventTarget =
  | string
  | { readonly kind: 'single'; readonly project: string }
  | { readonly kind: 'subset'; readonly projects: readonly string[] }
  | { readonly kind: 'all' }

export type InboxEventItem = {
  id: string
  createdAt: string
  mapId: string
  nodeId: string
  priority?: 'fast-tracked'
  project: string
  cursor: string
  href: string
}

const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const HASH_OR_ZERO = /^(?:0|[a-f0-9]{64})$/
const MULTI_CURSOR_PREFIX = 'm1.'
const MAX_MULTI_CURSOR_LENGTH = 16_384

type NormalizedTarget =
  | { readonly kind: 'single'; readonly project: string }
  | { readonly kind: 'subset'; readonly projects: readonly string[] }
  | { readonly kind: 'all' }

function normalizeTarget(target: InboxEventTarget): NormalizedTarget {
  if (typeof target === 'string') return { kind: 'single', project: target }
  if (target.kind === 'subset') {
    const projects = [...new Set(target.projects)].sort()
    if (!projects.length) throw new RangeError('Choose at least one accessible OpenBar project.')
    return { kind: 'subset', projects }
  }
  return target
}

function accessibleProjectDir(project: string, scope?: readonly string[]): string {
  assertPublicDemoProject(project)
  if ((scope && !scope.includes(project)) || !getProjectMetadata(project)) throw new Error('Choose an accessible OpenBar project.')
  return projectContentDir(project)
}

function accessibleProjects(scope?: readonly string[]): string[] {
  return listVisibleProjects()
    .map(project => project.slug)
    .filter(slug => !scope || scope.includes(slug))
    .sort()
}

function projectsRoot(): string {
  return path.join(process.env.OPENBAR_CONTENT || path.join(process.cwd(), 'content'), 'projects')
}

function eventHref(project: string, mapId: string, nodeId: string): string {
  return `/p/${encodeURIComponent(project)}/mindmap/${encodeURIComponent(mapId)}#${encodeURIComponent(nodeId)}`
}

function encodeMultiCursor(stream: string, heads: Record<string, string>): string {
  const ordered: Record<string, string> = {}
  for (const key of Object.keys(heads).sort()) ordered[key] = heads[key]!
  return MULTI_CURSOR_PREFIX + Buffer.from(JSON.stringify({ v: 1, s: stream, p: ordered }), 'utf8').toString('base64url')
}

function decodeMultiCursor(after: string, stream: string): Record<string, string> {
  if (!after.startsWith(MULTI_CURSOR_PREFIX) || after.length > MAX_MULTI_CURSOR_LENGTH) {
    throw new RangeError('Invalid cursor for this inbox watch.')
  }
  let parsed: unknown
  try { parsed = JSON.parse(Buffer.from(after.slice(MULTI_CURSOR_PREFIX.length), 'base64url').toString('utf8')) }
  catch { throw new RangeError('Invalid cursor for this inbox watch.') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new RangeError('Invalid cursor for this inbox watch.')
  const record = parsed as Record<string, unknown>
  if (record.v !== 1 || record.s !== stream || !record.p || typeof record.p !== 'object' || Array.isArray(record.p)) {
    throw new RangeError('Invalid cursor for this inbox watch.')
  }
  const heads: Record<string, string> = {}
  for (const [slug, head] of Object.entries(record.p as Record<string, unknown>)) {
    if (!SLUG.test(slug) || typeof head !== 'string' || !HASH_OR_ZERO.test(head)) {
      throw new RangeError('Invalid cursor for this inbox watch.')
    }
    heads[slug] = head
  }
  return heads
}

function readSingleProjectEvents(project: string, after?: string, scope?: readonly string[]) {
  const state = readAgentInboxReceipts(accessibleProjectDir(project, scope))
  const journal = state.mentionJournal
  const entries = journal?.entries || []
  const stream = sha256(JSON.stringify(['mention-events', project]))
  if (after !== undefined && (!after.startsWith(stream + '.') || !HASH_OR_ZERO.test(after.slice(stream.length + 1)))) {
    throw new RangeError('Invalid cursor for this project inbox.')
  }
  const base = journal?.previous || '0'
  const head = entries.at(-1)?.id || base
  const cursor = stream + '.' + head
  const last = after?.slice(stream.length + 1)
  const index = entries.findIndex(entry => entry.id === last)
  const reset = last !== undefined && last !== head && last !== base && index < 0
  const start = last === base ? 0 : index + 1
  const events: InboxEventItem[] = last === undefined || last === head || reset ? [] : entries.slice(start).map(entry => ({
    ...entry, project, cursor: stream + '.' + entry.id,
    href: eventHref(project, entry.mapId, entry.nodeId),
  }))
  return { cursor, events, reset }
}

/** An absent cursor starts at the current head. An expired cursor asks the client to resync its inbox. */
export function readInboxEvents(target: InboxEventTarget, after?: string, scope?: readonly string[]) {
  const normalized = normalizeTarget(target)
  if (normalized.kind === 'single') return readSingleProjectEvents(normalized.project, after, scope)

  const projects = normalized.kind === 'subset'
    ? normalized.projects.map(project => { accessibleProjectDir(project, scope); return project })
    : accessibleProjects(scope)
  const stream = sha256(JSON.stringify(normalized.kind === 'subset'
    ? ['mention-events-subset', projects]
    : ['mention-events-all'])).slice(0, 16)
  const prevHeads = after === undefined ? undefined : decodeMultiCursor(after, stream)

  const latestHeads: Record<string, string> = {}
  const runningHeads: Record<string, string> = {}
  const pending: Array<Omit<InboxEventItem, 'cursor'> & { seq: number }> = []
  let reset = false

  for (const project of projects) {
    const state = readAgentInboxReceipts(projectContentDir(project))
    const journal = state.mentionJournal
    const entries = journal?.entries || []
    const base = journal?.previous || '0'
    const head = entries.at(-1)?.id || base
    latestHeads[project] = head
    if (!prevHeads) continue

    const prev = Object.hasOwn(prevHeads, project) ? prevHeads[project] : undefined
    if (prev === undefined) {
      runningHeads[project] = '0'
      if (base !== '0') { reset = true; continue }
      entries.forEach((entry, seq) => pending.push({ ...entry, project, href: eventHref(project, entry.mapId, entry.nodeId), seq }))
      continue
    }
    runningHeads[project] = prev
    const index = entries.findIndex(entry => entry.id === prev)
    if (prev !== head && prev !== base && index < 0) { reset = true; continue }
    if (prev !== head) {
      const start = prev === base ? 0 : index + 1
      entries.slice(start).forEach((entry, seq) => pending.push({ ...entry, project, href: eventHref(project, entry.mapId, entry.nodeId), seq }))
    }
  }

  const cursor = encodeMultiCursor(stream, latestHeads)
  if (!prevHeads || reset) return { cursor, events: [] as InboxEventItem[], reset }

  pending.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.project.localeCompare(b.project) || a.seq - b.seq)
  const events: InboxEventItem[] = pending.map(({ seq: _seq, ...item }) => {
    runningHeads[item.project] = item.id
    return { ...item, cursor: encodeMultiCursor(stream, runningHeads) }
  })
  return { cursor, events, reset: false }
}

/** Node shares stat watchers by filename. Watching receipt paths survives atomic replacement and multiple writers. */
export function watchInboxEvents(target: InboxEventTarget, onChange: () => void, signal: AbortSignal, scope?: readonly string[]): () => void {
  const normalized = normalizeTarget(target)
  const initialSlugs = normalized.kind === 'single'
    ? (accessibleProjectDir(normalized.project, scope), [normalized.project])
    : normalized.kind === 'subset'
      ? normalized.projects.map(project => { accessibleProjectDir(project, scope); return project })
      : accessibleProjects(scope)

  const watched = new Set<string>()
  const listener = () => { if (!signal.aborted) onChange() }
  const syncWatchers = (slugs: readonly string[]) => {
    const next = new Set(slugs.map(slug => agentInboxReceiptFile(projectContentDir(slug))))
    for (const file of watched) {
      if (!next.has(file)) { fs.unwatchFile(file, listener); watched.delete(file) }
    }
    for (const file of next) {
      if (!watched.has(file)) { fs.watchFile(file, { persistent: false, interval: 1000 }, listener); watched.add(file) }
    }
  }

  let watchedRoot: string | undefined
  const onRootChange = () => {
    if (signal.aborted) return
    syncWatchers(accessibleProjects(scope))
    onChange()
  }

  const stop = () => {
    for (const file of watched) fs.unwatchFile(file, listener)
    watched.clear()
    if (watchedRoot) { fs.unwatchFile(watchedRoot, onRootChange); watchedRoot = undefined }
    signal.removeEventListener('abort', stop)
  }

  if (!signal.aborted) {
    syncWatchers(initialSlugs)
    if (normalized.kind === 'all') {
      watchedRoot = projectsRoot()
      fs.watchFile(watchedRoot, { persistent: false, interval: 2000 }, onRootChange)
    }
    signal.addEventListener('abort', stop, { once: true })
  }
  return stop
}
