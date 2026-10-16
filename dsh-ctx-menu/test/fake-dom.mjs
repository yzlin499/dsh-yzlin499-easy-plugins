// 极简 DOM 替身：只用 _tags（元素满足的选择器集合）+ parentElement 实现 closest/querySelector。
// 目的是给 gate / resolveRow / resolveFile 这类纯逻辑做单测，不引入任何依赖。

export function makeEl(tags = [], options = {}) {
  const { parent = null, className = '', attrs = {}, rect, children = [], text = '' } = options
  const element = {
    className,
    children,
    parentElement: parent,
    textContent: text,
    _tags: new Set(tags),
    getAttribute: (name) => (Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null),
    getBoundingClientRect: () => rect ?? { width: 10, height: 10, left: 0, top: 0 },
    closest(selector) {
      for (const part of String(selector).split(',')) {
        const wanted = part.trim()
        let cursor = element
        while (cursor !== null && cursor !== undefined) {
          if (cursor._tags?.has(wanted) === true) return cursor
          cursor = cursor.parentElement
        }
      }
      return null
    },
    querySelectorAll(selector) {
      const found = []
      const visit = (current) => {
        if (current._tags?.has(selector) === true) found.push(current)
        for (const child of current.children ?? []) visit(child)
      }
      for (const child of element.children ?? []) visit(child)
      return found
    },
    querySelector(selector) {
      const found = element.querySelectorAll(selector)
      return found.length === 0 ? null : found[0]
    },
    get firstElementChild() {
      return (element.children ?? [])[0] ?? null
    },
  }
  return element
}

export function makeWindow({ selection = '', style = { display: 'inline-flex', visibility: 'visible' } } = {}) {
  return {
    getSelection: () => ({ toString: () => selection }),
    getComputedStyle: () => style,
  }
}

export function makeDocument(documentOverride = {}) {
  return {
    getElementById: () => null,
    createElement: () => ({ style: {}, dataset: {}, remove() {}, click() {}, appendChild() {} }),
    addEventListener() {},
    removeEventListener() {},
    head: { appendChild() {} },
    body: { appendChild() {} },
    ...documentOverride,
  }
}

export function makeEvent(target, overrides = {}) {
  return {
    button: 2,
    defaultPrevented: false,
    target,
    clientX: 100,
    clientY: 200,
    preventDefault() {
      this.defaultPrevented = true
    },
    stopPropagation() {},
    ...overrides,
  }
}