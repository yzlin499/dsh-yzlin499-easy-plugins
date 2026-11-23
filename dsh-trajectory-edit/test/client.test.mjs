/**
 * Client-half registration and right-click bridge tests.
 *
 * The client bundle runs inside the DSH web shell, so this suite installs the
 * two globals it touches (`window.__ModuleLoader__`, `document`) as fakes and
 * drives the exported `apply` directly.
 *
 * @module dsh-trajectory-edit/test/client
 */

import assert from 'node:assert/strict'
import test from 'node:test'

/**
 * Load the client bundle with fake browser globals.
 * @returns {Promise<{module: any, handles: any}>} the registered module and captured handles.
 */
async function loadClient() {
  const handles = { registered: null, listeners: [], opened: [], slots: [] }

  const fakeReact = {
    createElement: (...args) => ({ type: 'element', args }),
    useEffect: () => {},
    useSyncExternalStore: () => ({}),
  }

  globalThis.window = {
    __ModuleLoader__: {
      load: (definition) => {
        handles.registered = definition
      },
    },
    getSelection: () => ({ toString: () => '' }),
  }
  globalThis.document = {
    addEventListener: (type, handler, capture) => {
      handles.listeners.push({ type, handler, capture })
    },
    removeEventListener: () => {},
    querySelector: (selector) => (selector === '[data-conversation-session]'
      ? { getAttribute: () => 'session-test-0000' }
      : null),
  }

  await import(`../client.js?test=${loadClient.calls = (loadClient.calls ?? 0) + 1}`)
  const definition = handles.registered
  const module = definition.factory((name) => {
    if (name === 'react') return fakeReact
    throw new Error(`unexpected require(${name})`)
  })
  return { module, handles }
}

test('registers the bundle under its package id', async () => {
  const { module } = await loadClient()
  assert.equal(module.name, 'dsh-trajectory-edit')
  assert.deepEqual(module.inject, ['contextMenus', 'slots', 'locale'])
})

test('contributes the record menu and installs the bridge', async () => {
  const { module, handles } = await loadClient()
  const contributions = []
  const disposers = []
  const ctx = {
    get: (name) => {
      if (name === 'contextMenus') return { register: (options) => { contributions.push(options); return () => {} }, open: (...args) => handles.opened.push(args) }
      if (name === 'slots') return { inject: () => () => {}, register: () => () => {} }
      if (name === 'locale') return undefined
      return undefined
    },
    effect: (fn, _label) => {
      const disposer = fn()
      disposers.push(disposer)
    },
  }
  module.apply(ctx)

  assert.equal(contributions.length, 1)
  assert.equal(contributions[0].target, 'trajectory-record')
  assert.equal(handles.listeners.length, 1)
  assert.equal(handles.listeners[0].type, 'contextmenu')
  assert.equal(handles.listeners[0].capture, true)
  assert.equal(typeof disposers[0], 'function')
})

test('resolves edit and cleanup actions for a row', async () => {
  const { module } = await loadClient()
  let contribution
  const ctx = {
    get: (name) => (name === 'contextMenus'
      ? { register: (options) => { contribution = options; return () => {} }, open: () => {} }
      : name === 'slots' ? { inject: () => () => {}, register: () => () => {} } : undefined),
    effect: (fn) => { fn() },
  }
  module.apply(ctx)
  const actions = await contribution.resolve({ kind: 'trajectory-record', value: { sessionId: 's', key: 'assistant%001%001' } })
  assert.deepEqual(actions.map(action => action.id), ['edit', 'clean'])
  assert.deepEqual(actions[1].children.map(child => child.id), ['clean-record', 'clean-session'])
  assert.equal(typeof actions[0].run, 'function')
})

test('opens the official menu for a trajectory row', async () => {
  const { module, handles } = await loadClient()
  let contribution
  const ctx = {
    get: (name) => (name === 'contextMenus'
      ? { register: (options) => { contribution = options; return () => {} }, open: (...args) => handles.opened.push(args) }
      : name === 'slots' ? { inject: () => () => {}, register: () => () => {} } : undefined),
    effect: (fn) => { fn() },
  }
  module.apply(ctx)
  void contribution

  const row = {
    getAttribute: (name) => (name === 'data-trajectory-row-key' ? 'assistant%001%001' : null),
    hasAttribute: () => false,
  }
  const target = {
    closest: (selector) => (selector === 'tr[data-trajectory-row-key]'
      ? row
      : selector === '[data-timeline-record-index], [data-timeline-domain]' ? null : null),
  }
  const event = {
    button: 2,
    defaultPrevented: false,
    target,
    clientX: 12,
    clientY: 34,
    preventDefault: () => { event.defaultPrevented = true },
  }
  handles.listeners[0].handler(event)

  assert.equal(event.defaultPrevented, true)
  assert.equal(handles.opened.length, 1)
  assert.deepEqual(handles.opened[0][0], {
    kind: 'trajectory-record',
    value: { sessionId: 'session-test-0000', key: 'assistant%001%001' },
  })
  assert.deepEqual(handles.opened[0][1], { x: 12, y: 34 })
})

test('ignores timeline right-clicks and collapsed summaries', async () => {
  const { module, handles } = await loadClient()
  const ctx = {
    get: (name) => (name === 'contextMenus'
      ? { register: () => () => {}, open: (...args) => handles.opened.push(args) }
      : name === 'slots' ? { inject: () => () => {}, register: () => () => {} } : undefined),
    effect: (fn) => { fn() },
  }
  module.apply(ctx)

  const timelineEvent = {
    button: 2,
    defaultPrevented: false,
    target: { closest: (selector) => (selector === '[data-timeline-record-index], [data-timeline-domain]' ? {} : null) },
    clientX: 0,
    clientY: 0,
    preventDefault: () => {},
  }
  handles.listeners[0].handler(timelineEvent)
  assert.equal(handles.opened.length, 0)

  const summaryRow = { getAttribute: () => 'assistant%00summary%00assistant', hasAttribute: () => true }
  const summaryEvent = {
    button: 2,
    defaultPrevented: false,
    target: {
      closest: (selector) => (selector === 'tr[data-trajectory-row-key]' ? summaryRow : null),
    },
    clientX: 0,
    clientY: 0,
    preventDefault: () => {},
  }
  handles.listeners[0].handler(summaryEvent)
  assert.equal(handles.opened.length, 0)
})
