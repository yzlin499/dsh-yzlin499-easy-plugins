import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { parseCodexToml, parseMcpJson, parseOpencodeJson, windowsCommand } from '../index.js'

// Codex 的 HTTP MCP 头写在服务器子表 [mcp_servers.<name>.http_headers] 里。
// 历史 bug：解析器把这个子表当成新服务器段，Authorization 被丢弃，
// 导致远端 MCP 一直 401「配置写了却不生效」。
test('parseCodexToml 读取 http_headers 子表', () => {
  const toml = [
    '[mcp_servers.aireview-mcp]',
    'type = "http"',
    'url = "https://mcp-aireview.testplus.cn/v1/mcp"',
    '',
    '[mcp_servers.aireview-mcp.http_headers]',
    'Authorization = "Bearer token-123"',
    '',
    '[desktop]',
    'appearanceTheme = "dark"',
  ].join('\n')
  const servers = parseCodexToml(toml, 'config.toml')
  assert.equal(servers.length, 1)
  assert.equal(servers[0].name, 'aireview-mcp')
  assert.equal(servers[0].transport, 'streamable-http')
  assert.equal(servers[0].url, 'https://mcp-aireview.testplus.cn/v1/mcp')
  assert.deepEqual(servers[0].headers, { Authorization: 'Bearer token-123' })
})

test('parseCodexToml 兼容 headers 子表与 bearer_token', () => {
  const toml = [
    '[mcp_servers.a]',
    'url = "https://a.example/mcp"',
    '[mcp_servers.a.headers]',
    'X-Api-Key = "k"',
    '[mcp_servers.b]',
    'url = "https://b.example/mcp"',
    'bearer_token = "bt"',
  ].join('\n')
  const servers = parseCodexToml(toml, 'config.toml')
  assert.deepEqual(servers.find((s) => s.name === 'a').headers, { 'X-Api-Key': 'k' })
  assert.deepEqual(servers.find((s) => s.name === 'b').headers, { Authorization: 'Bearer bt' })
})

test('parseCodexToml 显式 Authorization 不被 bearer_token 覆盖', () => {
  const toml = [
    '[mcp_servers.a]',
    'url = "https://a.example/mcp"',
    'bearer_token = "ignored"',
    '[mcp_servers.a.http_headers]',
    'Authorization = "Bearer explicit"',
  ].join('\n')
  const [server] = parseCodexToml(toml, 'config.toml')
  assert.deepEqual(server.headers, { Authorization: 'Bearer explicit' })
})

test('parseCodexToml 保留 env 子表且忽略 tools 子表', () => {
  const toml = [
    '[mcp_servers.stdio]',
    'command = "cmd"',
    'args = ["/c", "run"]',
    '[mcp_servers.stdio.env]',
    'TOKEN = "v"',
    '[mcp_servers.stdio.tools.read_file]',
    'approval_mode = "approve"',
    '[mcp_servers.after]',
    'url = "https://after.example/mcp"',
  ].join('\n')
  const servers = parseCodexToml(toml, 'config.toml')
  assert.deepEqual(servers.map((s) => s.name), ['stdio', 'after'])
  assert.deepEqual(servers[0].env, { TOKEN: 'v' })
  assert.equal(servers[0].command, 'cmd')
  assert.deepEqual(servers[0].args, ['/c', 'run'])
  assert.equal(servers[0].headers, undefined)
})

test('parseMcpJson 支持 type:"http" + headers', () => {
  const json = JSON.stringify({
    mcpServers: {
      'aireview-mcp': {
        type: 'http',
        url: 'https://mcp-aireview.testplus.cn/v1/mcp',
        headers: { Authorization: 'Bearer mcp_x' },
      },
    },
  })
  const servers = parseMcpJson(json, '.mcp.json')
  assert.equal(servers.length, 1)
  assert.equal(servers[0].transport, 'streamable-http')
  assert.deepEqual(servers[0].headers, { Authorization: 'Bearer mcp_x' })
})

test('parseOpencodeJson 透传 remote 服务器的 headers', () => {
  const json = JSON.stringify({
    mcp: {
      remote: { type: 'remote', url: 'https://r.example/mcp', headers: { Authorization: 'Bearer t' } },
      local: { type: 'local', command: ['node', 's.js'], environment: { A: '1' } },
    },
  })
  const servers = parseOpencodeJson(json, 'opencode.json')
  assert.deepEqual(servers.find((s) => s.name === 'remote').headers, { Authorization: 'Bearer t' })
  assert.equal(servers.find((s) => s.name === 'local').headers, undefined)
  assert.deepEqual(servers.find((s) => s.name === 'local').env, { A: '1' })
})

// Node 的 spawn(shell:false) 在 Windows 上跑不动 npm 生成的 .cmd shim：
// 裸名字 ENOENT、.cmd 直接 spawn EINVAL。windowsCommand 负责在挂载前把这种情况
// 换成 cmd /c，并把 .exe（可正常执行）排除在外。
const WIN_ENV = { PATHEXT: '.COM;.EXE;.BAT;.CMD' }

function withFixtureDir(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mcp-cmd-'))
  try {
    for (const name of files) writeFileSync(join(dir, name), '')
    return fn({ ...WIN_ENV, PATH: dir }, dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('windowsCommand：裸命令只解析到 .cmd 时用 cmd /c 包一层', () => {
  withFixtureDir(['codegraph', 'codegraph.cmd', 'codegraph.ps1'], (env) => {
    assert.deepEqual(
      windowsCommand('codegraph', ['serve', '--mcp'], 'win32', env),
      { command: 'cmd', args: ['/c', 'codegraph', 'serve', '--mcp'] },
    )
  })
})

test('windowsCommand：有 .exe 时保持原样（优先于 .cmd）', () => {
  withFixtureDir(['tool.exe', 'tool.cmd'], (env) => {
    assert.deepEqual(
      windowsCommand('tool', ['x'], 'win32', env),
      { command: 'tool', args: ['x'] },
    )
  })
})

test('windowsCommand：显式路径与 .cmd 路径的处理', () => {
  withFixtureDir(['x.cmd'], (env, dir) => {
    assert.deepEqual(
      windowsCommand('C:\\abs\\srv.exe', [], 'win32', env),
      { command: 'C:\\abs\\srv.exe', args: [] },
    )
    // 显式 .cmd 路径同样必须包（否则 Node 抛 EINVAL）
    assert.deepEqual(
      windowsCommand(`${dir}\\x.cmd`, ['a'], 'win32', env),
      { command: 'cmd', args: ['/c', `${dir}\\x.cmd`, 'a'] },
    )
  })
})

test('windowsCommand：找不到的命令与非 Windows 平台都不改动', () => {
  withFixtureDir([], (env) => {
    assert.deepEqual(windowsCommand('nope-xyz', ['a'], 'win32', env), { command: 'nope-xyz', args: ['a'] })
    assert.deepEqual(windowsCommand('codegraph', ['a'], 'linux', env), { command: 'codegraph', args: ['a'] })
    // args 缺省时不应崩
    assert.deepEqual(windowsCommand('nope-xyz', undefined, 'win32', env), { command: 'nope-xyz', args: [] })
  })
})
