import { existsSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

const READ_ONLY_COMMANDS = new Set([
  'cat', 'cmp', 'dir', 'echo', 'file', 'get-command',
  'get-content', 'get-date', 'get-item', 'get-location', 'get-process',
  'get-childitem', 'get-child-item', 'grep', 'head', 'ls', 'measure-object',
  'pwd', 'readlink', 'resolve-path', 'select-object', 'select-string',
  'sort-object', 'stat', 'tail', 'test-path', 'type', 'uniq',
  'wc', 'where', 'where.exe', 'which', 'write-output',
])

const HOST_EFFECT_COMMANDS = new Set([
  'add-localgroupmember', 'copy-itemproperty', 'diskpart', 'docker', 'format',
  'format.com', 'format-volume', 'groupadd', 'groupdel', 'install-package',
  'invoke-command', 'kill', 'killall', 'kubectl', 'mount', 'move-itemproperty',
  'new-itemproperty', 'new-localuser', 'new-service', 'remove-itemproperty',
  'remove-localuser', 'remove-service', 'rename-itemproperty', 'restart-computer',
  'set-acl', 'set-itemproperty', 'set-service', 'shutdown', 'start-service',
  'stop-computer', 'stop-process', 'stop-service', 'taskkill', 'useradd', 'userdel',
])
const HOST_PROVIDER_PATTERN = /(?:\b(?:HKLM|HKCU|HKCR|HKU|HKCC):|\b(?:Registry|Cert|WSMan):{1,2})/i
const DYNAMIC_PATH_PATTERN = /(?:\$env:|\$\{?env\b|%[A-Za-z_][A-Za-z0-9_]*%|(?:^|[\s="'])~[\\/])/i
const NESTED_EXECUTION_PATTERN = /(?:\$\(|`|<\(|[(){}]|(?:^|[^&])&(?!&))/
const MASS_DESTRUCTIVE_PATTERNS = [
  /\brm\b[^\r\n]*(?:--recursive\b|-[a-z]*r[a-z]*\b)/i,
  /\bremove-item\b[^\r\n]*(?:--recursive\b|-recurse\b)/i,
  /\b(?:del|erase|rd|rmdir)\b[^\r\n]*\/s\b/i,
  /\b(?:rm|remove-item|del|erase|rd|rmdir)\b[^\r\n]*(?:\*|--all\b)/i,
  /\bgit\s+clean\b[^\r\n]*-[a-z]*f[a-z]*d|\bgit\s+clean\b[^\r\n]*-[a-z]*d[a-z]*f/i,
  /\b(?:drop\s+(?:database|schema|table|collection)|truncate\s+(?:database|schema|table)|delete\s+from)\b/i,
  /\b(?:dropDatabase|dropCollection|deleteMany|removeMany|purgeDatabase|wipeDatabase)\b/i,
  /(?:^|[_-])(?:delete|drop|truncate|clear|purge|wipe)[_-](?:all|many|bulk|database|schema|table|collection|files|directories)(?=$|[^A-Za-z0-9])/i,
]

function pathKey(value) {
  const normalized = resolve(String(value))
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

export function canonicalPath(value) {
  const absolute = resolve(String(value))
  let cursor = absolute
  const tail = []
  while (!existsSync(cursor)) {
    const parent = dirname(cursor)
    if (parent === cursor) break
    tail.unshift(cursor.slice(parent.length).replace(/^[\\/]+/, ''))
    cursor = parent
  }
  try {
    const base = realpathSync.native(cursor)
    return resolve(base, ...tail)
  } catch {
    return absolute
  }
}

export function isInsideWorkspace(target, workspaceRoot) {
  if (!target || !workspaceRoot) return false
  const root = pathKey(canonicalPath(workspaceRoot))
  const candidate = pathKey(canonicalPath(target))
  const rel = relative(root, candidate)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

function commandTokens(command) {
  return String(command).match(/"(?:[^"\\]|\\.)*"|'[^']*'|[^\s|;&<>]+/g) || []
}

function cleanToken(raw) {
  let token = raw.replace(/^["']|["'],?$/g, '').replace(/^[(),]+|[(),]+$/g, '')
  const equals = token.indexOf('=')
  if (equals >= 0) token = token.slice(equals + 1)
  if (/^[A-Za-z]+:[A-Za-z]:[\\/]/.test(token)) token = token.slice(token.indexOf(':') + 1)
  return token
}

export function referencedPaths(command, workdir) {
  const paths = []
  for (const raw of commandTokens(command)) {
    const token = cleanToken(raw)
    if (!token || /^[a-z][a-z0-9+.-]*:\/\//i.test(token)) continue
    if (/^[A-Za-z]:[\\/]/.test(token) || /^\\\\/.test(token) || token.startsWith('/')) {
      paths.push(resolve(token))
      continue
    }
    if (/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(token)) paths.push(resolve(workdir, token))
  }
  return paths
}

function firstWord(segment) {
  const match = segment.trim().match(/^(?:&\s*)?(?:sudo\s+)?([^\s]+)/i)
  return match ? match[1].replace(/^['"]|['"]$/g, '').toLowerCase() : ''
}

function isReadOnlyGit(segment) {
  const match = segment.trim().match(/^(?:git(?:\.exe)?\s+)([a-z-]+)([\s\S]*)$/i)
  if (!match) return false
  const subcommand = match[1].toLowerCase()
  const rest = match[2]
  if (['ls-files', 'ls-tree', 'rev-parse', 'status'].includes(subcommand)) return true
  if (subcommand === 'branch') return /^\s*(?:(?:-a|-r|-v|-vv|--all|--remotes|--verbose|--show-current|--list)(?:\s+|$))*$/i.test(rest)
  if (subcommand === 'remote') return /^\s*(?:-v|show\s+-n|get-url)(?:\s|$)/i.test(rest)
  if (subcommand === 'config') return /(?:^|\s)(?:--get|--get-all|--get-regexp|--list)(?:\s|$)/i.test(rest)
  return false
}

function curlHasWriteOptions(segment) {
  if (/(?:^|\s)-(?:d|F|T|o|K|D|c)\S*/.test(segment) || /(?:^|\s)-[A-Za-z]*O[A-Za-z]*(?:\s|$)/.test(segment)) return true
  if (/(?:^|\s)(?:--data(?:-ascii|-binary|-raw|-urlencode)?|--form|--form-string|--json|--upload-file|--output|--remote-name|--remote-name-all|--remote-header-name|--config|--cookie-jar|--dump-header|--stderr|--trace(?:-ascii|-time)?)(?:\s|=|$)/i.test(segment)) return true
  const method = segment.match(/(?:^|\s)-X(?:\s+|=)?([^\s=][^\s]*)/)?.[1]
    || segment.match(/(?:^|\s)--request(?:\s+|=)?([^\s=][^\s]*)/i)?.[1]
  return method !== undefined && !/^(?:get|head)$/i.test(method)
}

function hasNetworkWrite(command) {
  if (/\bcurl(?:\.exe)?\b/i.test(command) && curlHasWriteOptions(command)) return true
  if (/\binvoke-(?:restmethod|webrequest)\b[^\r\n]*(?:-body|-form|-infile|-method\s+(?:post|put|patch|delete))\b/i.test(command)) return true
  return /\bwget\b[^\r\n]*--post/i.test(command)
}

function isSafeCurlRead(segment) {
  const tokens = commandTokens(segment).map((raw) => raw.replace(/^["']|["']$/g, ''))
  if (tokens.length < 2 || !/^(?:curl|curl\.exe)$/i.test(tokens[0])) return false
  const safeLong = new Set([
    '--compressed', '--fail', '--fail-with-body', '--head', '--include',
    '--location', '--show-error', '--silent',
  ])
  let hasTarget = false
  for (const token of tokens.slice(1)) {
    if (!token.startsWith('-')) {
      hasTarget = true
      continue
    }
    if (safeLong.has(token.toLowerCase())) continue
    if (/^-[fGsSLIi]+$/.test(token)) continue
    return false
  }
  return hasTarget
}

function isReadOnlyNetwork(segment) {
  const lower = segment.toLowerCase()
  if (/^(?:curl|curl\.exe)\b/.test(lower)) return isSafeCurlRead(segment)
  return false
}

function hasWriteCapableReadOptions(word, segment) {
  if (/^git(?:\.exe)?$/.test(word)) return /(?:^|\s)(?:--output|--ext-diff|--textconv)(?:\s|=|$)/i.test(segment)
  return false
}

export function isClearlyReadOnlyCommand(command) {
  if (NESTED_EXECUTION_PATTERN.test(command) || /(?:^|[^>])>>?/.test(command)) return false
  const segments = String(command).split(/(?:\r?\n|&&|\|\||[;|])/).map((part) => part.trim()).filter(Boolean)
  if (segments.length === 0) return false
  return segments.every((segment) => {
    const word = firstWord(segment)
    if (hasWriteCapableReadOptions(word, segment)) return false
    if (isReadOnlyGit(segment) || isReadOnlyNetwork(segment)) return true
    if (READ_ONLY_COMMANDS.has(word)) return true
    return /^(?:node|npm|pnpm|python|python3|pwsh|powershell)(?:\.exe)?\s+(?:--version|-v)\s*$/i.test(segment)
  })
}

function hasGlobalEffect(command) {
  if (HOST_PROVIDER_PATTERN.test(command)) return true
  const segments = String(command).split(/(?:\r?\n|&&|\|\||[;|])/).map((part) => part.trim()).filter(Boolean)
  return segments.some((segment) => {
    const word = firstWord(segment)
    if (HOST_EFFECT_COMMANDS.has(word) || word.startsWith('disable-') || word.startsWith('enable-')) return true
    if (/^(?:net|net\.exe)$/.test(word)) return /^\s*net(?:\.exe)?\s+(?:localgroup|share|user)\b/i.test(segment)
    if (/^(?:reg|reg\.exe)$/.test(word)) return /^\s*reg(?:\.exe)?\s+(?:add|delete|import|restore|save)\b/i.test(segment)
    if (/^(?:sc|sc\.exe)$/.test(word)) return /^\s*sc(?:\.exe)?\s+(?:config|create|delete|start|stop)\b/i.test(segment)
    return word === 'systemctl' && /^\s*systemctl\s+(?:disable|enable|mask|restart|start|stop)\b/i.test(segment)
  })
}

function isMassDestructiveText(text) {
  return MASS_DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(String(text || '')))
}

export function isMassDestructiveRequest({ toolName, toolDescription, approvalReason, args }) {
  let argumentsText = ''
  try { argumentsText = JSON.stringify(args) } catch {}
  return isMassDestructiveText([toolName, toolDescription, approvalReason, argumentsText].filter(Boolean).join('\n'))
}

export function classifyCommand({ command, workdir, workspaceRoot }) {
  if (typeof command !== 'string' || command.trim() === '') return { decision: 'human', reason: 'missing command text' }
  const cwd = resolve(workspaceRoot, workdir || '.')

  if (isMassDestructiveText(command)) return { decision: 'human', reason: 'matched a mass-destructive operation' }
  if (hasGlobalEffect(command)) return { decision: 'human', reason: 'matched a host-level mutation' }
  if (hasNetworkWrite(command)) return { decision: 'human', reason: 'matched a network write or upload' }
  if (NESTED_EXECUTION_PATTERN.test(command)) return { decision: 'ai', reason: 'contains nested command execution' }
  if (isClearlyReadOnlyCommand(command)) return { decision: 'allow', reason: 'matched a read-only command' }
  if (!isInsideWorkspace(cwd, workspaceRoot)) return { decision: 'ai', reason: 'working directory is outside the workspace' }
  if (DYNAMIC_PATH_PATTERN.test(command)) return { decision: 'ai', reason: 'contains a dynamic path' }

  const outside = referencedPaths(command, cwd).filter((path) => !isInsideWorkspace(path, workspaceRoot))
  if (outside.length > 0) return { decision: 'ai', reason: 'references a path outside the workspace' }

  return { decision: 'ai', reason: 'no conclusive local command rule' }
}

export function classifyToolCall({ toolName, args, workspaceRoot, toolDescription, approvalReason }) {
  if (isMassDestructiveRequest({ toolName, toolDescription, approvalReason, args })) {
    return { decision: 'human', reason: 'matched a mass-destructive operation' }
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) return { decision: 'ai', reason: 'arguments are not an object' }
  if (toolName === 'pwsh' || toolName === 'bash') {
    return classifyCommand({ command: args.command, workdir: args.workdir || workspaceRoot, workspaceRoot })
  }
  if (toolName === 'write' || toolName === 'edit') {
    const target = typeof args.file_path === 'string' ? resolve(workspaceRoot, args.file_path) : ''
    return isInsideWorkspace(target, workspaceRoot)
      ? { decision: 'allow', reason: 'file target is inside the workspace' }
      : { decision: 'human', reason: 'file target is outside the workspace' }
  }
  return { decision: 'ai', reason: 'no local matcher for this tool' }
}
