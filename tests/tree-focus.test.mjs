import test from 'node:test'
import assert from 'node:assert/strict'
import { animateTreeViewport, centerTreeViewport, expandTreeAncestors, sameTreeViewport, treeAncestorPaths, visibleTreeData } from '../src/utils/treeFocus.mjs'

function animationClock() {
  let time = 0
  let nextId = 0
  const pending = new Map()
  return {
    now: () => time,
    requestFrame: callback => { const id = ++nextId; pending.set(id, callback); return id },
    cancelFrame: id => pending.delete(id),
    advance: nextTime => {
      time = nextTime
      const callbacks = [...pending.values()]
      pending.clear()
      callbacks.forEach(callback => callback(time))
    },
    pending: () => pending.size,
  }
}

test('focus pans through intermediate positions, preserves zoom and completes at the exact destination', () => {
  const clock = animationClock()
  const from = { translate: { x: 0, y: 100 }, zoom: 0.47 }
  const to = { translate: { x: 600, y: -900 }, zoom: 0.47 }
  const frames = []
  let completions = 0
  animateTreeViewport(from, to, { ...clock, onUpdate: value => frames.push(value), onComplete: () => completions++ })
  clock.advance(75)
  clock.advance(150)
  assert.equal(completions, 0)
  assert.equal(frames.length, 2)
  assert.ok(frames[0].translate.x > 0 && frames[0].translate.x < frames[1].translate.x)
  assert.ok(frames[1].translate.x < to.translate.x)
  assert.ok(frames.every(value => value.zoom === 0.47))
  clock.advance(300)
  assert.deepEqual(frames.at(-1), to)
  assert.equal(completions, 1)
  assert.equal(clock.pending(), 0)
})

test('new focus starts at the displayed position and cancelled requests cannot move or complete later', () => {
  const clock = animationClock()
  let displayed = { translate: { x: 0, y: 0 }, zoom: 0.6 }
  let oldCompletions = 0
  const stop = animateTreeViewport(displayed, { translate: { x: 900, y: 400 }, zoom: 0.6 }, {
    ...clock, onUpdate: value => { displayed = value }, onComplete: () => oldCompletions++,
  })
  clock.advance(100)
  stop()
  const interrupted = displayed
  clock.advance(150)
  assert.equal(displayed, interrupted)
  const destination = { translate: { x: -400, y: -700 }, zoom: 0.6 }
  animateTreeViewport(displayed, destination, { ...clock, onUpdate: value => { displayed = value } })
  clock.advance(151)
  assert.ok(displayed.translate.x < interrupted.translate.x && displayed.translate.x > destination.translate.x)
  clock.advance(450)
  assert.deepEqual(displayed, destination)
  assert.equal(oldCompletions, 0)
  assert.equal(clock.pending(), 0)
})

test('manual interruption cancels scheduled frames and reduced motion skips intermediate movement', () => {
  const clock = animationClock()
  const from = { translate: { x: 10, y: 20 }, zoom: 1 }
  const to = { translate: { x: 800, y: -500 }, zoom: 1 }
  const frames = []
  let complete = 0
  const stop = animateTreeViewport(from, to, { ...clock, onUpdate: value => frames.push(value), onComplete: () => complete++ })
  stop()
  clock.advance(400)
  assert.deepEqual(frames, [])
  assert.equal(complete, 0)
  animateTreeViewport(from, to, { ...clock, reducedMotion: true, onUpdate: value => frames.push(value), onComplete: () => complete++ })
  clock.advance(416)
  assert.deepEqual(frames, [to])
  assert.equal(complete, 1)
  assert.equal(clock.pending(), 0)
})

test('focusing a deep node opens the root and every ancestor, retaining unrelated and target folds', () => {
  const collapsed = new Set(['0', '0.1', '0.1.2', '0.1.2.3', '0.2'])
  assert.deepEqual(treeAncestorPaths('0.1.2.3'), ['0', '0.1', '0.1.2'])
  assert.deepEqual([...expandTreeAncestors(collapsed, '0.1.2.3')], ['0.1.2.3', '0.2'])
  assert.deepEqual([...collapsed], ['0', '0.1', '0.1.2', '0.1.2.3', '0.2'])
  assert.equal(expandTreeAncestors(collapsed, '0'), collapsed)
  assert.equal(expandTreeAncestors(collapsed, 'invalid'), collapsed)
})

