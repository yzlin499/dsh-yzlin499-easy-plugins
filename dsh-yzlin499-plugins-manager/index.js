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

  /** 已启用集合：读 profile package.json 的 dsh.profile.bundles（真正的挂载清单） */
  function readEnabled() {
    try {
      const pj = join(DSH_HOME, 'profiles', profile, 'package.json')
      if (!existsSync(pj)) return new Set()
      const pkg = JSON.parse(readFileSync(pj, 'utf8'))
      const bundles = (pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles) || []
      return new Set(bundles)
    } catch (e) {
      log('读取启用列表失败:', String((e && e.message) || e))
      return new Set()
    }
  }

  /**
   * 解析 dsh CLI：.cmd/.ps1 shim 不能被子进程管道无 shell 直接拉起（Windows
   * spawn EINVAL），所以解析 node + dsh 包的真实入口 bin.js。缓存。
   * 返回 { node, script } 或 { bin } 或 null。
   */
  async function resolveDsh() {
    if (dshBin) return dshBin
    try {
      const node = await ctx.subprocess.resolveExecutable('node')
      const shim = await ctx.subprocess.resolveExecutable('dsh').catch(() => null)
      if (node && shim) {
        const binDir = dirname(shim)
        const candidates = [
          join(binDir, '..', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
          join(binDir, '..', 'dsh', 'lib', 'bin.js'),
        ]
        for (const script of candidates) {
          if (existsSync(script)) {
            dshBin = { node, script }
            return dshBin
          }
        }
      }
    } catch {}
    // 兜底：直接当可执行文件试（非 Windows 或已是 .exe）
    try {
      const p = await ctx.subprocess.resolveExecutable('dsh')
      if (p && !/\.(ps1|cmd|bat)$/i.test(p)) {
        dshBin = { bin: p }
        return dshBin
      }
    } catch {}
    dshBin = null
    return dshBin
  }

  /** 跑一条 dsh 命令，返回 exitCode + 合并输出 */
  async function runDsh(args) {
    const dsh = await resolveDsh()
    if (!dsh) return { exitCode: 1, output: '无法解析 dsh CLI（node 或 dsh bin.js 未找到）' }
    const argv = dsh.script ? [dsh.node, dsh.script, ...args] : [dsh.bin, ...args]
    const handle = ctx.subprocess.spawn({
      argv,
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

  /**
   * 启用：dsh add；若该包已是依赖但链接失效（reconcile 判定非 bundle）导致
   * 没进挂载清单，先 remove 再 add，用新仓库路径干净重装。
   */
  async function ensureEnabled(dir, name) {
    const addArgs = ['plugin', '--profile', profile, 'add', join(ROOT, dir)]
    let r = await runDsh(addArgs)
    if (r.exitCode !== 0) return r
    if (!readEnabled().has(name)) {
      log('add 后未进挂载清单（疑似旧链接失效），remove 后重装:', name)
      const rm = await runDsh(['plugin', '--profile', profile, 'remove', name])
      if (rm.exitCode !== 0) return rm
      r = await runDsh(addArgs)
    }
    return r
  }

  /** 停用：dsh remove，并校验已从挂载清单移除 */
  async function ensureDisabled(name) {
    const rm = await runDsh(['plugin', '--profile', profile, 'remove', name])
    if (rm.exitCode !== 0) return rm
    if (readEnabled().has(name)) {
      log('remove 后仍在挂载清单:', name)
      return { exitCode: 1, output: 'remove 后仍存在于挂载清单' }
    }
    return rm
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
          const enabled = readEnabled()
          const plugins = scanPlugins().map((pl) => ({
            dir: pl.dir, name: pl.name, enabled: enabled.has(pl.name), isSelf: pl.isSelf,
          }))
          sendJson(res, { root: ROOT, profile, plugins })
          return
        }
        if (p === '/plugins-manager/readme' && req.method === 'GET') {
          const dir = String(url.searchParams.get('dir') || '')
          const lang = String(url.searchParams.get('lang') || 'zh') === 'en' ? 'en' : 'zh'
          const match = scanPlugins().find((pl) => pl.dir === dir)
          if (!match) {
            sendJson(res, { ok: false, error: '未知插件目录: ' + dir }, 400)
            return
          }
          // 规范：中文默认读 README.md；英文界面优先 README_EN.md（缺失回退 README.md）；
          // 两者都没有才回退 package.json 的 description
          const base = join(ROOT, dir)
          const order = lang === 'en' ? ['README_EN.md', 'README.md'] : ['README.md', 'README_EN.md']
          let text = null
          let source = null
          for (const f of order) {
            const fp = join(base, f)
            if (existsSync(fp)) {
              try {
                text = readFileSync(fp, 'utf8')
                source = f
              } catch {}
              if (text !== null) break
            }
          }
          if (text === null) {
            text = match.description || '(该插件没有 README 或描述)'
            source = 'package.json'
          }
          sendJson(res, { ok: true, dir, lang, source, text })
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
          log('执行:', enable ? '启用' : '停用', match.name)
          const r = enable
            ? await ensureEnabled(match.dir, match.name)
            : await ensureDisabled(match.name)
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
