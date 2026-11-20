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

export const INBOX_GUIDANCE = 'At the start of each OpenBar agent session, including one without earlier chat context, call check_inbox after get_project_state. Treat "tick", "check updates", "check inbox", and "sync" as requests to call check_inbox. When sync also names a Git or Overleaf action, check the inbox first, then perform the requested synchronization. Saved @stat mentions display as agent STAT and enter the inbox as fast tracked requests—handle them first using the same reply and acknowledgement flow. Tool responses can prefix pending OpenBar requests. Read each linked card and context, reply on that card or Agent draft child cards (preserving useful existing wording and original request text in place or in collapsed Notes; save moved request text into caption in the same patch), then call acknowledge_inbox with the exact notification IDs. Repeated IDs refer to the same request; edited request text receives a new ID. Acknowledgement records delivery handling, while paper TODO completion remains a separate research decision.'

export const INBOX_TOOL_DESCRIPTIONS = {
  check_inbox: 'Check human @agent and @stat requests at the start of every OpenBar agent session, including without earlier chat context. Suggested user phrases: "tick", "check updates", "check inbox", "sync". Returns pending request IDs, text and card links, with @stat requests marked fast-tracked and ordered first. includeAcknowledged also shows handled requests and bounded durable request history. Read the linked context, reply on the card or Agent draft children using ordinary card content, then acknowledge the exact IDs.',
  acknowledge_inbox: 'Mark exact OpenBar notification IDs as handled after replying on their cards. Set acknowledged=false to reopen them. Returns a disposition for every supplied ID and retains original request text and reply links in bounded history. Acknowledgement preserves saved card content and paper TODO completion.',
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