test('the visible tree genuinely hides folded descendants without deleting them from the source', () => {
  const source = { _path: '0', name: 'Root', children: [
    { _path: '0.0', name: 'Wing', children: [{ _path: '0.0.0', name: 'Flap' }] },
    { _path: '0.1', name: 'Engine' },
  ] }
  const folded = visibleTreeData(source, new Set(['0.0']))
  assert.equal(folded.children[0].children, undefined)
  assert.equal(folded.children[1].name, 'Engine')
  assert.equal(source.children[0].children[0].name, 'Flap')
  assert.equal(visibleTreeData(source, new Set(['0'])).children, undefined)
  const expanded = visibleTreeData(source, expandTreeAncestors(new Set(['0', '0.0']), '0.0.0'))
  assert.equal(expanded.children[0].children[0].name, 'Flap')
})

test('offscreen leaf centering preserves zoom and applies the full screen delta to D3 translation', () => {
  const current = { translate: { x: 100, y: -40 }, zoom: 0.35 }
  const node = { left: 1400, top: 1100, width: 70, height: 50 }
  const visible = { left: 0, top: 80, width: 500, height: 640 }
  const next = centerTreeViewport(current, node, visible)
  assert.deepEqual(next, { translate: { x: -1085, y: -765 }, zoom: 0.35 })
  assert.equal(node.left + node.width / 2 + next.translate.x - current.translate.x, 250)
  assert.equal(node.top + node.height / 2 + next.translate.y - current.translate.y, 400)
  assert.deepEqual(current, { translate: { x: 100, y: -40 }, zoom: 0.35 })
})

test('centering uses the visible scrollport including a scrolled container and page offsets', () => {
  const current = { translate: { x: -320, y: 600 }, zoom: 0.8 }
  // DOM node coordinates already include the container scroll offset.
  const node = { left: -90, top: -210, width: 160, height: 100 }
  const scrollport = { left: 75, top: 120, width: 420, height: 500 }
  const next = centerTreeViewport(current, node, scrollport)
  assert.equal(next.zoom, 0.8)
  assert.equal(-10 + next.translate.x - current.translate.x, 285)
  assert.equal(-160 + next.translate.y - current.translate.y, 370)
})

test('outer CSS scaling is accounted for independently from tree zoom', () => {
  const current = { translate: { x: 20, y: 30 }, zoom: 0.25 }
  const next = centerTreeViewport(current,
    { left: 900, top: 500, width: 100, height: 80 },
    { left: 50, top: 60, width: 600, height: 400 }, { x: 2, y: 1.5 })
  assert.equal(next.translate.x, -280)
  assert.equal(next.translate.y, 30 - 280 / 1.5)
  assert.equal(next.zoom, 0.25)
})

test('a centered repeated selection makes no transform change and equal updates do not trigger render loops', () => {
  const current = { translate: { x: 100, y: 96 }, zoom: 0.47 }
  const next = centerTreeViewport(current,
    { left: 200, top: 280, width: 100, height: 40 },
    { left: 0, top: 100, width: 500, height: 400 })
  assert.deepEqual(next, current)
  assert.equal(sameTreeViewport(current, next), true)
  assert.equal(sameTreeViewport(current, { ...next, zoom: 0.470001 }), true)
  assert.equal(sameTreeViewport(current, { ...next, zoom: 1 }), false)
  assert.equal(sameTreeViewport(current, { ...next, translate: { x: 110, y: 96 } }), false)
})

test('hidden, detached or invalid geometry cannot produce invalid tree transforms', () => {
  const current = { translate: { x: 100, y: 96 }, zoom: 0.5 }
  const node = { left: 0, top: 0, width: 100, height: 100 }
  const visible = { left: 0, top: 0, width: 500, height: 600 }
  assert.equal(centerTreeViewport(current, node, { ...visible, width: 0 }), null)
  assert.equal(centerTreeViewport(current, { ...node, top: NaN }, visible), null)
  assert.equal(centerTreeViewport({ ...current, zoom: 0 }, node, visible), null)
  assert.equal(centerTreeViewport(current, node, visible, { x: 0, y: 1 }), null)
})
