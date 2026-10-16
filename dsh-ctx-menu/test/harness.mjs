// 在 Node 里加载 client.js：劫持 window.__ModuleLoader__ 拿到注册对象，
// 再用桩 require 调用 factory，取出纯逻辑（__internals）。不需要浏览器、不需要 React。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const clientPath = path.resolve(here, '..', 'client.js')

export function loadClient({ document: documentOverride } = {}) {
  const source = fs.readFileSync(clientPath, 'utf8')
  let registration = null
  const fakeWindow = {
    __ModuleLoader__: { load: (value) => { registration = value } },
    getSelection: () => ({ toString: () => '' }),
    getComputedStyle: () => ({ display: 'inline-flex', visibility: 'visible' }),
  }
  const fakeDocument = {
    getElementById: () => null,
    createElement: () => ({ style: {}, dataset: {}, remove() {}, click() {}, appendChild() {} }),
    addEventListener() {},
    removeEventListener() {},
    head: { appendChild() {} },
    body: { appendChild() {} },
    ...documentOverride,
  }
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', source)(fakeWindow, fakeDocument)
  if (registration === null) throw new Error('client.js 没有向 __ModuleLoader__ 注册')

  const reactStub = {
    createElement: (...args) => ({ __element: args }),
    Fragment: Symbol('Fragment'),
    useState: () => [0, () => {}],
    useEffect: () => {},
    Component: class Component { constructor(props) { this.props = props; this.state = {} } },
  }
  const reactDomStub = { createRoot: () => ({ render() {}, unmount() {} }) }
  // 可变的 primitives 桩：测试可以往里塞 writeClipboard 等官方导出，验证真实调用路径
  const primitivesStub = {}
  const requireStub = (specifier) => {
    if (specifier === 'react') return reactStub
    if (specifier === 'react-dom/client') return reactDomStub
    if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return primitivesStub
    return {}
  }

  const exports = registration.factory(requireStub)
  return { registration, exports, internals: exports.__internals, window: fakeWindow, document: fakeDocument, primitives: primitivesStub }
}