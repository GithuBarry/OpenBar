import fs from 'node:fs'
import path from 'node:path'
import type { Mindmap } from '@/lib/types'
import { openBarPaths } from '@/lib/config/openbar-paths'
import { sha256, withWriteLock, writeTextAtomic } from '@/lib/tex-project/codec'
import { listMindmapRecords, readTexPaper } from '@/lib/tex-project/project'
import { analyzePaper, paperTodoIsOpen } from './paper-analysis'
import { AGENT_MENTION_PATTERN, agentMentionFields, collectAgentMention, collectAgentMentions, type MentionTodo } from './agent-mentions'
import { agentReplyCardKey, agentReplyContentHash, agentReplyRequestId, agentReplyRevision, type AgentInboxReceipts } from './agent-reply-state'
import type { AgentRequestHistory } from './agent-inbox-contract'
import type { OperationDiagnostic } from './operation-result'

export type AgentReplySnapshot = {
  scope?: string[]
  notes: ReturnType<typeof collectAgentMentions>['notes']
  cards: Record<string, { mapId: string, nodeId: string, parentId: string | null, agentDraft: boolean, contentHash: string, fieldHashes: Record<string, string>, fields: Record<string, string | undefined>, todoId?: string | null, completed?: boolean, question?: string }>
}
export type AgentReplyCapture = { actor: 'human' | 'webmcp', snapshot?: AgentReplySnapshot, mapTodos?: MentionTodo[], warning?: OperationDiagnostic }
const HASH = /^[a-f0-9]{64}$/
const FIELDS = new Set(['title', 'text', 'caption', 'critical', 'important', 'background'])
const DISPOSITIONS = new Set(['captured', 'acknowledged', 'already_resolved', 'reopened', 'already_open', 'stale', 'missing'])
const HISTORY_LIMIT = 200
const HISTORY_CHARACTER_BUDGET = 1024 * 1024
const HISTORY_REPLY_LIMIT = 100
const empty = (): AgentInboxReceipts => ({ version: 1, acknowledged: [], receipts: {} })

export function agentInboxReceiptFile(projectDir: string): string {
  return path.join(openBarPaths().runtimeRoot, 'agent-inbox', `${sha256(path.resolve(projectDir))}.json`)
}

export function readAgentInboxReceipts(projectDir: string): AgentInboxReceipts {
  let source: string
  try { source = fs.readFileSync(agentInboxReceiptFile(projectDir), 'utf8') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty(); throw error }
  const raw = JSON.parse(source)
  const validIds = (ids: unknown): ids is string[] => Array.isArray(ids) && ids.every(id => typeof id === 'string' && HASH.test(id))
  if (validIds(raw)) return { ...empty(), acknowledged: raw }
  if (!raw || raw.version !== 1 || !validIds(raw.acknowledged) || !raw.receipts || typeof raw.receipts !== 'object' || Array.isArray(raw.receipts)) throw new Error('OpenBar inbox receipts need recovery.')
  for (const [key, value] of Object.entries(raw.receipts)) {
    const item = value as AgentInboxReceipts['receipts'][string]
    if (!item || typeof item.mapId !== 'string' || typeof item.nodeId !== 'string' || key !== agentReplyCardKey(item.mapId, item.nodeId)
      || !HASH.test(item.requestId) || !(item.currentNotificationId === null || HASH.test(item.currentNotificationId))
      || (item.requestNodeId !== undefined && (typeof item.requestNodeId !== 'string' || !item.requestNodeId))
      || (item.question !== undefined && typeof item.question !== 'string')
      || (item.updatedAt !== undefined && !Number.isFinite(Date.parse(item.updatedAt)))
      || !HASH.test(item.contentHash) || !HASH.test(item.responseRevision)
      || (item.published && (!HASH.test(item.published.responseRevision) || !HASH.test(item.published.contentHash) || !Number.isFinite(Date.parse(item.published.repliedAt))))) throw new Error('OpenBar inbox receipts need recovery.')
  }
  if (raw.agentFieldHashes !== undefined) {
    if (!raw.agentFieldHashes || typeof raw.agentFieldHashes !== 'object' || Array.isArray(raw.agentFieldHashes)) throw new Error('OpenBar inbox provenance needs recovery.')
    for (const [key, fields] of Object.entries(raw.agentFieldHashes)) {
      const card = JSON.parse(key)
      if (!Array.isArray(card) || card.length !== 2 || card.some(value => typeof value !== 'string')
        || !fields || typeof fields !== 'object' || Array.isArray(fields)
        || Object.entries(fields).some(([field, hash]) => !FIELDS.has(field) || typeof hash !== 'string' || !HASH.test(hash))) throw new Error('OpenBar inbox provenance needs recovery.')
    }
  }
  if (raw.history !== undefined && (!Array.isArray(raw.history) || raw.history.length > HISTORY_LIMIT || raw.history.some((item: AgentRequestHistory) =>
    !item || !HASH.test(item.id) || typeof item.mapId !== 'string' || typeof item.nodeId !== 'string' || typeof item.question !== 'string' || typeof item.href !== 'string'
    || !Number.isFinite(Date.parse(item.recordedAt)) || !Number.isFinite(Date.parse(item.updatedAt)) || !DISPOSITIONS.has(item.disposition)
    || !Array.isArray(item.replies) || item.replies.length > HISTORY_REPLY_LIMIT || item.replies.some(reply => !reply || typeof reply.mapId !== 'string' || typeof reply.nodeId !== 'string' || typeof reply.href !== 'string'
      || !HASH.test(reply.responseRevision) || (reply.updatedAt !== undefined && !Number.isFinite(Date.parse(reply.updatedAt))) || (reply.repliedAt !== undefined && !Number.isFinite(Date.parse(reply.repliedAt))))))) throw new Error('OpenBar inbox history needs recovery.')
  return raw as AgentInboxReceipts
}

