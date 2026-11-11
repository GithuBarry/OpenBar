import type { Mindmap } from "@/lib/types"
import { sha256Hex } from "@/lib/mindmap/sha256"
import { DRAFT_MINDMAP_ID } from "./todo-map"

type MentionTodo = { id: string | null, title?: string, text: string, completed: boolean }

export const AGENT_MENTION_PATTERN = /(?<![\w@])@agents?(?![\w])/i

/** Derived requests, using TeX text for TODO-backed cards and each map's notes. */
export function collectAgentMentions(project: string, maps: Mindmap[], todos: MentionTodo[], limit = 50) {
  const byId = new Map(todos.map(todo => [todo.id, todo]))
  const notes = maps.flatMap(map => map.nodes.flatMap(node => {
    const todo = node.todoId ? byId.get(node.todoId) : undefined
    const fields = { title: todo?.title ?? node.title, text: todo?.text ?? node.text, caption: node.caption, ...node.caution }
    const tagged = Object.entries(fields).flatMap(([field, value]) => {
      const match = value?.match(AGENT_MENTION_PATTERN)
      return match ? [{ field, source: value, text: value!.slice(Math.max(0, match.index! - 100), match.index! + 500).trim() }] : []
    })
    if (!tagged.length) return []
    const mapId = map.id || DRAFT_MINDMAP_ID
    const id = sha256Hex(JSON.stringify([project, mapId, node.id, tagged.map(item => [item.field, item.source])]))
    return [{ id, mapId, nodeId: node.id, ...(todo ? { todoId: todo.id, completed: todo.completed } : {}),
      text: tagged.map(item => item.text).join("\n").slice(0, 900), fields: tagged.map(item => item.field),
      href: `/p/${encodeURIComponent(project)}/mindmap/${encodeURIComponent(mapId)}#${encodeURIComponent(node.id)}` }]
  }))
  return { count: notes.length, notes: notes.slice(0, limit), hasMore: notes.length > limit }
}
