import type { Mindmap, MindmapNode } from '@/lib/types'
import { sha256Hex } from '@/lib/mindmap/sha256'
import { DRAFT_MINDMAP_ID } from './todo-map'

export type MentionTodo = { id: string | null, title?: string, text: string, completed: boolean }
export type AgentFieldHashes = Record<string, Record<string, string>>
export const AGENT_MENTION_PATTERN = /(?<![\w@])@agents?(?![\w])/i

export function agentMentionFields(node: MindmapNode, todo?: MentionTodo): Record<string, string | undefined> {
  return { title: todo?.title ?? node.title, text: todo?.text ?? node.text, caption: node.caption, ...node.caution }
}

/** Mask quoted examples while retaining source offsets and authored request bytes. */
export function agentMentionIndex(source: string): number | undefined {
  if (!AGENT_MENTION_PATTERN.test(source)) return undefined
  const mask = (value: string) => value.replace(/[^\n]/g, ' ')
  let fence: string | undefined
  const prose = source.replace(/^.*$/gm, line => {
    if (fence) {
      const end = line.trim()
      if (end.length >= fence.length && [...end].every(character => character === fence![0])) fence = undefined
      return mask(line)
    }
    const start = line.match(/^[\t ]*(`{3,}|~{3,})/)
    if (start) { fence = start[1]; return mask(line) }
    return line
  })
    .replace(/^[\t ]*>[^\n]*/gm, mask)
    .replace(/\\begin\{(verbatim\*?|lstlisting|minted)\}[\s\S]*?\\end\{\1\}/g, mask)
    .replace(/\\verb\*?([^\w\s])[\s\S]*?\1/g, mask)
    .replace(/``[^\n]*?''/g, mask)
    .replace(/<(code|pre|blockquote)\b[^>]*>[\s\S]*?<\/\1>/gi, mask)
    .replace(/(`+)[^\n]*?\1/g, mask)
    .replace(/"(?:\\.|[^"\\\n])*"|“[^”\n]*”|‘[^’\n]*’|(?<!\w)'[^'\n]*'(?!\w)/g, mask)
  return prose.match(AGENT_MENTION_PATTERN)?.index
}

export function collectAgentMention(project: string, mapId: string, nodeId: string, fields: Record<string, string | undefined>, origins?: Record<string, string>) {
  const sources = Object.entries(fields).flatMap(([field, value]) => value && AGENT_MENTION_PATTERN.test(value)
    && (!origins?.[field] || origins[field] !== sha256Hex(value)) ? [{ field, source: value }] : [])
  const tagged = sources.flatMap(({ field, source }) => {
    const index = agentMentionIndex(source)
    return index === undefined ? [] : [{ field, source, text: source.slice(Math.max(0, index - 100), index + 500).trim() }]
  })
  if (!tagged.length) return undefined
  const id = sha256Hex(JSON.stringify([project, mapId, nodeId, sources.map(item => [item.field, item.source])]))
  return { id, mapId, nodeId, text: tagged.map(item => item.text).join('\n').slice(0, 900), fields: tagged.map(item => item.field),
    href: `/p/${encodeURIComponent(project)}/mindmap/${encodeURIComponent(mapId)}#${encodeURIComponent(nodeId)}` }
}

/** Derived human requests, using TeX text for TODO-backed cards and each map's notes. */
export function collectAgentMentions(project: string, maps: Mindmap[], todos: MentionTodo[], limit = 50, agentFields: AgentFieldHashes = {}) {
  const byId = new Map(todos.map(todo => [todo.id, todo]))
  const notes = maps.flatMap(map => map.nodes.flatMap(node => {
    const todo = node.todoId ? byId.get(node.todoId) : undefined
    const mapId = map.id || DRAFT_MINDMAP_ID
    const note = collectAgentMention(project, mapId, node.id, agentMentionFields(node, todo), agentFields[JSON.stringify([mapId, node.id])])
    return note ? [{ ...note, ...(todo ? { todoId: todo.id, completed: todo.completed } : {}) }] : []
  }))
  return { count: notes.length, notes: notes.slice(0, limit), hasMore: notes.length > limit }
}