/** Advisory polling stays independent of malformed or unavailable inbox storage. */
export function getAgentInboxRevision(projectDir: string): string | undefined {
  try { return sha256(fs.readFileSync(agentInboxReceiptFile(projectDir))) }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT' ? sha256('[]') : undefined }
}

function readAgentReplyTodos(projectDir: string, projectId: string): MentionTodo[] {
  const paper = readTexPaper(projectDir, projectId, projectId)
  return paper ? analyzePaper(paper.source).todos.map(todo => ({ ...todo, completed: !paperTodoIsOpen(todo) })) : []
}

export function readAgentReplySnapshot(projectDir: string, projectId: string, state = readAgentInboxReceipts(projectDir), input?: { maps: Mindmap[], todos: MentionTodo[] }): AgentReplySnapshot {
  const maps = input?.maps || listMindmapRecords(projectDir)
  const todos = input?.todos || readAgentReplyTodos(projectDir, projectId)
  const byId = new Map(todos.map(todo => [todo.id, todo]))
  const notes = collectAgentMentions(projectId, maps, todos, Infinity, state.agentFieldHashes).notes
  const requests = new Map(notes.map(note => [agentReplyCardKey(note.mapId, note.nodeId), note]))
  const cards: AgentReplySnapshot['cards'] = {}
  for (const map of maps) for (const node of map.nodes) {
    const mapId = map.id || 'draft', key = agentReplyCardKey(mapId, node.id)
    const todo = node.todoId ? byId.get(node.todoId) : undefined
    const fields = agentMentionFields(node, todo)
    const question = requests.get(key)?.fields.map(field => fields[field]).filter((value): value is string => Boolean(value?.trim())).join('\n\n')
    const fieldHashes = Object.fromEntries(Object.entries(fields).flatMap(([field, value]) => value && AGENT_MENTION_PATTERN.test(value) ? [[field, sha256(value)]] : []))
    cards[key] = { mapId, nodeId: node.id, parentId: node.parentId, agentDraft: node.agentDraft === true, fieldHashes, fields, ...(todo ? { todoId: todo.id, completed: todo.completed } : {}),
      contentHash: agentReplyContentHash(node, todo), ...(question ? { question } : {}) }
  }
  return { notes, cards, ...(input ? { scope: maps.map(map => map.id || 'draft') } : {}) }
}

export function rememberAgentRequests(state: AgentInboxReceipts, snapshot: AgentReplySnapshot, at = new Date().toISOString()): void {
  for (const note of snapshot.notes) {
    const id = agentReplyRequestId(state, note)
    if (state.history?.some(item => item.id === id)) continue
    const key = agentReplyCardKey(note.mapId, note.nodeId), previous = state.receipts[key]
    const question = previous?.requestId === id && previous.question ? previous.question : snapshot.cards[key]?.question || note.text
    state.history ||= []
    state.history.push({ id, mapId: note.mapId, nodeId: note.nodeId, question, href: note.href,
      recordedAt: at, updatedAt: at, disposition: state.acknowledged.includes(id) ? 'acknowledged' : 'captured', replies: [] })
  }
}

