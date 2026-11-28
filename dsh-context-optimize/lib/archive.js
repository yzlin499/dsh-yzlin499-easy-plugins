/**
 * 折叠区归档：把「被折掉的那段」原文留在自己手里。
 *
 * 为什么自己存一份：官方会话日志里确实有（shadowed 表面可查），但
 *   1. 从 preset realm 里读日志要过 sessionQuery，且被 spill 过的大结果正文
 *      本来就不在日志里（实测：log 里只剩 stub + 一个 %TEMP% 下会消失的地址）；
 *   2. 询问/展开需要「按 spanId 直接取一段文本」，日志是按 seq 索引的。
 * 所以我们折叠时顺手把 `summarize()` 拿到的区域消息序列化一份（有大小上限），
 * 同时在磁盘留一份（重启后仍可取）。
 */

import { createHash } from 'node:crypto'

export const MAX_ARCHIVE_CHARS = 400_000

/** 稳定 span id：同一段内容重复折叠得到同一个 id。 */
export function spanIdOf(messages, meta = {}) {
  const seed = `${meta.start ?? ''}:${meta.end ?? ''}:${String(meta.at ?? '')}:${renderTranscript(messages).length}`
  return `sp_${createHash('sha1').update(seed).digest('hex').slice(0, 8)}`
}

/** 把消息序列成可读、可再喂给模型的纯文本（不带任何工具调用二进制）。 */
export function renderTranscript(messages, options = {}) {
  const limit = Number(options.limit ?? MAX_ARCHIVE_CHARS)
  const blocks = []
  for (const message of messages ?? []) {
    const role = String(message?.role ?? 'unknown')
    const parts = []
    collect(message?.content ?? message, parts)
    const body = parts.join('\n').trim()
    if (body.length === 0) continue
    blocks.push(`<${role}>\n${body}\n</${role}>`)
  }
  const text = blocks.join('\n\n')
  return text.length > limit ? `${text.slice(0, limit)}\n…(归档截断)` : text
}

function collect(node, out) {
  if (node === null || node === undefined) return
  if (typeof node === 'string') { out.push(node); return }
  if (Array.isArray(node)) { for (const item of node) collect(item, out); return }
  if (typeof node !== 'object') return
  if (node.type === 'tool-call' || node.type === 'tool_call') {
    const name = node.name ?? node.toolName ?? 'tool'
    const args = typeof node.arguments === 'string' ? node.arguments : JSON.stringify(node.arguments ?? {})
    out.push(`[call ${name}] ${String(args).slice(0, 400)}`)
    return
  }
  if (typeof node.text === 'string') out.push(node.text)
  else if (typeof node.content === 'string') out.push(node.content)
  else if (node.content && typeof node.content === 'object') collect(node.content, out)
}

/** 归档目录：优先 DSH_HOME，退回 ~/.dsh。 */
export function archiveRoot(env = process.env, home = '') {
  const base = env.DSH_HOME && env.DSH_HOME.length > 0 ? env.DSH_HOME : `${home}/.dsh`
  return `${base}/storages/context-optimize/spans`
}

/**
 * 落盘一份原文。失败不抛错——归档是「更好」，不是「必须」；
 * 内存里那份仍然能供本轮询问/展开使用。
 */
export async function persistSpan(fs, path, root, sessionId, spanId, text) {
  try {
    const dir = path.join(root, String(sessionId))
    await fs.mkdir(dir, { recursive: true })
    const file = path.join(dir, `${spanId}.txt`)
    await fs.writeFile(file, text, 'utf8')
    return file
  } catch {
    return null
  }
}

/** 按关键词从归档里挑出相关片段（询问回路的「要更多」用它取料）。 */
export function excerpts(text, keyword, options = {}) {
  const window = Number(options.window ?? 1200)
  const max = Number(options.max ?? 3)
  const source = String(text ?? '')
  const needle = String(keyword ?? '').trim()
  if (source.length === 0) return []
  if (needle.length === 0) return [source.slice(0, window)]
  const lower = source.toLowerCase()
  const target = needle.toLowerCase()
  const hits = []
  let from = 0
  while (hits.length < max) {
    const at = lower.indexOf(target, from)
    if (at < 0) break
    hits.push(source.slice(Math.max(0, at - Math.floor(window / 2)), Math.min(source.length, at + window)))
    from = at + target.length
  }
  return hits.length > 0 ? hits : [source.slice(0, window)]
}
