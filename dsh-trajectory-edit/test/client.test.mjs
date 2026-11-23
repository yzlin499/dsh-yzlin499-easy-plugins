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
    Fragment: 'fragment',
    useEffect: () => {},
    useState: (initial) => [initial, () => {}],
    useSyncExternalStore: () => ({}),
  }

  globalThis.window = {
    __ModuleLoader__: {
      load: (definition) => {
        handles.registered = definition
      },
    },
    getSelection: () => ({ toString: () => '' }),
    addEventListener: (type, handler, capture) => {
      handles.listeners.push({ type, handler, capture })
    },
    removeEventListener: () => {},
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

/**
 * Mount the plugin against a fake context.
 * @param {object} handles - captured browser handles.
 * @param {{open?: Function, register?: Function, withSlots?: boolean}} [options] - overrides.
 * @returns {Promise<{module: any, ctx: any, contributions: any[]}>} mount results.
 */
async function mount(options = {}) {
  const contributions = []
  const ctx = {
    get: (name) => {
      if (name === 'contextMenus') {
        return {
          register: (input) => {
            contributions.push(input)
            return () => {}
          },
          open: (...args) => (options.open ?? (() => handles.opened.push(args)))(...args),
        }
      }
      if (name === 'slots') {
        return options.withSlots === false ? undefined : { inject: () => () => {}, register: () => () => {} }
      }
      return undefined
    },
    effect: (fn) => { fn() },
  }
  const { module, handles } = await loadClient()
  module.apply(ctx)
  return { module, ctx, contributions, handles }
}

/**
 * Build a fake trajectory row.
 * @param {string} key - row key.
 * @param {{summary?: boolean, requestOnly?: boolean}} [flags] - row flags.
 * @returns {object} fake element.
 */
function fakeRow(key, flags = {}) {
  return {
    getAttribute: (name) => (name === 'data-trajectory-row-key' ? key : null),
    hasAttribute: (name) => (name === 'data-collapsed-summary' ? flags.summary === true
      : name === 'data-request-only' ? flags.requestOnly === true : false),
    closest: (selector) => (selector === '[data-conversation-session]'
      ? { getAttribute: () => 'session-test-0000' }
      : null),
    getBoundingClientRect: () => ({ left: 10, bottom: 40 }),
  }
}

/**
 * Build a fake contextmenu event.
 * @param {object | null} row - row to resolve, or null.
 * @param {object} [extra] - extra fields.
 * @returns {object} fake event.
 */
function contextEvent(row, extra = {}) {
  const event = {
    button: 2,
    defaultPrevented: false,
    clientX: 12,
    clientY: 34,
    target: {
      closest: (selector) => (selector === 'tr[data-trajectory-row-key]' ? row : null),
    },
    preventDefault: () => { event.defaultPrevented = true },
    stopPropagation: () => {},
    ...extra,
  }
  return event
}

test('registers the bundle under its package id', async () => {
  const { module } = await loadClient()
  assert.equal(module.name, 'dsh-trajectory-edit')
  assert.deepEqual(module.inject, ['contextMenus', 'slots', 'locale'])
})

test('contributes the record menu and installs both bridges', async () => {
  const { module, contributions, handles } = await mount()
  assert.equal(contributions.length, 1)
  assert.equal(contributions[0].target, 'trajectory-record')
  const types = handles.listeners.map(listener => listener.type).sort()
  assert.deepEqual(types, ['contextmenu', 'keydown'])
  assert.ok(handles.listeners.every(listener => listener.capture === true))
  assert.equal(module.__internals.debug.bridge, true)
  assert.equal(module.__internals.debug.phase, 'ready')
})

test('resolves edit and cleanup actions for a row', async () => {
  const { contributions } = await mount()
  const actions = await contributions[0].resolve({ kind: 'trajectory-record', value: { sessionId: 's', key: 'assistant%001%001' } })
  assert.deepEqual(actions.map(action => action.id), ['edit', 'clean'])
  assert.deepEqual(actions[1].children.map(child => child.id), ['clean-record', 'clean-session'])
})

test('opens the official menu for a trajectory row', async () => {
  const { handles } = await mount()
  const bridge = handles.listeners.find(listener => listener.type === 'contextmenu')
  const event = contextEvent(fakeRow('assistant%001%001'))
  bridge.handler(event)

  assert.equal(event.defaultPrevented, true)
  assert.equal(handles.opened.length, 1)
  assert.deepEqual(handles.opened[0][0], {
    kind: 'trajectory-record',
    value: { sessionId: 'session-test-0000', key: 'assistant%001%001' },
  })
  assert.deepEqual(handles.opened[0][1], { x: 12, y: 34 })
})

test('ignores timeline right-clicks and collapsed summaries', async () => {
  const { handles } = await mount()
  const bridge = handles.listeners.find(listener => listener.type === 'contextmenu')

  const timelineEvent = contextEvent(null, {
    target: { closest: (selector) => (selector === '[data-timeline-record-index], [data-timeline-domain]' ? {} : null) },
  })
  bridge.handler(timelineEvent)
  assert.equal(handles.opened.length, 0)

  bridge.handler(contextEvent(fakeRow('assistant%00summary%00assistant', { summary: true })))
  assert.equal(handles.opened.length, 0)
})

test('keyboard trigger opens the menu on a focused row', async () => {
  const { handles } = await mount()
  const keyboard = handles.listeners.find(listener => listener.type === 'keydown')
  const event = { key: 'F10', shiftKey: true, defaultPrevented: false, target: contextEvent(fakeRow('user%00seq%0042')).target, preventDefault: () => { event.defaultPrevented = true } }
  keyboard.handler(event)
  assert.equal(event.defaultPrevented, true)
  assert.equal(handles.opened.length, 1)
  assert.equal(handles.opened[0][0].value.key, 'user%00seq%0042')
})

test('records why a right-click was skipped', async () => {
  const { module, handles } = await mount()
  const bridge = handles.listeners.find(listener => listener.type === 'contextmenu')
  bridge.handler(contextEvent(null))
  assert.equal(module.__internals.debug.last, 'no-row')
  assert.ok(module.__internals.debug.skips.some(entry => entry.reason === 'no-row'))
})
