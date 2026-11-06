// 在 Node 里加载 client.js：劫持 window.__ModuleLoader__ 拿到注册对象，
// 再用桩 require 调用 factory，取出实现与 internals。不需要浏览器、不需要 React 真身。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const clientPath = path.resolve(here, '..', 'client.js')

export function loadClient() {
  const source = fs.readFileSync(clientPath, 'utf8')
  let registration = null
  const fakeWindow = {
    __ModuleLoader__: { load: (value) => { registration = value } },
  }
  // eslint-disable-next-line no-new-func
  new Function('window', source)(fakeWindow)
  if (registration === null) throw new Error('client.js 没有向 __ModuleLoader__ 注册')

  const reactStub = { createElement: () => null, useState: () => [0, () => {}], useEffect: () => {} }
  const exports = registration.factory((specifier) => (specifier === 'react' ? reactStub : {}))
  return { registration, exports, internals: exports.__internals }
}

/** 假 ctx：记录 effect 与注册的菜单贡献，服务用字典提供。 */
export function makeCtx(services = {}) {
  const providers = []
  const effects = []
  const notices = []
  const ctx = {
    providers,
    effects,
    notices,
    get(name) {
      if (name === 'contextMenus') {
        return {
          register(input) {
            providers.push(input)
            return () => {}
          },
          notify: (text, ok) => notices.push({ text, ok }),
        }
      }
      return services[name]
    },
    effect(run) {
      effects.push(run)
      const disposer = run()
      return () => {
        if (typeof disposer === 'function') disposer()
      }
    },
  }
  return ctx
}

/** 剪贴板桩：返回写过的文本（Node 24 的 navigator 是只读 getter，只能 defineProperty 覆盖）。 */
export function stubClipboard() {
  const written = []
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText: async (text) => { written.push(text) } } },
    configurable: true,
    writable: true,
  })
  return written
}
