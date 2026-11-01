import test from 'node:test'
import assert from 'node:assert/strict'
import { bindViewportPicking, markViewportNavigation } from '../src/utils/viewportGesture.mjs'

class EventSurface {
  listeners = new Map()
  style = { cursor: '' }
  addEventListener(type, handler, options) {
    const entries = this.listeners.get(type) || []
    entries.push({ handler, capture: options === true || options?.capture === true })
    this.listeners.set(type, entries)
  }
  removeEventListener(type, handler, options) {
    const capture = options === true || options?.capture === true
    this.listeners.set(type, (this.listeners.get(type) || [])
      .filter((entry) => entry.handler !== handler || entry.capture !== capture))
  }
  fire(type, event, capture) {
    for (const entry of this.listeners.get(type) || []) {
      if (capture == null || entry.capture === capture) entry.handler(event)
    }
  }
  getBoundingClientRect() { return { left: 0, top: 0, width: 300, height: 300 } }
  listenerCount() { return [...this.listeners.values()].reduce((sum, list) => sum + list.length, 0) }
}

function setup() {
  const root = new EventSurface()
  const canvas = new EventSurface()
  canvas.ownerDocument = { defaultView: root }
  const clicks = []
  const clickOptions = []
  const hovers = []
  let selected = '0.0'
  let intersectionCount = 0
  const dispose = bindViewportPicking(canvas, {
    intersect(x) { intersectionCount++; return x < 100 ? '0.0' : x < 200 ? '0.1' : null },
    onClickPath(path, options) { selected = path; clicks.push(path); clickOptions.push(options) },
    onHoverPath(path) { hovers.push(path) },
  })
  function send(type, overrides = {}, outside = false) {
    const event = {
      pointerId: 1, pointerType: 'mouse', isPrimary: true,
      button: 0, buttons: type === 'pointerup' ? 0 : 1,
      clientX: 50, clientY: 50, ...overrides,
    }
    root.fire(type, event, true)
    if (!outside) {
      canvas.fire(type, event, true)
      canvas.fire(type, event, false)
    }
    root.fire(type, event, false)
  }
  return { canvas, root, clicks, clickOptions, hovers, send, dispose,
    get selected() { return selected }, get intersectionCount() { return intersectionCount } }
}

test('primary click commits a picked part on release, with small hand jitter allowed', () => {
  const f = setup()
  f.send('pointerdown', { clientX: 145 })
  assert.deepEqual(f.clicks, [])
  assert.equal(f.selected, '0.0')
  f.send('pointermove', { clientX: 148, clientY: 54 })
  f.send('pointerup', { clientX: 148, clientY: 54 })
  assert.deepEqual(f.clicks, ['0.1'])
  assert.equal(f.selected, '0.1')
  f.dispose()
})

test('a completed blank click clears selection, while a blank drag preserves it', () => {
  const f = setup()
  f.send('pointerdown', { clientX: 250 })
  f.send('pointermove', { clientX: 220 })
  f.send('pointerup', { clientX: 220 })
  assert.equal(f.selected, '0.0')
  assert.deepEqual(f.clicks, [])
  f.send('pointerdown', { clientX: 250 })
  f.send('pointerup', { clientX: 250 })
  assert.deepEqual(f.clicks, [null])
  assert.equal(f.selected, null)
  f.dispose()
})

test('left, right, and middle camera drags never pick or clear an existing part', () => {
  for (const [button, buttons] of [[0, 1], [1, 4], [2, 2]]) {
    const f = setup()
    f.send('pointerdown', { button, buttons, clientX: 145 })
    f.send('pointermove', { button, buttons, clientX: 250 })
    f.send('pointerup', { button, clientX: 250 })
    assert.equal(f.selected, '0.0', `button ${button}`)
    assert.deepEqual(f.clicks, [])
    f.dispose()
  }
})

test('a drag returning to its start remains a drag, and a far release needs no move event', () => {
  const f = setup()
  f.send('pointerdown', { clientX: 145 })
  f.send('pointermove', { clientX: 170 })
  f.send('pointermove', { clientX: 145 })
  f.send('pointerup', { clientX: 145 })
  f.send('pointerdown', { clientX: 145 })
  f.send('pointerup', { clientX: 250 })
  assert.deepEqual(f.clicks, [])
  assert.equal(f.selected, '0.0')
  f.dispose()
})

test('modifier-assisted pan and modifiers pressed during a tap preserve selection', () => {
  const f = setup()
  for (const modifier of ['shiftKey', 'ctrlKey', 'metaKey', 'altKey']) {
    f.send('pointerdown', { clientX: 145, [modifier]: true })
    f.send('pointerup', { clientX: 145 })
  }
  f.send('pointerdown', { clientX: 145 })
  f.send('keydown', { key: 'Shift' })
  f.send('pointerup', { clientX: 145 })
  assert.deepEqual(f.clicks, [])
  assert.equal(f.selected, '0.0')
  f.dispose()
})

test('a held Shift tap forwards additive metadata while Shift panning never commits a pick', () => {
  const f = setup()
  f.send('pointerdown', { clientX: 145, shiftKey: true })
  f.send('pointermove', { clientX: 147, shiftKey: true })
  f.send('pointerup', { clientX: 147, shiftKey: true })
  assert.deepEqual(f.clicks, ['0.1'])
  assert.deepEqual(f.clickOptions, [{ shiftKey: true, additive: true }])
  f.send('pointerdown', { clientX: 145, shiftKey: true })
  f.send('pointermove', { clientX: 180, shiftKey: true })
  f.send('pointerup', { clientX: 145, shiftKey: true })
  assert.deepEqual(f.clicks, ['0.1'], 'returning to the start of a pan is still a drag')
  f.send('pointerdown', { clientX: 250, shiftKey: true })
  f.send('wheel', { deltaY: -10, shiftKey: true })
  f.send('pointerup', { clientX: 250, shiftKey: true })
  assert.deepEqual(f.clicks, ['0.1'], 'wheel cancels an additive tap')
  f.dispose()
})

