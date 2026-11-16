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

export const INBOX_GUIDANCE = 'At the start of each OpenBar agent session, including one without earlier chat context, call check_inbox after get_project_state. Treat "tick", "check updates", "check inbox", and "sync" as requests to call check_inbox. When sync also names a Git or Overleaf action, check the inbox first, then perform the requested synchronization. Saved @stat mentions display as agent STAT and enter the inbox as fast tracked requests. Handle fast tracked requests first using the same reply and acknowledgement flow. Tool responses can prefix pending OpenBar requests. Read each linked card and its current context. Reply on that card or Agent draft child cards using ordinary subject titles and direct answer text. Keep useful existing card wording. Use collapsed Notes for supporting detail. Preserve original request wording in its existing location or collapsed Notes. When moving map-owned request wording into caption, save it in the same patch as the visible card changes. After replying, acknowledge the original notification IDs. Repeated IDs refer to the same request. Changed request text receives a new ID. Acknowledgement records delivery handling. Paper TODO completion remains a separate research decision.'

export const INBOX_TOOL_DESCRIPTIONS = {
  check_inbox: 'Check human @agent and @stat requests at the start of every OpenBar agent session, including without earlier chat context. Suggested user phrases: "tick", "check updates", "check inbox", "sync". Returns pending request IDs, text and card links, with @stat requests marked fast-tracked and ordered first. includeAcknowledged also shows handled requests and bounded durable request history. Read the linked context, reply on the card or Agent draft children using ordinary card content, then acknowledge the exact IDs.',
  acknowledge_inbox: 'Mark exact OpenBar notification IDs as handled after replying on their cards. Set acknowledged=false to reopen them. Returns a disposition for every supplied ID and retains original request text and reply links in bounded history. Acknowledgement preserves saved card content and paper TODO completion.',
}

export function formatInboxPrefix(inbox: AgentInbox): string {
  if (inbox.count === 0) return ''
  const fastTracked = inbox.notifications.some(note => !note.acknowledged && note.priority === 'fast-tracked')
  return `OpenBar inbox: ${inbox.count} pending request${inbox.count === 1 ? '' : 's'}. ${fastTracked ? 'Fast tracked agent STAT requests appear first. Handle them first using the standard acknowledgement flow. ' : ''}Read the linked context, reply with ordinary cards, then use acknowledge_inbox with the exact IDs.\n${JSON.stringify(inbox.notifications)}${inbox.hasMore ? '\nCall check_inbox for more requests.' : ''}`
}
