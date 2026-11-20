import { listProjects, getProject, projectContentDir } from '@/lib/store'
import { sha256, withWriteLock, withWriteLockAsync } from '@/lib/tex-project/codec'
import { withProjectWriteLock, withProjectWriteLockAsync } from './project-lock'
import { agentReplyCardKey, agentReplyRequestId, agentReplyRevision } from './agent-reply-state'
import { agentInboxReceiptFile, getAgentInboxRevision, pruneAgentInboxReceipts, readAgentInboxReceipts, readAgentReplySnapshot, rememberAgentRequests, writeAgentInboxReceipts } from './agent-reply-receipts'
import type { AgentInbox, AgentReply, InboxAcknowledgement, InboxNotification } from './agent-inbox-contract'

export { getAgentInboxRevision } from './agent-reply-receipts'
type InboxQuery = { project?: string, limit?: number, includeAcknowledged?: boolean }

function projects(project?: string, scope?: readonly string[]): string[] {
  if (project !== undefined && (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(project) || !getProject(project))) throw new Error('Choose an existing OpenBar project.')
  const selected = project === undefined ? listProjects().map(item => item.slug) : [project]
  return scope ? selected.filter(slug => scope.includes(slug)) : selected
}

export function readAgentInbox(query: InboxQuery = {}, scope?: readonly string[]): AgentInbox {
  const limit = Math.max(1, Math.min(50, query.limit ?? 8))
  const all: InboxNotification[] = [], replies: AgentReply[] = [], history: NonNullable<AgentInbox['history']> = [], revisions: Array<[string, string]> = []
  for (const project of projects(query.project, scope)) {
    const dir = projectContentDir(project)
    let state = readAgentInboxReceipts(dir), snapshot = readAgentReplySnapshot(dir, project, state)
    const delivered = snapshot.notes.filter(note => query.includeAcknowledged || !state.acknowledged.includes(agentReplyRequestId(state, note))).slice(0, limit)
    if (delivered.some(note => !state.history?.some(item => item.id === agentReplyRequestId(state, note)))) {
      try {
        withProjectWriteLock(dir, () => withWriteLock(agentInboxReceiptFile(dir), () => {
          const current = readAgentInboxReceipts(dir), saved = readAgentReplySnapshot(dir, project, current), original = JSON.stringify(current)
          const ids = new Set(delivered.map(note => agentReplyRequestId(state, note)))
          rememberAgentRequests(current, { ...saved, notes: saved.notes.filter(note => ids.has(agentReplyRequestId(current, note))) })
          pruneAgentInboxReceipts(current, saved, project)
          if (JSON.stringify(current) !== original) writeAgentInboxReceipts(dir, current)
          state = current
          snapshot = saved
        }))
      } catch (error) {
        // First-delivery history retries on the next poll while a writer holds the project.
        if ((error as NodeJS.ErrnoException).code !== 'ELOCKED') console.warn('OpenBar inbox history advisory', error)
      }
    }
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
    if (query.includeAcknowledged) history.push(...(state.history || []).map(item => ({ ...item, project })))
    revisions.push([project, getAgentInboxRevision(dir) || 'unavailable'])
  }
  all.sort((a, b) => Number(b.priority === 'fast-tracked') - Number(a.priority === 'fast-tracked'))
  const pending = all.filter(note => !note.acknowledged)
  const visible = query.includeAcknowledged ? [...pending, ...all.filter(note => note.acknowledged)] : pending
  return { count: pending.length, notifications: visible.slice(0, limit), hasMore: visible.length > limit,
    revision: revisions.length === 1 ? revisions[0][1] : sha256(JSON.stringify(revisions)), replies,
    ...(query.includeAcknowledged ? { history: history.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 200) } : {}) }
}

