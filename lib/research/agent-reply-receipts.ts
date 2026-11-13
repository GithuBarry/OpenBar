import fs from 'node:fs'
import path from 'node:path'
import { openBarPaths } from '@/lib/config/openbar-paths'
import { sha256, withWriteLock, writeTextAtomic } from '@/lib/tex-project/codec'
import { listMindmapRecords, readTexPaper } from '@/lib/tex-project/project'
import { analyzePaper, paperTodoIsOpen } from './paper-analysis'
import { collectAgentMentions } from './agent-mentions'
import { agentReplyCardKey, agentReplyContentHash, agentReplyRequestId, agentReplyRevision, type AgentInboxReceipts } from './agent-reply-state'
import type { OperationDiagnostic } from './operation-result'

export type AgentReplySnapshot = {
  notes: ReturnType<typeof collectAgentMentions>['notes']
  cards: Record<string, { mapId: string, nodeId: string, parentId: string | null, agentDraft: boolean, contentHash: string, question?: string }>
}
export type AgentReplyCapture = { snapshot?: AgentReplySnapshot, warning?: OperationDiagnostic }
const HASH = /^[a-f0-9]{64}$/
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
      || !HASH.test(item.contentHash) || !HASH.test(item.responseRevision)
      || (item.published && (!HASH.test(item.published.responseRevision) || !HASH.test(item.published.contentHash) || !Number.isFinite(Date.parse(item.published.repliedAt))))) throw new Error('OpenBar inbox receipts need recovery.')
  }
  return raw as AgentInboxReceipts
}

/** Advisory polling stays independent of malformed or unavailable inbox storage. */
export function getAgentInboxRevision(projectDir: string): string | undefined {
  try { return sha256(fs.readFileSync(agentInboxReceiptFile(projectDir))) }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT' ? sha256('[]') : undefined }
}

export function readAgentReplySnapshot(projectDir: string, projectId: string): AgentReplySnapshot {
  const maps = listMindmapRecords(projectDir)
  const paper = readTexPaper(projectDir, projectId, projectId)
  const todos = paper ? analyzePaper(paper.source).todos.map(todo => ({ ...todo, completed: !paperTodoIsOpen(todo) })) : []
  const byId = new Map(todos.map(todo => [todo.id, todo]))
  const notes = collectAgentMentions(projectId, maps, todos, Infinity).notes
  const requests = new Map(notes.map(note => [agentReplyCardKey(note.mapId, note.nodeId), note]))
  const cards: AgentReplySnapshot['cards'] = {}
  for (const map of maps) for (const node of map.nodes) {
    const mapId = map.id || 'draft', key = agentReplyCardKey(mapId, node.id)
    const todo = node.todoId ? byId.get(node.todoId) : undefined
    const fields: Record<string, string | undefined> = { title: todo?.title ?? node.title, text: todo?.text ?? node.text, caption: node.caption, ...node.caution }
    const question = requests.get(key)?.fields.map(field => fields[field]).filter((value): value is string => Boolean(value?.trim())).join('\n\n')
    cards[key] = { mapId, nodeId: node.id, parentId: node.parentId, agentDraft: node.agentDraft === true,
      contentHash: agentReplyContentHash(node, todo), ...(question ? { question } : {}) }
  }
  return { notes, cards }
}

export function pruneAgentInboxReceipts(state: AgentInboxReceipts, snapshot: AgentReplySnapshot): void {
  for (const key of Object.keys(state.receipts)) if (!snapshot.cards[key]) delete state.receipts[key]
  const keep = new Set([...snapshot.notes.map(note => agentReplyRequestId(state, note)), ...Object.values(state.receipts).map(item => item.requestId)])
  state.acknowledged = [...new Set(state.acknowledged)].filter(id => keep.has(id)).sort()
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
export function beginAgentReplyCapture(projectDir: string, projectId: string, actor: 'human' | 'webmcp'): AgentReplyCapture | undefined {
  if (actor !== 'webmcp') return undefined
  try { return { snapshot: readAgentReplySnapshot(projectDir, projectId) } }
  catch (error) { return { warning: advisory(error, false) } }
}

/** Notification metadata follows a successful authored commit and preserves its success. */
export function completeAgentReplyCapture(projectDir: string, projectId: string, capture?: AgentReplyCapture): OperationDiagnostic[] {
  if (!capture) return []
  if (capture.warning) { console.warn('OpenBar agent reply advisory', capture.warning.message); return [capture.warning] }
  if (!capture.snapshot?.notes.length) return []
  try {
    const before = capture.snapshot!, after = readAgentReplySnapshot(projectDir, projectId)
    return withWriteLock(agentInboxReceiptFile(projectDir), () => {
      const state = readAgentInboxReceipts(projectDir), original = JSON.stringify(state)
      const afterNotes = new Map(after.notes.map(note => [agentReplyCardKey(note.mapId, note.nodeId), note]))
      const requests = new Map(before.notes.map(note => [agentReplyCardKey(note.mapId, note.nodeId), note]))
      const requestIds = new Map([...requests].map(([key, note]) => [key, agentReplyRequestId(state, note)]))
      const questions = new Map([...requests].map(([key, note]) => {
        const previous = state.receipts[key]
        return [key, previous?.requestId === requestIds.get(key) && previous.question ? previous.question : before.cards[key]?.question || note.text]
      }))
      for (const [key, saved] of Object.entries(after.cards)) {
        if (saved.contentHash === before.cards[key]?.contentHash) continue
        const previous = state.receipts[key]
        let requestKey = key, note = requests.get(requestKey)
        if (!note && previous) {
          requestKey = agentReplyCardKey(previous.mapId, previous.requestNodeId || previous.nodeId)
          const candidate = requests.get(requestKey)
          if (candidate && requestIds.get(requestKey) === previous.requestId) note = candidate
        }
        if (!note && !before.cards[key] && saved.agentDraft) {
          let parent = saved.parentId
          const visited = new Set<string>()
          while (parent && !visited.has(parent)) {
            visited.add(parent)
            requestKey = agentReplyCardKey(saved.mapId, parent)
            note = requests.get(requestKey)
            if (note) break
            parent = after.cards[requestKey]?.parentId || null
          }
        }
        if (!note) continue
        requestKey = agentReplyCardKey(note.mapId, note.nodeId)
        const requestId = requestIds.get(requestKey)!
        const question = questions.get(requestKey)!
        state.receipts[key] = { requestId, currentNotificationId: afterNotes.get(requestKey)?.id || null,
          mapId: saved.mapId, nodeId: saved.nodeId, requestNodeId: note.nodeId, question,
          contentHash: saved.contentHash, responseRevision: agentReplyRevision(requestId, saved.contentHash),
          ...(previous?.published ? { published: previous.published } : {}) }
      }
      pruneAgentInboxReceipts(state, after)
      if (JSON.stringify(state) !== original) writeAgentInboxReceipts(projectDir, state)
      return []
    })
  } catch (error) { return [advisory(error)] }
}
