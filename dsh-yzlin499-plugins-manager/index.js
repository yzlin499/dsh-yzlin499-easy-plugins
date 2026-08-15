// ═══════════════════════════════════════════════════════════════════════════
// dsh-yzlin499-plugins-manager — Host 半侧（ESM 模块，由 cordis loader 挂载）
//
// 插件管理器：扫描本插件所在的集合文件夹（父目录）下所有含 cordis.patch.yml
// 的文件夹 → 这些就是"本集合"的插件；面板列出它们并显示已安装状态，
// 开关通过 `dsh plugin --profile <p> add|remove` 子进程执行。
//
// 边界（有意为之）：
//   · 只管理扫描到的本集合插件，绝不触碰 profile 里其它位置的插件
//   · 管理器自身不可被关闭（防止把自己锁死）
//   · profile 名默认 web、面板可改（内存态）；白名单字符校验防路径注入
//   · 开关操作会对目录做白名单校验，只允许扫描结果内的目录
//
// 路由：
//   GET  /plugins-manager/list    -> { root, profile, plugins: [{dir,name,description,installed,isSelf}] }
//   POST /plugins-manager/profile -> { profile } 更新内存态
//   POST /plugins-manager/toggle  -> { dir, enable } 执行 dsh add/remove
// ═══════════════════════════════════════════════════════════════════════════
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

export const name = 'plugins-manager'
export const inject = ['subprocess', 'webServer']

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(HERE) // 集合根目录 = 管理器的父文件夹
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const PROFILE_RE = /^[A-Za-z0-9_-]+$/
const SELF_DIR = 'dsh-yzlin499-plugins-manager'

const log = (...a) => console.log('[plugins-manager]', ...a)

// 内存态：目标 profile（默认 web，面板可改）
let profile = 'web'
let dshBin = null

export function apply(ctx) {
  /** 扫描集合根目录：子文件夹含 cordis.patch.yml 即视为插件 */
  function scanPlugins() {
    const out = []
    let dirs = []
    try {
      dirs = readdirSync(ROOT, { withFileTypes: true })
    } catch (e) {
      log('扫描失败:', String((e && e.message) || e))
      return out
    }
    for (const d of dirs) {
      if (!d.isDirectory()) continue
      const dir = d.name
      if (!existsSync(join(ROOT, dir, 'cordis.patch.yml'))) continue
      let pkg = { name: dir, description: '' }
      try {
        const pj = join(ROOT, dir, 'package.json')
        if (existsSync(pj)) pkg = { ...pkg, ...JSON.parse(readFileSync(pj, 'utf8')) }
      } catch {}
      out.push({
        dir,
        name: pkg.name || dir,
        description: pkg.description || '',
        isSelf: dir === SELF_DIR,
      })
    }
    out.sort((a, b) => a.dir.localeCompare(b.dir))
    return out
  }

  /** 已安装集合：读 profile package.json 的 dependencies 键 */
  function readInstalled() {
    try {
      const pj = join(DSH_HOME, 'profiles', profile, 'package.json')
      if (!existsSync(pj)) return new Set()
      const pkg = JSON.parse(readFileSync(pj, 'utf8'))
      return new Set(Object.keys(pkg.dependencies || {}))
    } catch (e) {
      log('读取已安装列表失败:', String((e && e.message) || e))
      return new Set()
    }
  }

  /** 解析 dsh 可执行文件（PATH 优先，.cmd 兜底，跳过 .ps1），缓存 */
  async function resolveDsh() {
    if (dshBin) return dshBin
    for (const cand of ['dsh', 'dsh.cmd']) {
      try {
        const p = await ctx.subprocess.resolveExecutable(cand)
        if (p && !p.endsWith('.ps1')) {
          dshBin = p
          return p
        }
      } catch {}
    }
    dshBin = 'dsh'
    return dshBin
  }

  /** 跑一条 dsh 命令，返回 exitCode + 合并输出 */
  async function runDsh(args) {
    const bin = await resolveDsh()
    const handle = ctx.subprocess.spawn({
      argv: [bin, ...args],
      cwd: ROOT,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 64 * 1024 },
        stderr: { maxBytes: 64 * 1024 },
      },
      graceMs: 60000,
    })
    const outcome = await handle.done
    let out = ''
    let err = ''
    try {
      if (handle.collected && handle.collected.stdout) out = handle.collected.stdout.readFrom(0).text
    } catch {}
    try {
      if (handle.collected && handle.collected.stderr) err = handle.collected.stderr.readFrom(0).text
    } catch {}
    return { exitCode: outcome.exitCode, output: (out + '\n' + err).trim() }
  }

  const sendJson = (res, obj, status = 200) => {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(JSON.stringify(obj))
  }
  const readBody = (req) => new Promise((resolve) => {
    let data = ''
    req.on('data', (c) => { data += c })
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}) } catch { resolve({}) }
    })
    req.on('error', () => resolve({}))
  })

  // ── 注册 /plugins-manager/* 路由（随插件卸载自动清理）──
  ctx.webServer.register({
    kind: 'prefix',
    path: '/plugins-manager',
    handler: async (req, res) => {
      try {
        const url = new URL(req.url, 'http://localhost')
        const p = url.pathname
        if (p === '/plugins-manager/list' && req.method === 'GET') {
          const installed = readInstalled()
          const plugins = scanPlugins().map((pl) => ({ ...pl, installed: installed.has(pl.name) }))
          sendJson(res, { root: ROOT, profile, plugins })
          return
        }
        if (p === '/plugins-manager/profile' && req.method === 'POST') {
          const a = await readBody(req)
          const next = String(a.profile || '').trim()
          if (!PROFILE_RE.test(next)) {
            sendJson(res, { ok: false, error: 'profile 名只能包含字母/数字/_/-' }, 400)
            return
          }
          profile = next
          log('目标 profile ->', profile)
          sendJson(res, { ok: true, profile })
          return
        }
        if (p === '/plugins-manager/toggle' && req.method === 'POST') {
          const a = await readBody(req)
          const dir = String(a.dir || '')
          const enable = !!a.enable
          const match = scanPlugins().find((pl) => pl.dir === dir)
          if (!match) {
            sendJson(res, { ok: false, error: '未知插件目录: ' + dir }, 400)
            return
          }
          if (match.isSelf) {
            sendJson(res, { ok: false, error: '管理器自身不可被关闭' }, 400)
            return
          }
          // 只允许操作扫描结果内的目录，防止任意路径注入
          const args = [
            'plugin', '--profile', profile,
            enable ? 'add' : 'remove',
            enable ? join(ROOT, dir) : match.name,
          ]
          log('执行:', args.join(' '))
          const r = await runDsh(args)
          if (r.exitCode === 0) {
            sendJson(res, { ok: true, exitCode: r.exitCode, output: r.output, restart: true })
          } else {
            log('dsh 失败:', r.output)
            sendJson(res, { ok: false, exitCode: r.exitCode, error: r.output || 'dsh 命令失败' }, 500)
          }
          return
        }
        sendJson(res, { ok: false, error: 'not-found' }, 404)
      } catch (e) {
        console.error('[plugins-manager] route threw:', e)
        sendJson(res, { ok: false, error: String((e && e.message) || e) }, 500)
      }
    },
  })
}
