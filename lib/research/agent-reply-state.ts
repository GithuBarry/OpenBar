import type { MindmapNode } from '@/lib/types'
import { sha256Hex } from '@/lib/mindmap/sha256'
import type { AgentFieldHashes } from './agent-mentions'
import type { AgentRequestHistory } from './agent-inbox-contract'
import { mindmapCardContentForTodo, ordinaryMindmapCardContent } from './todo-map'

export type ReplyPublication = { responseRevision: string, contentHash: string, repliedAt: string }
export type AgentReplyReceipt = {
  requestId: string
  currentNotificationId: string | null
  mapId: string
  nodeId: string
  /** The request card stays separate from additional answer cards. */
  requestNodeId?: string
  question?: string
  contentHash: string
  responseRevision: string
  updatedAt?: string
  published?: ReplyPublication
}
export type AgentInboxReceipts = {
  version: 1
  acknowledged: string[]
  receipts: Record<string, AgentReplyReceipt>
  agentFieldHashes?: AgentFieldHashes
  history?: AgentRequestHistory[]
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable((value as Record<string, unknown>)[key])]))
  return value
}

export function agentReplyCardKey(mapId: string, nodeId: string): string { return JSON.stringify([mapId, nodeId]) }

/** The authored request stays available for inbox identity and history. */
export function cleanAgentReplyDisplay(text: string): string {
  const markerOnly = /^\s*(?:(\*\*|__|\*|_)@agents?\1|\\(?:textbf|textit|emph)\{\s*@agents?\s*\})[\t ]*/i
  if (markerOnly.test(text)) return text.replace(markerOnly, '').trim()
  const leading = /^(\s*(?:(?:\*\*|__|\*|_)|\\(?:textbf|textit|emph)\{)*)@agents?(?![\w])[\t ]*/i
  return text.replace(leading, '$1').trim()
}

/** Published replies hide the request marker for their current generation. */
export function answeredAgentRequestNodeIds(replies: readonly { nodeId: string, requestNodeId?: string, requestCurrent?: boolean }[]): Set<string> {
  const result = new Set<string>()
  for (const reply of replies) {
    if (reply.requestCurrent !== false) result.add(reply.requestNodeId || reply.nodeId)
  }
  return result
}

/** Shared saved/live projection. TeX supplies TODO text and maps supply their notes. */
export function agentReplyContentHash(node: MindmapNode, todo?: { title?: string, text: string }): string {
  const content = todo ? mindmapCardContentForTodo(todo) : ordinaryMindmapCardContent(node)
  return sha256Hex(JSON.stringify(stable({
    title: content.title, text: content.body,
    caption: node.caption || '',
    caution: { critical: node.caution?.critical || '', important: node.caution?.important || '', background: node.caution?.background || '' },
    refs: (node.refs || []).map(ref => ({ kind: ref.kind, id: ref.kind === 'paper-section' ? ref.sectionContext?.label || ref.id : ref.id,
      label: ref.label || '', url: ref.url || '', ...(ref.kind === 'mindmap-node' ? { mapId: ref.mapId || 'draft' } : {}) })),
    contentFormat: node.todoId ? 'tex' : node.contentFormat || 'plain',
  })))
}

export function agentReplyRevision(requestId: string, contentHash: string): string { return sha256Hex(JSON.stringify([requestId, contentHash])) }

export function agentReplyRequestId(state: AgentInboxReceipts, note: { id: string, mapId: string, nodeId: string }): string {
  const receipt = state.receipts[agentReplyCardKey(note.mapId, note.nodeId)]
  return receipt?.currentNotificationId === note.id ? receipt.requestId : note.id
}