/** History survives removed cards and keeps the most recently active requests. */
export function pruneAgentInboxReceipts(state: AgentInboxReceipts, snapshot: AgentReplySnapshot, projectId?: string): void {
  if (state.history) {
    for (const item of state.history) {
      const replies = new Map(item.replies.map(reply => [agentReplyCardKey(reply.mapId, reply.nodeId), reply]))
      for (const receipt of Object.values(state.receipts)) {
        if (receipt.requestId !== item.id) continue
        const key = agentReplyCardKey(receipt.mapId, receipt.nodeId)
        const updatedAt = receipt.updatedAt || receipt.published?.repliedAt || replies.get(key)?.updatedAt || item.recordedAt
        replies.set(key, { mapId: receipt.mapId, nodeId: receipt.nodeId,
          href: projectId ? `/p/${encodeURIComponent(projectId)}/mindmap/${encodeURIComponent(receipt.mapId)}#${encodeURIComponent(receipt.nodeId)}` : item.href,
          responseRevision: receipt.responseRevision, updatedAt,
          ...(receipt.published?.responseRevision === receipt.responseRevision ? { repliedAt: receipt.published.repliedAt } : {}) })
        if (updatedAt > item.updatedAt) item.updatedAt = updatedAt
      }
      item.replies = [...replies.values()].sort((a, b) => (a.updatedAt || '').localeCompare(b.updatedAt || '')
        || agentReplyCardKey(a.mapId, a.nodeId).localeCompare(agentReplyCardKey(b.mapId, b.nodeId))).slice(-HISTORY_REPLY_LIMIT)
    }
    const ordered = state.history.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.recordedAt.localeCompare(a.recordedAt) || b.id.localeCompare(a.id))
    state.history = []
    let characters = 2
    for (const item of ordered) {
      item.replies = item.replies.slice(-HISTORY_REPLY_LIMIT)
      const size = JSON.stringify(item).length + (state.history.length ? 1 : 0)
      if (state.history.length && (state.history.length === HISTORY_LIMIT || characters + size > HISTORY_CHARACTER_BUDGET)) break
      state.history.push(item)
      characters += size
    }
  }
  for (const [key, receipt] of Object.entries(state.receipts)) if ((!snapshot.scope || snapshot.scope.includes(receipt.mapId)) && !snapshot.cards[key]) delete state.receipts[key]
  for (const key of Object.keys(state.agentFieldHashes || {})) if ((!snapshot.scope || snapshot.scope.includes(JSON.parse(key)[0])) && !snapshot.cards[key]) delete state.agentFieldHashes![key]
  const keep = new Set([...snapshot.notes.map(note => agentReplyRequestId(state, note)), ...Object.values(state.receipts).map(item => item.requestId), ...(state.history || []).map(item => item.id)])
  state.acknowledged = [...new Set(state.acknowledged)].filter(id => Boolean(snapshot.scope) || keep.has(id)).sort()
}

export function writeAgentInboxReceipts(projectDir: string, state: AgentInboxReceipts): void {
  state.receipts = Object.fromEntries(Object.keys(state.receipts).sort().map(key => [key, state.receipts[key]]))
  writeTextAtomic(agentInboxReceiptFile(projectDir), `${JSON.stringify(state)}\n`)
}

function advisory(error: unknown, log = true): OperationDiagnostic {
  const warning: OperationDiagnostic = { severity: 'warning', code: 'agent_reply_receipt_unavailable', message: `The project edit was saved. Its agent reply marker could not be recorded. ${error instanceof Error ? error.message : String(error)}` }
  if (log) console.warn('OpenBar agent reply advisory', warning.message)
  return warning
}

/** Called inside the admitted project lock after CAS preflight, before saving. */
export function beginAgentReplyCapture(projectDir: string, projectId: string, actor: 'human' | 'webmcp', beforeMap?: Mindmap | null): AgentReplyCapture | undefined {
  try {
    const state = readAgentInboxReceipts(projectDir)
    if (actor === 'human' && !Object.keys(state.agentFieldHashes || {}).length && !Object.keys(state.receipts).length && !state.history?.length && !state.acknowledged.length) return undefined
    const mapTodos = beforeMap !== undefined ? readAgentReplyTodos(projectDir, projectId) : undefined
    return { actor, snapshot: readAgentReplySnapshot(projectDir, projectId, state, mapTodos ? { maps: beforeMap ? [beforeMap] : [], todos: mapTodos } : undefined),
      ...(mapTodos ? { mapTodos } : {}) }
  }
  catch (error) { return { actor, warning: advisory(error, false) } }
}

