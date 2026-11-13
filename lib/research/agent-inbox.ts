import { listProjects, getProject, projectContentDir } from '@/lib/store'
import { sha256, withWriteLockAsync } from '@/lib/tex-project/codec'
import { withProjectWriteLockAsync } from './project-lock'
import { agentReplyCardKey, agentReplyRequestId, agentReplyRevision } from './agent-reply-state'
import { agentInboxReceiptFile, getAgentInboxRevision, pruneAgentInboxReceipts, readAgentInboxReceipts, readAgentReplySnapshot, writeAgentInboxReceipts } from './agent-reply-receipts'
import type { AgentInbox, AgentReply, InboxNotification } from './agent-inbox-contract'

export { getAgentInboxRevision } from './agent-reply-receipts'
type InboxQuery = { project?: string, limit?: number, includeAcknowledged?: boolean }

function projects(project?: string, scope?: readonly string[]): string[] {
  if (project !== undefined && (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(project) || !getProject(project))) throw new Error('Choose an existing OpenBar project.')
  const selected = project === undefined ? listProjects().map(item => item.slug) : [project]
  return scope ? selected.filter(slug => scope.includes(slug)) : selected
}

export function readAgentInbox(query: InboxQuery = {}, scope?: readonly string[]): AgentInbox {
  const all: InboxNotification[] = [], replies: AgentReply[] = [], revisions: Array<[string, string]> = []
  for (const project of projects(query.project, scope)) {
    const dir = projectContentDir(project), state = readAgentInboxReceipts(dir), snapshot = readAgentReplySnapshot(dir, project)
    const handled = new Set(state.acknowledged)
    for (const note of snapshot.notes) {
      const id = agentReplyRequestId(state, note)
      all.push({ ...note, id, project, acknowledged: handled.has(id) })
    }
    const currentRequests = new Map(snapshot.notes.map(note => [agentReplyCardKey(note.mapId, note.nodeId), note]))
    for (const [key, receipt] of Object.entries(state.receipts)) if (receipt.published && snapshot.cards[key]) {
      const requestNodeId = receipt.requestNodeId || receipt.nodeId
      const requestKey = agentReplyCardKey(receipt.mapId, requestNodeId)
      const question = receipt.question || snapshot.cards[requestKey]?.question
      replies.push({ project, mapId: receipt.mapId, nodeId: receipt.nodeId, requestNodeId,
        ...(question ? { question } : {}),
        requestCurrent: (currentRequests.get(requestKey)?.id || null) === receipt.currentNotificationId,
        ...receipt.published, contentHash: snapshot.cards[key].contentHash })
    }
    revisions.push([project, getAgentInboxRevision(dir) || 'unavailable'])
  }
  const pending = all.filter(note => !note.acknowledged)
  const visible = query.includeAcknowledged ? [...pending, ...all.filter(note => note.acknowledged)] : pending
  const limit = Math.max(1, Math.min(50, query.limit ?? 8))
  return { count: pending.length, notifications: visible.slice(0, limit), hasMore: visible.length > limit,
    revision: revisions.length === 1 ? revisions[0][1] : sha256(JSON.stringify(revisions)), replies }
}

export async function acknowledgeAgentInbox(input: { project?: string, ids: string[], acknowledged?: boolean }, scope?: readonly string[], actor: 'human' | 'webmcp' = 'webmcp') {
  const acknowledged = new Set<string>(), rejected = new Set<string>()
  for (const project of projects(input.project, scope)) {
    const dir = projectContentDir(project)
    await withProjectWriteLockAsync(dir, () => withWriteLockAsync(agentInboxReceiptFile(dir), () => {
      const state = readAgentInboxReceipts(dir), snapshot = readAgentReplySnapshot(dir, project), original = JSON.stringify(state), handled = new Set(state.acknowledged)
      for (const id of input.ids) {
        const note = snapshot.notes.find(item => item.id === id || agentReplyRequestId(state, item) === id)
        const matching = Object.values(state.receipts).filter(item => item.requestId === id || item.currentNotificationId === id)
        if (!note && !matching.length) continue
        const requestId = matching[0]?.requestId || agentReplyRequestId(state, note!)
        const receipts = Object.values(state.receipts).filter(item => item.requestId === requestId)
        if (actor === 'webmcp' && input.acknowledged !== false && receipts.length) {
          const pending = receipts.filter(receipt => receipt.published?.responseRevision !== receipt.responseRevision)
          const current = pending.every(receipt => {
            const key = agentReplyCardKey(receipt.mapId, receipt.nodeId), saved = snapshot.cards[key]
            const requestKey = agentReplyCardKey(receipt.mapId, receipt.requestNodeId || receipt.nodeId)
            const currentNote = snapshot.notes.find(item => agentReplyCardKey(item.mapId, item.nodeId) === requestKey)
            const sameRequest = currentNote ? agentReplyRequestId(state, currentNote) === requestId : receipt.currentNotificationId === null
            return saved && sameRequest && agentReplyRevision(requestId, saved.contentHash) === receipt.responseRevision
          })
          if (!current) { rejected.add(id); continue }
          const repliedAt = new Date().toISOString()
          for (const receipt of pending) receipt.published = { responseRevision: receipt.responseRevision, contentHash: receipt.contentHash, repliedAt }
        }
        if (input.acknowledged === false) handled.delete(requestId)
        else handled.add(requestId)
        acknowledged.add(requestId)
      }
      state.acknowledged = [...handled]
      pruneAgentInboxReceipts(state, snapshot)
      if (JSON.stringify(state) !== original) writeAgentInboxReceipts(dir, state)
    }))
  }
  return { acknowledged: [...acknowledged], rejected: [...rejected], inbox: readAgentInbox({ project: input.project }, scope) }
}
