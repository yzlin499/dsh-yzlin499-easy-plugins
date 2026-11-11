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
  const styleTags = []
  const fakeDocument = {
    addEventListener: () => {},
    removeEventListener: () => {},
    querySelector: () => null,
    createElement: () => ({ dataset: {}, style: {}, textContent: '' }),
    head: { appendChild: (tag) => styleTags.push(tag) },
    body: {},
  }
  const fakeWindow = {
    __ModuleLoader__: { load: (value) => { registration = value } },
    document: fakeDocument,
    innerWidth: 1200,
    innerHeight: 800,
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  globalThis.document = fakeDocument
  globalThis.window = fakeWindow
  // eslint-disable-next-line no-new-func
  new Function('window', source)(fakeWindow)
  if (registration === null) throw new Error('client.js 没有向 __ModuleLoader__ 注册')

  const reactStub = {
    Fragment: Symbol('Fragment'),
    createElement: () => null,
    memo: (component) => component,
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useLayoutEffect: () => {},
    useMemo: (factory) => factory(),
    useRef: (initial) => ({ current: initial === undefined ? null : initial }),
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  }
  const reactDomStub = { createPortal: (element) => element }
  const exports = registration.factory((specifier) => {
    if (specifier === 'react') return reactStub
    if (specifier === 'react-dom') return reactDomStub
    return {}
  })
  return { registration, exports, internals: exports.__internals, window: fakeWindow, document: fakeDocument, styleTags }
}

/** 假表单：模拟 ConfigFormController 的 getSnapshot / subscribe（只读用途）。 */
export function createFakeForm(value) {
  let snapshot = { status: value === undefined ? 'unavailable' : 'ready', value, writable: true, revision: 1 }
  const listeners = new Set()
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    /** 模拟外部（Host）改动推下来 */
    push(nextValue) {
      snapshot = { ...snapshot, status: 'ready', value: nextValue, revision: snapshot.revision + 1 }
      for (const listener of [...listeners]) listener()
    },
  }
}

/** 假 configForms 服务：按命名空间给一份表单。 */
export function createFakeForms(initial = {}) {
  const forms = new Map()
  return {
    forms,
    get(namespace) {
      if (!forms.has(namespace)) forms.set(namespace, createFakeForm(initial[namespace]))
      return forms.get(namespace)
    },
  }
}

/** 假 ctx：记录 effect / 插槽注册 / cordis 服务注入；服务用字典提供。 */
export function makeCtx(services = {}) {
  const slotRegistrations = []
  const effects = []
  const injected = []
  const ctx = {
    slotRegistrations,
    effects,
    injected,
    locale: {
      getLocale: () => ({ active: 'zh' }),
      subscribe: () => () => {},
    },
    get(name) {
      if (name === 'locale') return ctx.locale
      return services[name]
    },
    effect(run, label) {
      effects.push({ run, label })
      const disposer = run()
      return () => {
        if (typeof disposer === 'function') disposer()
      }
    },
    inject(deps, callback) {
      injected.push(deps)
      if (deps.every((dep) => services[dep] !== undefined)) {
        ctx.configForms = services.configForms
        callback(ctx)
      }
      return () => {}
    },
    slots: {
      inject(_key, callback) {
        callback()
        return () => {}
      },
      register(spec, component) {
        slotRegistrations.push({ spec, component })
        return () => {}
      },
    },
  }
  return ctx
}

/** 取某个插槽的注册（按 id 匹配）。 */
export function registrationFor(ctx, id) {
  return ctx.slotRegistrations.find((entry) => entry.spec.id === id)
}

/** 复刻渲染器的 bindInjectSources：hooks → use<Name>(selector)，其余键原样当 prop。 */
export function bindInject(face) {
  const { hooks, keyedHooks, ...rest } = face
  const props = { ...rest }
  for (const [name, source] of Object.entries(hooks ?? {})) {
    props[`use${name[0].toUpperCase()}${name.slice(1)}`] = (selector) => (typeof selector === 'function' ? selector(source.getSnapshot()) : source.getSnapshot())
  }
  return props
}

/** 内存版 localStorage（测试采样历史恢复）。 */
export function installLocalStorage() {
  const data = new Map()
  const storage = {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)) },
    removeItem: (key) => { data.delete(key) },
    clear: () => data.clear(),
  }
  globalThis.localStorage = storage
  return storage
}