/** Notification metadata follows a successful authored commit and preserves its success. */
export function completeAgentReplyCapture(projectDir: string, projectId: string, capture?: AgentReplyCapture, savedMap?: Mindmap): OperationDiagnostic[] {
  if (!capture) return []
  if (capture.warning) { console.warn('OpenBar agent reply advisory', capture.warning.message); return [capture.warning] }
  if (!capture.snapshot) return []
  try {
    const before = capture.snapshot, saved = readAgentReplySnapshot(projectDir, projectId, readAgentInboxReceipts(projectDir),
      capture.mapTodos && savedMap ? { maps: [savedMap], todos: capture.mapTodos } : undefined)
    return withWriteLock(agentInboxReceiptFile(projectDir), () => {
      const state = readAgentInboxReceipts(projectDir), original = JSON.stringify(state)
      rememberAgentRequests(state, before)
      for (const [key, card] of Object.entries(saved.cards)) {
        const old = before.cards[key]?.fieldHashes || {}, origins = { ...state.agentFieldHashes?.[key] }
        for (const field of new Set([...Object.keys(old), ...Object.keys(card.fieldHashes), ...Object.keys(origins)])) {
          if (old[field] === card.fieldHashes[field]) continue
          if (capture.actor === 'webmcp' && card.fieldHashes[field]) origins[field] = card.fieldHashes[field]
          else delete origins[field]
        }
        if (Object.keys(origins).length) (state.agentFieldHashes ||= {})[key] = origins
        else if (state.agentFieldHashes) delete state.agentFieldHashes[key]
      }
      // Recollect against updated provenance before deriving request generations.
      const after = saved
      after.notes = Object.entries(after.cards).flatMap(([key, card]) => {
        const note = collectAgentMention(projectId, card.mapId, card.nodeId, card.fields, state.agentFieldHashes?.[key])
        card.question = note?.fields.map(field => card.fields[field]).filter(value => value?.trim()).join('\n\n')
        return note ? [{ ...note, ...(card.todoId ? { todoId: card.todoId, completed: card.completed } : {}) }] : []
      })
      const afterNotes = new Map(after.notes.map(note => [agentReplyCardKey(note.mapId, note.nodeId), note]))
      const requests = new Map(before.notes.map(note => [agentReplyCardKey(note.mapId, note.nodeId), note]))
      const requestIds = new Map([...requests].map(([key, note]) => [key, agentReplyRequestId(state, note)]))
      if (capture.actor === 'webmcp') for (const [key, card] of Object.entries(after.cards)) {
        if (card.contentHash === before.cards[key]?.contentHash) continue
        const previous = state.receipts[key]
        let requestKey = key, note = requests.get(requestKey)
        if (!note && previous) {
          requestKey = agentReplyCardKey(previous.mapId, previous.requestNodeId || previous.nodeId)
          const candidate = requests.get(requestKey)
          if (candidate && requestIds.get(requestKey) === previous.requestId) note = candidate
        }
        if (!note && !before.cards[key] && card.agentDraft) {
          let parent = card.parentId
          const visited = new Set<string>()
          while (parent && !visited.has(parent)) {
            visited.add(parent)
            requestKey = agentReplyCardKey(card.mapId, parent)
            note = requests.get(requestKey)
            if (note) break
            parent = after.cards[requestKey]?.parentId || null
          }
        }
        const continued = !note && previous?.currentNotificationId === null && !requests.has(agentReplyCardKey(previous.mapId, previous.requestNodeId || previous.nodeId)) ? previous : undefined
        if (!note && !continued) continue
        requestKey = note ? agentReplyCardKey(note.mapId, note.nodeId) : agentReplyCardKey(continued!.mapId, continued!.requestNodeId || continued!.nodeId)
        const requestId = note ? requestIds.get(requestKey)! : continued!.requestId
        const history = state.history?.find(item => item.id === requestId)
        state.receipts[key] = { requestId, currentNotificationId: afterNotes.get(requestKey)?.id || null,
          mapId: card.mapId, nodeId: card.nodeId, requestNodeId: note?.nodeId || continued!.requestNodeId || continued!.nodeId,
          question: history?.question || continued?.question || before.cards[requestKey]?.question || note!.text,
          contentHash: card.contentHash, responseRevision: agentReplyRevision(requestId, card.contentHash), updatedAt: new Date().toISOString(),
          ...(previous?.published && previous.requestId === requestId ? { published: previous.published } : {}) }
      }
      rememberAgentRequests(state, after)
      pruneAgentInboxReceipts(state, after, projectId)
      if (JSON.stringify(state) !== original) writeAgentInboxReceipts(projectDir, state)
      return []
    })
  } catch (error) { return [advisory(error)] }
}
