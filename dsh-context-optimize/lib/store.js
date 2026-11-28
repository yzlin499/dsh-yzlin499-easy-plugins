/**
 * 折叠账本（本插件私有状态）的共享单例。
 *
 * 压缩后端（compaction.js）负责写，工具（tools.js）负责读；两者同属
 * `context-optimize` preset 的 realm，同一个进程、同一个模块实例。
 * 不进 Session 日志：这是插件的运行期缓存，丢了只影响取回，不影响会话本身。
 */

const MAX_SPANS_PER_SESSION = 32
const MAX_TEXT_CHARS = 400_000

/** sessionId → Map<spanId, span> */
const sessions = new Map()
/** sessionId → 最近一次请求折叠的标记 */
const pending = new Set()
/** sessionId → 最近活跃的会话（工具取不到 initiator 时的兜底） */
const lastActive = new Map()

function bucket(sessionId) {
  const key = String(sessionId ?? '')
  let map = sessions.get(key)
  if (map === undefined) {
    map = new Map()
    sessions.set(key, map)
  }
  return map
}

export function noteActive(sessionId) {
  if (sessionId === undefined || sessionId === null) return
  const key = String(sessionId)
  lastActive.set(key, Date.now())
  if (lastActive.size > 64) {
    const oldest = [...lastActive.entries()].sort((a, b) => a[1] - b[1])[0]
    if (oldest !== undefined) lastActive.delete(oldest[0])
  }
}

export function recentSessionId() {
  const entries = [...lastActive.entries()].sort((a, b) => b[1] - a[1])
  return entries[0]?.[0]
}

/** 存一段被折区间：卡片文本 + 原文文本 + 位置。超出上限时丢弃最旧的。 */
export function recordSpan(sessionId, span) {
  const map = bucket(sessionId)
  const text = String(span.text ?? '')
  const entry = {
    id: span.id,
    card: String(span.card ?? ''),
    text: text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}\n…(归档截断)` : text,
    truncated: text.length > MAX_TEXT_CHARS,
    tokens: Number(span.tokens) || 0,
    nodes: Number(span.nodes) || 0,
    start: span.start ?? null,
    end: span.end ?? null,
    at: Number(span.at) || Date.now(),
    path: span.path ?? null,
  }
  map.set(entry.id, entry)
  while (map.size > MAX_SPANS_PER_SESSION) {
    const oldest = [...map.keys()][0]
    map.delete(oldest)
  }
  noteActive(sessionId)
  return entry
}

export function listSpans(sessionId) {
  return [...bucket(sessionId).values()].sort((a, b) => a.at - b.at)
}

export function getSpan(sessionId, spanId) {
  const map = bucket(sessionId)
  if (spanId === undefined || spanId === null || spanId === '') {
    const all = listSpans(sessionId)
    return all[all.length - 1]
  }
  return map.get(String(spanId))
}

export function requestFold(sessionId) {
  const key = String(sessionId ?? '')
  pending.add(key)
  return key
}

export function consumeFoldRequest(sessionId) {
  return pending.delete(String(sessionId ?? ''))
}

export function hasFoldRequest(sessionId) {
  return pending.has(String(sessionId ?? ''))
}

/** 仅供测试：清空所有状态。 */
export function resetStore() {
  sessions.clear()
  pending.clear()
  lastActive.clear()
}
