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
  const listeners = []
  const fakeDocument = {
    addEventListener: (type, handler, capture) => listeners.push({ type, handler, capture }),
    removeEventListener: () => {},
    getElementById: () => null,
  }
  const fakeWindow = {
    __ModuleLoader__: { load: (value) => { registration = value } },
    document: fakeDocument,
    getSelection: () => ({ toString: () => '' }),
  }
  globalThis.document = fakeDocument
  // eslint-disable-next-line no-new-func
  new Function('window', source)(fakeWindow)
  if (registration === null) throw new Error('client.js 没有向 __ModuleLoader__ 注册')

  const reactStub = {
    createElement: () => null,
    useState: () => [0, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn,
  }
  const exports = registration.factory((specifier) => (specifier === 'react' ? reactStub : {}))
  return { registration, exports, internals: exports.__internals, window: fakeWindow, document: fakeDocument, listeners }
}

/** 假 ctx：记录 effect、菜单贡献与插槽注册，服务用字典提供。 */
export function makeCtx(services = {}) {
  const providers = []
  const effects = []
  const notices = []
  const slotRegistrations = []
  const ctx = {
    providers,
    effects,
    notices,
    slotRegistrations,
    get(name) {
      if (name === 'contextMenus') {
        return {
          opened: ctx.opened,
          register(input) {
            providers.push(input)
            return () => {}
          },
          open: (target, point) => ctx.opened.push({ target, point }),
          notify: (text, ok) => notices.push({ text, ok }),
        }
      }
      if (name === 'slots') {
        return {
          inject: (key, callback) => {
            callback()
            return () => {}
          },
          register: (spec, component) => {
            slotRegistrations.push({ spec, component })
            return () => {}
          },
        }
      }
      return services[name]
    },
    opened: [],
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

/** 极简假元素：只需 closest / getAttribute / querySelector。 */
export function fakeElement({ attrs = {}, closest = {}, query = {} } = {}) {
  return {
    attrs,
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null
    },
    closest(selector) {
      return Object.prototype.hasOwnProperty.call(closest, selector) ? closest[selector] : null
    },
    querySelector(selector) {
      return Object.prototype.hasOwnProperty.call(query, selector) ? query[selector] : null
    },
  }
}
