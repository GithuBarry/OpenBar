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
    for (const [key, receipt] of Object.entries(state.receipts)) if (receipt.published && snapshot.cards[key]) {
      replies.push({ project, mapId: receipt.mapId, nodeId: receipt.nodeId, ...receipt.published, contentHash: snapshot.cards[key].contentHash })
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
        const receipt = Object.values(state.receipts).find(item => item.requestId === id || item.currentNotificationId === id)
        if (!note && !receipt) continue
        const requestId = receipt?.requestId || agentReplyRequestId(state, note!)
        if (actor === 'webmcp' && input.acknowledged !== false && receipt) {
          const key = agentReplyCardKey(receipt.mapId, receipt.nodeId), saved = snapshot.cards[key]
          const currentId = snapshot.notes.find(item => agentReplyCardKey(item.mapId, item.nodeId) === key)?.id || null
          if (!saved || currentId !== receipt.currentNotificationId || agentReplyRevision(requestId, saved.contentHash) !== receipt.responseRevision) { rejected.add(id); continue }
          if (receipt.published?.responseRevision !== receipt.responseRevision) receipt.published = { responseRevision: receipt.responseRevision, contentHash: receipt.contentHash, repliedAt: new Date().toISOString() }
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
