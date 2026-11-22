export type InboxDisposition = 'acknowledged' | 'already_resolved' | 'reopened' | 'already_open' | 'stale' | 'missing'
export type InboxAcknowledgement = { id: string, disposition: InboxDisposition, project?: string, requestId?: string }
export type AgentRequestHistory = {
  id: string
  mapId: string
  nodeId: string
  question: string
  href: string
  recordedAt: string
  updatedAt: string
  disposition: 'captured' | InboxDisposition
  replies: Array<{ mapId: string, nodeId: string, href: string, responseRevision: string, repliedAt?: string, updatedAt?: string }>
}

export type InboxNotification = {
  id: string
  project: string
  mapId: string
  nodeId: string
  todoId?: string | null
  text: string
  fields: string[]
  priority?: 'fast-tracked'
  href: string
  acknowledged: boolean
}

export type AgentInbox = {
  count: number
  notifications: InboxNotification[]
  hasMore: boolean
  revision: string
  replies: AgentReply[]
  history?: Array<AgentRequestHistory & { project: string }>
}

export type AgentReply = {
  project: string
  mapId: string
  nodeId: string
  requestNodeId?: string
  question?: string
  requestCurrent?: boolean
  responseRevision: string
  contentHash: string
  repliedAt: string
}

export const AGENT_INBOX_ACTOR_HEADER = 'X-OpenBar-Actor'

export const ANSWER_CARD_GUIDANCE = 'Remove the @agent or @stat marker from the reader-facing answer. Write for someone who never saw the conversation, using the terms and style of neighboring cards. Replace or rephrase the visible question, or keep a concise Q&A when the question helps explain the answer. Preserve the original wording once in its owning paper or map. When replacing a map-owned ask, move it into caption (collapsed Notes) in the same patch and retain existing notes.'

export const INBOX_GUIDANCE = `At session start, call check_inbox after get_project_state; also call it on "tick", "check updates", "check inbox", or "sync" (before Git sync). Handle fast-tracked @stat ("agent STAT") requests first. Reply on the linked card or Agent draft children. ${ANSWER_CARD_GUIDANCE} After saving the reply, call acknowledge_inbox with the exact notification IDs. Repeated IDs identify the same request. Edited request text receives a new ID. Paper TODO completion is a separate decision.`

export const INBOX_TOOL_DESCRIPTIONS = {
  check_inbox: 'List pending human @agent and fast-tracked @stat requests with card links (fast-tracked first). For reply wording, see the bundled mindmap-writing skill. Set includeAcknowledged=true for handled history.',
  acknowledge_inbox: 'Mark exact notification IDs as handled after replying (set acknowledged=false to reopen). Preserves card content and paper TODO completion.',
}

export function formatInboxPrefix(inbox: AgentInbox): string {
  if (inbox.count === 0) return ''
  const fastTracked = inbox.notifications.some(note => !note.acknowledged && note.priority === 'fast-tracked')
  const summary = inbox.notifications.map(note => {
    const tag = note.priority === 'fast-tracked' ? '[agent STAT] ' : ''
    const snippet = note.text.replace(/\s+/g, ' ').trim().slice(0, 140)
    return `- ${tag}${note.id} (${note.project}/${note.mapId}#${note.nodeId}): ${snippet}`
  }).join('\n')
  return `OpenBar inbox: ${inbox.count} pending request${inbox.count === 1 ? '' : 's'}${fastTracked ? ' (handle agent STAT first)' : ''}. Read linked context, reply with concise cards, then acknowledge_inbox with exact IDs.\n${summary}${inbox.hasMore ? '\nCall check_inbox for more requests.' : ''}`
}
