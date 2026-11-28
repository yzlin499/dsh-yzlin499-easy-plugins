/**
 * 卡片：折叠结果的唯一对外形态。
 *
 * 纯函数模块——不碰 ctx、不发请求，方便 node --test 直接测。
 * 设计约束（见 Docs/context-optimize/设计-分层折叠与巡航.md）：
 *   1. 渲染与状态分离：机读 facts 在插件侧，模型只看到这里的文本；
 *   2. 骨架固定、段落不省略（空段落写「—」），便于模型扫读与父卡确定性合成；
 *   3. 必含 id / 时间 / turn 区间 / token 数 / 取回方式；禁含正文、长输出、reasoning。
 */

export const CARD_VERSION = 1

/** 卡片长度上限（估算 token）。超了就砍「做了什么」的细节，不砍死路/未闭合/取回。 */
export const CARD_BUDGET_TOKENS = 400

const PATH_RE = /(?:^|[\s'"`([])((?:\.{0,2}\/)?[\w@.-]+(?:\/[\w@.-]+)*\.(?:js|mjs|cjs|ts|tsx|jsx|json|md|ya?ml|py|ps1|sh|toml|ini|css|html|sql))(?![\w@.-])/g
const CMD_RE = /(?:^|[\s'"`(>])((?:npm|pnpm|yarn|node|npx|git|gh|dsh|python|py|pwsh|powershell|dotnet|cargo|go|make|gradle|mvn|uv|pip)(?![\w./@-])\s[^\n`"']{1,120})/g

/** 去掉命令/路径尾部粘上的中英文标点。 */
function trimTrailing(value) {
  return value.replace(/[，。；：、,.;:）)\s]+$/u, '').trim()
}
const ERR_RE = /(?:^|\n)\s*(?:.*?)((?:[A-Z][A-Z0-9_]{2,}(?:_[A-Z0-9]+)*|ERR_[A-Z_]+|error TS\d+|Error: |TypeError: |SyntaxError: ).{0,140})/g

const MAX_FILES = 12
const MAX_CMDS = 8
const MAX_ERRORS = 6
const MAX_TEXT = 240

/** 折叠区里的一段可读文本（来自任意角色的 content block）。 */
function collectText(node, out) {
  if (node === null || node === undefined) return
  if (typeof node === 'string') { out.push(node); return }
  if (Array.isArray(node)) { for (const item of node) collectText(item, out); return }
  if (typeof node !== 'object') return
  if (typeof node.text === 'string') out.push(node.text)
  if (typeof node.content === 'string') out.push(node.content)
  else if (node.content && typeof node.content === 'object') collectText(node.content, out)
}

/** 从消息里确定性抽取事实：文件、命令、错误、工具名、用户原始请求。 */
export function buildFacts(messages, options = {}) {
  const texts = []
  for (const message of messages ?? []) collectText(message?.content ?? message, texts)
  const blob = texts.join('\n')

  const files = new Map()
  for (const match of blob.matchAll(PATH_RE)) {
    const path = trimTrailing(match[1]).replace(/^\.\//, '')
    if (path.length < 3) continue
    files.set(path, (files.get(path) ?? 0) + 1)
  }

  const commands = new Map()
  for (const match of blob.matchAll(CMD_RE)) {
    const cmd = trimTrailing(match[1]).replace(/\s+/g, ' ')
    if (cmd.length < 3) continue
    commands.set(cmd, (commands.get(cmd) ?? 0) + 1)
  }

  const errors = []
  for (const match of blob.matchAll(ERR_RE)) {
    const line = match[1].trim().replace(/\s+/g, ' ').slice(0, MAX_TEXT)
    if (line.length < 6) continue
    if (errors.some((existing) => existing === line)) continue
    errors.push(line)
  }

  const tools = new Map()
  const argCommands = []
  const walkTools = (node) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'tool-call' || node.type === 'tool_call') {
      const toolName = node.name ?? node.toolName
      if (toolName) tools.set(String(toolName), (tools.get(String(toolName)) ?? 0) + 1)
      // 命令通常只出现在工具参数里（JSON 字符串），正文里看不到。
      let parsed = node.arguments ?? node.args
      if (typeof parsed === 'string') {
        try { parsed = JSON.parse(parsed) } catch { parsed = undefined }
      }
      if (parsed && typeof parsed === 'object') {
        for (const key of ['command', 'cmd', 'script']) {
          const value = parsed[key]
          if (typeof value === 'string' && value.trim().length >= 3) {
            argCommands.push(value.trim().replace(/\s+/g, ' '))
          }
        }
      }
    }
    for (const value of Object.values(node)) if (value && typeof value === 'object') walkTools(value)
  }
  for (const message of messages ?? []) walkTools(message)
  for (const command of argCommands) commands.set(command, (commands.get(command) ?? 0) + 1)

  const userAsk = (options.userAsk ?? findFirstUserText(messages) ?? '').trim()

  return {
    files: [...files.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_FILES).map(([path]) => path),
    commands: [...commands.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_CMDS)
      .map(([cmd, count]) => ({ cmd, count })),
    errors: errors.slice(0, MAX_ERRORS).map((text) => ({ text })),
    tools: [...tools.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
    userAsk: userAsk.slice(0, MAX_TEXT),
  }
}

function findFirstUserText(messages) {
  for (const message of messages ?? []) {
    if (message?.role !== 'user') continue
    const texts = []
    collectText(message.content, texts)
    const text = texts.join(' ').trim()
    if (text.length > 0) return text
  }
  return ''
}

/** 稳定短 id：同一段折叠重复渲染得到同一个 id（便于 A/B 与父卡合并）。 */
export function cardId(facts, meta = {}) {
  const seed = `${meta.turns?.[0] ?? ''}:${meta.turns?.[1] ?? ''}:${facts.userAsk}`
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `ep_${(hash >>> 0).toString(16).padStart(8, '0').slice(0, 6)}`
}

const EN = {
  what: 'What happened',
  request: 'Original request',
  files: 'Files',
  commands: 'Commands',
  errors: 'Errors',
  open: 'Still open',
  dead: 'Dead ends (do not retry)',
  retrieve: 'Retrieve',
  none: '—',
  restored: 'restored',
  unclaimed: '(no summary line)',
}

const ZH = {
  what: '做了什么',
  request: '原始请求',
  files: '涉及文件',
  commands: '命令',
  errors: '错误',
  open: '未闭合',
  dead: '死路（别重试）',
  retrieve: '取回',
  none: '—',
  restored: '已还原',
  unclaimed: '（未标注）',
}

function labels(locale) {
  return locale === 'en' ? EN : ZH
}

function section(title, lines, L) {
  const body = lines.length > 0 ? lines.join('\n') : L.none
  return `## ${title}\n${body}`
}

/**
 * 渲染卡片正文。
 * @param {object} facts - buildFacts() 的结果。
 * @param {object} meta - { id, turns:[start,end], startedAt, tokens, foldedAtTurn, claim, locale, deadEnds, open, folded }
 * @returns {string} 模型看到的卡片文本。
 */
export function renderCard(facts, meta = {}) {
  const L = labels(meta.locale)
  const id = meta.id ?? cardId(facts, meta)
  const turns = meta.turns ? ` · turns ${meta.turns[0]}–${meta.turns[1]}` : ''
  const time = meta.startedAt ? ` · ${meta.startedAt}` : ''
  const tokenText = meta.tokens ? ` · ${formatTokens(meta.tokens)} tok → ~0.4K` : ''
  const foldedAt = meta.foldedAtTurn ? ` · folded @turn ${meta.foldedAtTurn}` : ''
  const header = `[${id}${time}${turns}${tokenText}${foldedAt}]`

  const claim = (meta.claim ?? '').trim() || L.unclaimed

  const parts = [header, section(L.what, [claim], L)]

  if (facts.userAsk) parts.push(section(L.request, [`> ${facts.userAsk}`], L))

  parts.push(section(L.files, (facts.files ?? []).map((path) => `- ${path}`), L))
  parts.push(section(
    L.commands,
    (facts.commands ?? []).map(({ cmd, count }) => `- ${cmd}${count > 1 ? ` ×${count}` : ''}`),
    L,
  ))
  parts.push(section(L.errors, (facts.errors ?? []).map(({ text }) => `- ${text}`), L))
  parts.push(section(L.open, (meta.open ?? []).map((line) => `- ${line}`), L))
  parts.push(section(L.dead, (meta.deadEnds ?? []).map((line) => `- ${line}`), L))

  // v0.2 提供 ask/expand 工具后才渲染取回段：没有工具却写「可以问」，
  // 等于教模型去调用一个不存在的工具。
  if (meta.retrieval === true) {
    parts.push(section(L.retrieve, [
      `ask ${id} "<question>"`,
      `expand ${id} <${L.restored}>`,
    ], L))
  }

  return parts.join('\n\n')
}

export function formatTokens(tokens) {
  if (!Number.isFinite(tokens)) return '?'
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`
  return String(tokens)
}

/** 粗略 token 估算（与官方 token meter 同一量级：约 4 字符/token，CJK 偏低，仅用于预算判断）。 */
export function estimateTokens(text) {
  return Math.ceil(String(text ?? '').length / 4)
}

/** 巡航一次性调用的指令：只让它写「做了什么」与两点结论，其余字段由代码抽取。 */
export const CLAIM_INSTRUCTION = [
  'You are the cruise agent of a context-folding layer. Below is a span of an earlier conversation that is about to be replaced by a one-screen card.',
  '',
  'Write the card body only, in the SAME language as the conversation, as exactly three blocks:',
  '',
  'CLAIM: one sentence (<= 60 words) saying what this span did or decided.',
  'CONCLUDE: 0-3 bullets, each a fact the next model would otherwise have to re-derive. No file lists, no command lists — those are extracted separately.',
  'OPEN: 0-3 bullets of explicitly unfinished work or unverified assumptions. Write "(none)" when empty.',
  '',
  'Rules:',
  '- Never invent details. If the span is only exploration, say so plainly.',
  '- Do not mention this request, the folding, or the card.',
  '- No headings, no preamble, no closing remarks: output only the three labelled blocks.',
].join('\n')

/**
 * 解析巡航输出。缺字段时降级（claim 为空、结论为空），绝不抛错——
 * 卡片必须永远能渲染出来，否则折叠会卡住整轮。
 */
export function parseClaim(text) {
  const source = String(text ?? '')
  const grab = (name) => {
    const re = new RegExp(`${name}\\s*:([\\s\\S]*?)(?=\\n\\s*(?:CLAIM|CONCLUDE|OPEN)\\s*:|$)`, 'i')
    const match = source.match(re)
    return match ? match[1].trim() : ''
  }
  const bullets = (value) => value.split('\n')
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .filter((line) => line.length > 0 && !/^\(?none\)?$/i.test(line))
  return {
    claim: grab('CLAIM').split('\n')[0].trim(),
    conclude: bullets(grab('CONCLUDE')),
    open: bullets(grab('OPEN')),
  }
}
