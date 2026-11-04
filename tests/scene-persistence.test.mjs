import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const compiled = await build({
  entryPoints: [fileURLToPath(new URL('../src/hooks/useScenePersistence.jsx', import.meta.url))],
  bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react'],
})

function memoryStorage() {
  const data = new Map()
  return {
    data,
    full: false,
    getItem: key => data.has(key) ? data.get(key) : null,
    setItem(key, value) { if (this.full) throw new Error('QuotaExceededError'); data.set(key, String(value)) },
    removeItem: key => data.delete(key),
  }
}

// A tiny hook runner: state, refs, callbacks and effects, with timers run by hand.
function harness(props) {
  const slots = [], effects = [], timers = new Map()
  let index = 0, dirty = true, result, timerId = 0
  const same = (a, b) => !!a && a.length === b.length && a.every((item, i) => Object.is(item, b[i]))
  const react = {
    useState(initial) {
      const i = index++
      slots[i] ??= { value: typeof initial === 'function' ? initial() : initial }
      return [slots[i].value, next => {
        const value = typeof next === 'function' ? next(slots[i].value) : next
        if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true }
      }]
    },
    useRef(initial) { const i = index++; slots[i] ??= { current: initial }; return slots[i] },
    useCallback(fn, deps) { const i = index++; if (!same(slots[i]?.deps, deps)) slots[i] = { deps, value: fn }; return slots[i].value },
    useEffect(effect, deps) {
      const i = index++
      if (!same(slots[i]?.deps, deps)) {
        const previous = slots[i]
        slots[i] = { deps }
        effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = effect() })
      }
    },
  }
  const storage = memoryStorage()
  const listeners = {}
  const window = { addEventListener: (type, fn) => { listeners[type] = fn }, removeEventListener: () => {} }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', 'localStorage', 'window', 'setTimeout', 'clearTimeout', 'globalThis', compiled.outputFiles[0].text)(
    () => react, module, module.exports, storage, window,
    (fn) => { timers.set(++timerId, fn); return timerId }, (id) => timers.delete(id), { localStorage: storage },
  )
  const render = () => {
    while (dirty) { dirty = false; index = 0; result = module.exports.default(props); while (effects.length) effects.shift()() }
    return result
  }
  render()
  return {
    storage, listeners, module: module.exports,
    get result() { return result },
    update(next) { Object.assign(props, next); dirty = true; render() },
    flushTimers() { const queue = [...timers.values()]; timers.clear(); queue.forEach(fn => fn()); dirty = true; render() },
    saved() { return JSON.parse(storage.getItem('treellis.scene.v1') || 'null') },
  }
}

const example = { name: 'Example plane', children: [] }

test('the example scene is never stored; the first change after it is', () => {
  const h = harness({ scene: null, enabled: true })
  h.update({ scene: example })
  h.flushTimers()
  assert.equal(h.result.status, 'example')
  assert.equal(h.saved(), null)

  const edited = { ...example, name: 'My plane' }
  h.update({ scene: edited })
  assert.equal(h.result.status, 'saving')
  h.flushTimers()
  assert.equal(h.result.status, 'saved')
  assert.deepEqual(h.saved().scene, edited)
})

test('a scene loaded from the server again is a new baseline, not an edit', () => {
  const h = harness({ scene: example, enabled: true })
  h.result.markPristine()
  const reloaded = { ...example }
  h.update({ scene: reloaded })
  h.flushTimers()
  assert.equal(h.result.status, 'example')
  assert.equal(h.saved(), null)
})

test('a restored scene is not rewritten until it changes, and storage failures are reported', () => {
  const restored = { name: 'Restored', children: [] }
  const h = harness({ scene: restored, enabled: true, restoredScene: restored, restoredAt: 5 })
  assert.equal(h.result.status, 'saved')
  assert.equal(h.result.savedAt, 5)
  h.flushTimers()
  assert.equal(h.saved(), null)

  h.storage.full = true
  h.update({ scene: { ...restored, name: 'Bigger' } })
  h.flushTimers()
  assert.equal(h.result.status, 'error')
})

test('a pending change is written when the page closes', () => {
  const h = harness({ scene: example, enabled: true })
  const edited = { ...example, name: 'Closing' }
  h.update({ scene: edited })
  h.listeners.beforeunload({ preventDefault() {} })
  assert.deepEqual(h.saved().scene, edited)
})

test('saved scenes load back, and broken or missing data is ignored', () => {
  const h = harness({ scene: null, enabled: false })
  const storage = memoryStorage()
  assert.equal(h.module.loadSavedScene(storage), null)
  storage.setItem('treellis.scene.v1', '{not json')
  assert.equal(h.module.loadSavedScene(storage), null)
  storage.setItem('treellis.scene.v1', JSON.stringify({ scene: example, savedAt: 9 }))
  assert.deepEqual(h.module.loadSavedScene(storage), { scene: example, savedAt: 9 })
  h.module.clearSavedScene(storage)
  assert.equal(h.module.loadSavedScene(storage), null)
})