test('wheel zoom keeps selection and cancels a tap still held down', () => {
  const f = setup()
  f.send('wheel', { deltaY: 100 })
  f.send('pointerdown', { clientX: 250 })
  f.send('wheel', { deltaY: -100 })
  f.send('pointerup', { clientX: 250 })
  assert.deepEqual(f.clicks, [])
  assert.equal(f.selected, '0.0')
  f.dispose()
})

test('a HUD axis navigation tap preserves selection even though the main-scene ray hits blank', () => {
  const f = setup()
  const markAxisTap = (event) => {
    if (event.clientY === 250) markViewportNavigation(event)
  }
  // Capture runs before the existing picker even when registered afterwards;
  // the real Gizmo guard identifies geometry using its HUD camera raycast.
  f.canvas.addEventListener('pointerdown', markAxisTap, true)
  f.send('pointerdown', { clientX: 250, clientY: 250 })
  f.send('pointerup', { clientX: 250, clientY: 250 })
  assert.deepEqual(f.clicks, [])
  assert.equal(f.selected, '0.0')
  f.send('pointerdown', { clientX: 250, clientY: 245 })
  f.send('pointerup', { clientX: 250, clientY: 245 })
  assert.deepEqual(f.clicks, [null], 'nearby true blank is still selectable')
  f.canvas.removeEventListener('pointerdown', markAxisTap, true)
  f.dispose()
})

test('single-finger touch selects, while multi-touch pinch never commits either finger', () => {
  const f = setup()
  f.send('pointerdown', { pointerType: 'touch', clientX: 145 })
  f.send('pointerup', { pointerType: 'touch', clientX: 145 })
  assert.equal(f.selected, '0.1')
  f.send('pointerdown', { pointerType: 'touch', clientX: 250 })
  f.send('pointerdown', { pointerId: 2, pointerType: 'touch', isPrimary: false, clientX: 145 })
  f.send('pointermove', { pointerId: 2, pointerType: 'touch', isPrimary: false, clientX: 160 })
  f.send('pointerup', { pointerId: 2, pointerType: 'touch', isPrimary: false, clientX: 160 })
  f.send('pointerup', { pointerType: 'touch', clientX: 250 })
  assert.deepEqual(f.clicks, ['0.1'])
  assert.equal(f.selected, '0.1')
  f.dispose()
})

test('cancel, lost capture, and window blur discard an unfinished tap and allow the next tap', () => {
  for (const cancellation of ['pointercancel', 'lostpointercapture', 'blur']) {
    const f = setup()
    f.send('pointerdown', { clientX: 250 })
    f.send(cancellation)
    f.send('pointerup', { clientX: 250 })
    assert.deepEqual(f.clicks, [], cancellation)
    assert.equal(f.selected, '0.0')
    f.send('pointerdown', { clientX: 145 })
    f.send('pointerup', { clientX: 145 })
    assert.equal(f.selected, '0.1')
    f.dispose()
  }
})

test('releasing outside canvas never clears the selection or leaves the next gesture blocked', () => {
  const f = setup()
  f.send('pointerdown', { clientX: 299 })
  f.send('pointerup', { clientX: 302 }, true)
  assert.deepEqual(f.clicks, [])
  f.send('pointerdown', { clientX: 145 })
  f.send('pointermove', { clientX: 350 }, true)
  f.send('pointerup', { clientX: 145 })
  assert.deepEqual(f.clicks, [])
  f.send('pointerdown', { clientX: 145 })
  f.send('pointerup', { clientX: 145 })
  assert.equal(f.selected, '0.1')
  f.dispose()
})

test('hover raycasts pause throughout navigation and resume on the next unpressed move', () => {
  const f = setup()
  f.send('pointermove', { clientX: 145, buttons: 0 })
  assert.deepEqual(f.hovers, ['0.1'])
  f.send('pointerdown', { clientX: 145 })
  const hoverCount = f.hovers.length
  const intersectionCount = f.intersectionCount
  f.send('pointermove', { clientX: 250 })
  f.send('pointerleave')
  f.send('pointermove', { clientX: 50 })
  f.send('pointerup', { clientX: 50 })
  assert.equal(f.hovers.length, hoverCount)
  assert.equal(f.intersectionCount, intersectionCount)
  f.send('pointermove', { clientX: 50, buttons: 0 })
  assert.deepEqual(f.hovers.at(-1), '0.0')
  f.dispose()
})

test('button chords reject picking, and cleanup removes every global and canvas listener', () => {
  const f = setup()
  f.send('pointerdown', { clientX: 250 })
  f.send('pointermove', { clientX: 250, buttons: 3 })
  f.send('pointerup', { clientX: 250 })
  assert.deepEqual(f.clicks, [])
  f.dispose()
  assert.equal(f.canvas.listenerCount(), 0)
  assert.equal(f.root.listenerCount(), 0)
  assert.equal(f.canvas.style.cursor, '')
  f.send('pointerdown', { clientX: 145 })
  f.send('pointerup', { clientX: 145 })
  assert.deepEqual(f.clicks, [])
})
