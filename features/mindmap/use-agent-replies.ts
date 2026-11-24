"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { agentInboxKey, useAgentInbox } from "@/features/use-agent-inbox"
import type { AgentInbox, AgentMentionLocation } from "@/lib/research/agent-inbox-contract"
import { answeredAgentRequests } from "@/lib/research/agent-reply-state"

type Reply = AgentInbox["replies"][number]
type ReplyState = { scope: string, replies: Reply[], seen: Record<string, string> }
type WorkingNodeClaim = { mention: AgentMentionLocation, expiresAt: string }

function seenPrefix(project: string, mapId: string) {
  return `openbar:agent-reply-seen:v1:${encodeURIComponent(project)}:${encodeURIComponent(mapId)}:`
}

function seenKey(prefix: string, reply: Reply) {
  return prefix + encodeURIComponent(reply.nodeId) + ":" + encodeURIComponent(reply.responseRevision)
}

function storedSeen(prefix: string, replies: Reply[]): Record<string, string> {
  const seen: Record<string, string> = {}
  try {
    for (const reply of replies) {
      if (window.localStorage.getItem(seenKey(prefix, reply)) === "1") seen[reply.nodeId] = reply.responseRevision
    }
  } catch { /* Read state remains available in this tab when storage is unavailable. */ }
  return seen
}

/** Reply delivery uses the existing session revision and inbox endpoint. */
export function useAgentReplies(project: string, mapId: string, inboxRevision?: string, diskHash?: string) {
  const prefix = seenPrefix(project, mapId)
  const inbox = useAgentInbox(project)
  const client = useQueryClient()
  const [state, setState] = useState<ReplyState>({ scope: prefix, replies: [], seen: {} })
  const [now, setNow] = useState(() => Date.now())
  const stateRef = useRef(state)
  stateRef.current = state
  useEffect(() => {
    void client.invalidateQueries({ queryKey: agentInboxKey(project) })
  }, [client, project, inboxRevision, diskHash])
  useEffect(() => {
    const refresh = () => { void client.invalidateQueries({ queryKey: agentInboxKey(project) }) }
    window.addEventListener("openbar-inbox-updated", refresh)
    return () => window.removeEventListener("openbar-inbox-updated", refresh)
  }, [client, project])
  useEffect(() => {
    const publish = (next: ReplyState) => { stateRef.current = next; setState(next) }
    if (Array.isArray(inbox.data?.replies)) {
      const replies = inbox.data.replies.filter(reply => reply.project === project && reply.mapId === mapId)
      const previous = stateRef.current
      publish({ scope: prefix, replies, seen: { ...(previous.scope === prefix ? previous.seen : {}), ...storedSeen(prefix, replies) } })
    }
    const storage = (event: StorageEvent) => {
      if (event.key !== null && !event.key.startsWith(prefix)) return
      const current = stateRef.current
      if (current.scope === prefix) publish({ ...current, seen: { ...current.seen, ...storedSeen(prefix, current.replies) } })
    }
    window.addEventListener("storage", storage)
    return () => {
      window.removeEventListener("storage", storage)
    }
  }, [project, mapId, prefix, inbox.data])

  // Auto-expire spinning working indicators on the exact 30-minute boundary without requiring reload.
  useEffect(() => {
    const notifications = inbox.data?.notifications
    if (!notifications?.length) return
    const currentNow = Date.now()
    let earliest = Number.POSITIVE_INFINITY
    for (const note of notifications) {
      if (note.mapId !== mapId || note.acknowledged || !note.workingUntil || !note.workingMention) continue
      const expiry = Date.parse(note.workingUntil)
      if (Number.isFinite(expiry) && expiry > currentNow && expiry < earliest) earliest = expiry
    }
    if (!Number.isFinite(earliest)) return
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(2_147_483_647, Math.max(50, earliest - currentNow + 50)))
    return () => window.clearTimeout(timer)
  }, [inbox.data, mapId, now])

  const markRead = useCallback((nodeId: string, contentHash: string) => {
    const current = stateRef.current
    const reply = current.scope === prefix ? current.replies.find(item => item.nodeId === nodeId) : undefined
    if (!reply || reply.contentHash !== contentHash || current.seen[nodeId] === reply.responseRevision) return
    const next = { ...current, seen: { ...current.seen, [nodeId]: reply.responseRevision } }
    stateRef.current = next
    setState(next)
    try { window.localStorage.setItem(seenKey(prefix, reply), "1") }
    catch { /* The current tab retains its read state. */ }
  }, [prefix])

  const replies = useMemo(() => state.scope === prefix ? state.replies : [], [state.scope, state.replies, prefix])
  const unreadNodeIds = useMemo(() => new Set(replies
    .filter(reply => state.seen[reply.nodeId] !== reply.responseRevision).map(reply => reply.nodeId)), [replies, state.seen])
  const answeredRequests = useMemo(() => {
    const pending = new Set(inbox.data?.notifications.filter(note => note.mapId === mapId && !note.acknowledged).map(note => note.nodeId))
    return answeredAgentRequests(replies, pending)
  }, [replies, inbox.data, mapId])
  const workingByNode = useMemo(() => {
    const active = new Map<string, WorkingNodeClaim>()
    for (const note of inbox.data?.notifications || []) {
      if (note.mapId !== mapId || note.acknowledged || !note.workingUntil || !note.workingMention) continue
      const expiry = Date.parse(note.workingUntil)
      if (!Number.isFinite(expiry) || expiry <= now) continue
      active.set(note.nodeId, { mention: note.workingMention, expiresAt: note.workingUntil })
    }
    return active
  }, [inbox.data, mapId, now])

  return { replies, unreadNodeIds, answeredRequests, workingByNode, markRead }
}