export async function acknowledgeAgentInbox(input: { project?: string, ids: string[], acknowledged?: boolean }, scope?: readonly string[], actor: 'human' | 'webmcp' = 'webmcp') {
  const acknowledged = new Set<string>(), rejected = new Set<string>(), results = new Map<string, InboxAcknowledgement>()
  for (const project of projects(input.project, scope)) {
    const dir = projectContentDir(project)
    await withProjectWriteLockAsync(dir, () => withWriteLockAsync(agentInboxReceiptFile(dir), () => {
      const state = readAgentInboxReceipts(dir), snapshot = readAgentReplySnapshot(dir, project, state), original = JSON.stringify(state), handled = new Set(state.acknowledged)
      rememberAgentRequests(state, snapshot)
      for (const id of new Set(input.ids)) {
        if (results.has(id)) continue
        const note = snapshot.notes.find(item => item.id === id || agentReplyRequestId(state, item) === id)
        const matching = Object.values(state.receipts).filter(item => item.requestId === id || item.currentNotificationId === id)
        let history = state.history?.find(item => item.id === id)
        if (!note && !matching.length && !history) continue
        const requestId = matching[0]?.requestId || (note ? agentReplyRequestId(state, note) : history!.id)
        history ||= state.history?.find(item => item.id === requestId)
        const receipts = Object.values(state.receipts).filter(item => item.requestId === requestId)
        if (!history && receipts.length) {
          const receipt = receipts[0], nodeId = receipt.requestNodeId || receipt.nodeId, at = new Date().toISOString()
          history = { id: requestId, mapId: receipt.mapId, nodeId, question: receipt.question || note?.text || '',
            href: `/p/${encodeURIComponent(project)}/mindmap/${encodeURIComponent(receipt.mapId)}#${encodeURIComponent(nodeId)}`,
            recordedAt: at, updatedAt: at, disposition: 'captured', replies: [] }
          state.history ||= []
          state.history.push(history)
        }
        const result: InboxAcknowledgement = { id, project, requestId, disposition: 'acknowledged' }
        const currentNote = history && snapshot.notes.find(item => item.mapId === history!.mapId && item.nodeId === history!.nodeId)
        const retired = !note && !receipts.length
        const changedRequest = currentNote && agentReplyRequestId(state, currentNote) !== requestId
        const pending = receipts.filter(receipt => receipt.published?.responseRevision !== receipt.responseRevision)
        const current = pending.every(receipt => {
          const key = agentReplyCardKey(receipt.mapId, receipt.nodeId), saved = snapshot.cards[key]
          const requestKey = agentReplyCardKey(receipt.mapId, receipt.requestNodeId || receipt.nodeId)
          const request = snapshot.notes.find(item => agentReplyCardKey(item.mapId, item.nodeId) === requestKey)
          const sameRequest = request ? agentReplyRequestId(state, request) === requestId : receipt.currentNotificationId === null
          return saved && sameRequest && agentReplyRevision(requestId, saved.contentHash) === receipt.responseRevision
        })
        if (input.acknowledged === false) {
          if (!note || changedRequest) result.disposition = 'stale'
          else { result.disposition = handled.delete(requestId) ? 'reopened' : 'already_open'; acknowledged.add(requestId) }
        } else if (changedRequest || (actor === 'webmcp' && !current)) result.disposition = 'stale'
        else if (retired || (handled.has(requestId) && (actor === 'human' || pending.length === 0))) result.disposition = 'already_resolved'
        else {
          if (actor === 'webmcp') {
            const repliedAt = new Date().toISOString()
            for (const receipt of pending) receipt.published = { responseRevision: receipt.responseRevision, contentHash: receipt.contentHash, repliedAt }
          }
          handled.add(requestId)
          acknowledged.add(requestId)
        }
        if (result.disposition === 'already_resolved') acknowledged.add(requestId)
        if (result.disposition === 'stale') rejected.add(id)
        if (history && result.disposition !== 'stale') { history.disposition = result.disposition; history.updatedAt = new Date().toISOString() }
        results.set(id, result)
      }
      state.acknowledged = [...handled]
      pruneAgentInboxReceipts(state, snapshot, project)
      if (JSON.stringify(state) !== original) writeAgentInboxReceipts(dir, state)
    }))
  }
  return { acknowledged: [...acknowledged], rejected: [...rejected],
    dispositions: input.ids.map(id => results.get(id) || { id, disposition: 'missing' as const }), inbox: readAgentInbox({ project: input.project }, scope) }
}
