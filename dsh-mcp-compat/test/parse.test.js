import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { activeRootKeysFor, collectServers, cwdInWorkspace, denyListFor, filterServersForWorkspaces, parseCodexToml, parseMcpJson, parseOpencodeJson, windowsCommand } from '../index.js'

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

// Codex 用 enabled = false 停用一个服务器；解析器若忽略它，会把已停用的条目
// 也挂载起来（启动即退出、刷日志）。
test('parseCodexToml 跳过 enabled = false 的服务器', () => {
  const toml = [
    '[mcp_servers.off]',
    'url = "https://off.example/mcp"',
    'enabled = false',
    '',
    '[mcp_servers.on]',
    'url = "https://on.example/mcp"',
    'enabled = true',
    '',
    '[mcp_servers.default]',
    'url = "https://default.example/mcp"',
  ].join('\n')
  assert.deepEqual(parseCodexToml(toml, 'config.toml').map((s) => s.name), ['on', 'default'])
})

test('collectServers：用户级同名服务器不被项目级条目劫持', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-mcp-scope-'))
  const home = join(root, 'home')
  const project = join(root, 'project')
  try {
    mkdirSync(home, { recursive: true })
    mkdirSync(project, { recursive: true })
    // 用户级：全局可用的服务器
    writeFileSync(join(home, '.mcp.json'), JSON.stringify({
      mcpServers: { 'yzl-dashboard': { type: 'http', url: 'http://127.0.0.1:8734/mcp' } },
    }))
    // 项目级：同名条目（常见于该服务器自己的项目里）
    writeFileSync(join(project, '.mcp.json'), JSON.stringify({
      mcpServers: {
        'yzl-dashboard': { type: 'http', url: 'http://127.0.0.1:8734/mcp' },
        'project-only': { type: 'http', url: 'http://127.0.0.1:9000/mcp' },
      },
    }))
    const servers = collectServers([project], null, home, home)
    const dashboard = servers.find((s) => s.name === 'yzl-dashboard')
    // 关键：必须是用户级条目（无 workspaceRoot），否则它的工具只在该项目里可见
    assert.equal(dashboard.workspaceRoot, undefined)
    assert.equal(dashboard.source, join(home, '.mcp.json'))
    // 项目独有的服务器仍保持项目级作用域
    const only = servers.find((s) => s.name === 'project-only')
    assert.equal(only.workspaceRoot, project)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('collectServers：项目独有服务器保持项目级作用域', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-mcp-scope2-'))
  const home = join(root, 'home')
  const project = join(root, 'project')
  try {
    mkdirSync(home, { recursive: true })
    mkdirSync(join(project, '.cursor'), { recursive: true })
    writeFileSync(join(project, '.cursor', 'mcp.json'), JSON.stringify({
      mcpServers: { jetbrains: { type: 'http', url: 'http://localhost:64342/mcp' } },
    }))
    const servers = collectServers([project], null, home, home)
    assert.equal(servers.length, 1)
    assert.equal(servers[0].name, 'jetbrains')
    assert.equal(servers[0].workspaceRoot, project)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// 项目级 MCP 工具的作用域判定：会话 cwd 属于哪个 workspace，就只能看到那个
// workspace 的项目级工具（别的 workspace 的必须被 deny，否则就是"串"）。
const A = 'D:\\work\\projA'
const B = 'D:\\work\\projB'
const TOOLS = [
  { name: 'mcp__a__t1', workspaceRoot: A },
  { name: 'mcp__a__t2', workspaceRoot: A },
  { name: 'mcp__b__t1', workspaceRoot: B },
]

test('denyListFor：只保留本工作区的项目级工具，跨工作区一律禁用', () => {
  assert.deepEqual(denyListFor(TOOLS, A).sort(), ['mcp__b__t1'])
  assert.deepEqual(denyListFor(TOOLS, B).sort(), ['mcp__a__t1', 'mcp__a__t2'])
})

test('denyListFor：会话在 workspace 子目录里时不禁自己项目的工具', () => {
  assert.deepEqual(denyListFor(TOOLS, 'D:\\work\\projA\\src\\deep'), ['mcp__b__t1'])
  // 大小写不敏感（Windows）
  assert.deepEqual(denyListFor(TOOLS, 'd:\\WORK\\proja'), ['mcp__b__t1'])
})

test('denyListFor：路径未知时保守禁用全部项目级工具', () => {
  assert.deepEqual(denyListFor(TOOLS, undefined).sort(), ['mcp__a__t1', 'mcp__a__t2', 'mcp__b__t1'])
  assert.deepEqual(denyListFor(TOOLS, '').length, 3)
})

test('denyListFor：前缀相同的兄弟目录不算同一工作区', () => {
  // projA2 不是 projA 的子目录，不能用字符串前缀误判
  assert.equal(cwdInWorkspace('D:\\work\\projA2', A), false)
  assert.equal(cwdInWorkspace('D:\\work\\projA\\sub', A), true)
  assert.equal(cwdInWorkspace(A, A), true)
  assert.equal(cwdInWorkspace('D:\\work', A), false)
})

// 回归：riderMcp 是 YunLiu 的项目级服务器，在 YZLWork 的会话里**不应该出现**。
// 服务器一旦挂载就是全局的（会出现在 MCP 服务器/资源列表里），只 deny 工具不够，
// 所以非活动工作区的项目级服务器必须在挂载阶段就被过滤掉。
const YUNLIU = 'I:\\Jx3YL\\Product\\Client\\YunLiu'
const YZLWORK = 'D:\\work\\YZLWork'
const ALL_SERVERS = [
  { name: 'riderMcp', workspaceRoot: YUNLIU },
  { name: 'unreal-mcp', workspaceRoot: YUNLIU },
  { name: 'yzl-local', workspaceRoot: YZLWORK },
  { name: 'codegraph' },
]

test('filterServersForWorkspaces：只挂用户级 + 当前活动工作区的项目级服务器', () => {
  const active = activeRootKeysFor([YUNLIU, YZLWORK], [YZLWORK])
  const names = filterServersForWorkspaces(ALL_SERVERS, active).map((s) => s.name)
  assert.deepEqual(names.sort(), ['codegraph', 'yzl-local'])
  // 关键断言：YunLiu 的 riderMcp 不允许出现在 YZLWork 的会话里
  assert.ok(!names.includes('riderMcp'))
})

test('filterServersForWorkspaces：两个工作区都有会话时两边都挂（靠 per-agent deny 兜底）', () => {
  const active = activeRootKeysFor([YUNLIU, YZLWORK], [YZLWORK, YUNLIU])
  const names = filterServersForWorkspaces(ALL_SERVERS, active).map((s) => s.name)
  assert.deepEqual(names.sort(), ['codegraph', 'riderMcp', 'unreal-mcp', 'yzl-local'])
})

test('activeRootKeysFor：cwd 落在子目录时归到所属根，未知 cwd 不引入项目服务器', () => {
  const active = activeRootKeysFor([YUNLIU, YZLWORK], [`${YZLWORK}\\src\\deep`, 'C:\\Temp\\elsewhere'])
  assert.deepEqual([...active], [YZLWORK.toLowerCase()])
  // 没有活动工作区时只挂用户级服务器
  const none = activeRootKeysFor([YUNLIU, YZLWORK], [])
  assert.deepEqual(filterServersForWorkspaces(ALL_SERVERS, none).map((s) => s.name), ['codegraph'])
})
