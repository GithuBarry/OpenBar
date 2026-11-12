export type InboxNotification = {
  id: string
  project: string
  mapId: string
  nodeId: string
  todoId?: string | null
  text: string
  fields: string[]
  href: string
  acknowledged: boolean
}

export type AgentInbox = {
  count: number
  notifications: InboxNotification[]
  hasMore: boolean
  revision: string
  replies: AgentReply[]
}

export type AgentReply = {
  project: string
  mapId: string
  nodeId: string
  responseRevision: string
  contentHash: string
  repliedAt: string
}

export const AGENT_INBOX_ACTOR_HEADER = 'X-OpenBar-Actor'

export const INBOX_GUIDANCE = 'At the start of each OpenBar agent session, including one without earlier chat context, call check_inbox after get_project_state. Treat "tick", "check updates", "check inbox", and "sync" as requests to call check_inbox. When sync also names a Git or Overleaf action, check the inbox first, then perform the requested synchronization. Tool responses can prefix pending OpenBar requests. Read each linked card and its current context, respond there within the user’s instructions, then acknowledge the exact notification IDs. Repeated IDs refer to the same request. Changed request text receives a new ID. Acknowledgement records delivery handling. Paper TODO completion remains a separate research decision.'

export const INBOX_TOOL_DESCRIPTIONS = {
  check_inbox: 'Check human @agent requests at the start of every OpenBar agent session, including without earlier chat context. Suggested user phrases: "tick", "check updates", "check inbox", "sync". Returns pending request IDs, text and card links. includeAcknowledged also shows handled requests. Read the linked context, reply there, then acknowledge the exact IDs.',
  acknowledge_inbox: 'Mark exact OpenBar notification IDs as handled after replying on their cards. Set acknowledged=false to reopen them. The original request text and paper TODO completion are preserved.',
}

export function formatInboxPrefix(inbox: AgentInbox): string {
  if (inbox.count === 0) return ''
  return `OpenBar inbox: ${inbox.count} pending request${inbox.count === 1 ? '' : 's'}. Read the linked context, reply on the card, then use acknowledge_inbox with the exact IDs.\n${JSON.stringify(inbox.notifications)}${inbox.hasMore ? '\nCall check_inbox for more requests.' : ''}`
}
