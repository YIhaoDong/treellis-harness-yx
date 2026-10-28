import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const compiled = await build({
  entryPoints: [fileURLToPath(new URL('../src/components/GenerationProgressPopover.jsx', import.meta.url))],
  bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'react-dom'],
})
const require = createRequire(import.meta.url)
function load(react = React) {
  const module = { exports: {} }
  new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(
    name => name === 'react' ? react : require(name), module, module.exports)
  return module.exports
}
const { GenerationProgressDisclosure } = load()
const progress = {
  strategy: 'staged', phase: 'parts', planReady: true,
  plan: ['细化机翼', '细化发动机', '细化座舱'],
  completedSteps: 1, totalSteps: 3, step: 2, title: '细化发动机', stage: 'part',
  startedAt: 1000, finishedAt: 26000, summary: 'Public model summary',
}

test('the collapsed chip exposes completion count, elapsed time, and disclosure semantics without the large details', () => {
  const html = renderToStaticMarkup(React.createElement(GenerationProgressDisclosure, { progress, busy: true }))
  assert.match(html, /Generation status: 1\/3 tasks, elapsed 00:25, Refining/)
  assert.match(html, /aria-expanded="false"/)
  assert.match(html, /aria-controls="generation-details-[^"]+"/)
  assert.match(html, /aria-haspopup="dialog"/)
  assert.match(html, /data-state="busy"/)
  assert.doesNotMatch(html, /Public model summary|Generation tasks|role="dialog"/)
})

test('nothing renders before generation, and unknown totals never invent a denominator', () => {
  assert.equal(renderToStaticMarkup(React.createElement(GenerationProgressDisclosure, { progress: null })), '')
  const render = state => renderToStaticMarkup(React.createElement(GenerationProgressDisclosure, { progress: state }))
  assert.match(render({ stage: 'planning' }), /Generation status: Planning,/)
  assert.match(render({ stage: 'planning', completedSteps: 1, totalSteps: 1, planReady: false }), /Generation status: 1 completed,/)
  assert.doesNotMatch(render({ stage: 'planning' }), /0\/0/)
})

// Use the actual component with controlled hook commits, DOM containment and events.
// Browser verification additionally checks pointer travel across the CSS hover bridge.
function withDisclosure(props, fn) {
  const real = { document: globalThis.document, interval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval, now: Date.now }
  const slots = [], pending = [], timers = new Map(), listeners = new Map()
  let cursor = 0, dirty = true, tree, timerId = 0, now = 26000, focusCount = 0
  const document = {
    activeElement: null,
    addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener) },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener) },
  }
  globalThis.document = document
  globalThis.setInterval = callback => { timers.set(++timerId, callback); return timerId }
  globalThis.clearInterval = id => timers.delete(id)
  Date.now = () => now
  const useSlot = initial => {
    const index = cursor++
    if (!slots[index]) slots[index] = typeof initial === 'function' ? initial() : initial
    return slots[index]
  }
  const mockReact = { ...React,
    useState(initial) {
      const state = useSlot(() => ({ value: typeof initial === 'function' ? initial() : initial }))
      return [state.value, update => {
        const value = typeof update === 'function' ? update(state.value) : update
        if (!Object.is(value, state.value)) { state.value = value; dirty = true }
      }]
    },
    useRef(initial) { return useSlot(() => ({ current: initial })) },
    useId() { return useSlot(() => `qa-${cursor}`) },
    useEffect(effect, deps) {
      const slot = useSlot(() => ({ deps: null, cleanup: null }))
      if (!slot.deps || deps.some((value, i) => !Object.is(value, slot.deps[i]))) {
        slot.deps = deps
        pending.push(() => { slot.cleanup?.(); slot.cleanup = effect() })
      }
    },
  }
  const { GenerationProgressDisclosure: Disclosure } = load(mockReact)
  const flatten = (element, match) => {
    if (!element || typeof element !== 'object') return null
    if (match(element)) return element
    return React.Children.toArray(element.props?.children).map(child => flatten(child, match)).find(Boolean)
  }
  const findClass = name => flatten(tree, node => node.props?.className === name)
  const triggerNode = { focus() {
    focusCount++
    const previous = document.activeElement
    document.activeElement = triggerNode
    if (previous !== triggerNode) tree.props.onFocusCapture({ currentTarget: rootNode, relatedTarget: previous })
  } }
  const panelNode = {}, outsideNode = {}
  const rootNode = { contains: node => [rootNode, triggerNode, panelNode].includes(node) }
  const h = {
    flush(nextProps) {
      if (nextProps) { props = { ...props, ...nextProps }; dirty = true }
      let attempts = 0
      while (dirty) {
        assert.ok(++attempts < 20, 'Disclosure should settle')
        dirty = false; cursor = 0; tree = Disclosure(props)
        if (tree) {
          tree.props.ref.current = rootNode
          findClass('generation-progress-popover__trigger').props.ref.current = triggerNode
        }
        while (pending.length) pending.shift()()
      }
      return tree
    },
    enter() { tree.props.onMouseEnter(); h.flush() },
    leave() { tree.props.onMouseLeave(); h.flush() },
    focus(from = outsideNode) {
      document.activeElement = triggerNode
      tree.props.onFocusCapture({ currentTarget: rootNode, relatedTarget: from }); h.flush()
    },
    blur(to = outsideNode) {
      document.activeElement = to
      tree.props.onBlurCapture({ currentTarget: rootNode, relatedTarget: to }); h.flush()
    },
    click() { findClass('generation-progress-popover__trigger').props.onClick(); h.flush() },
    close() { findClass('generation-progress-popover__close').props.onClick(); h.flush() },
    dispatch(type, event) { for (const callback of [...(listeners.get(type) || [])]) callback(event); h.flush() },
    tick(milliseconds) { now += milliseconds; for (const callback of [...timers.values()]) callback(); h.flush() },
    get open() { return !!findClass('generation-progress-popover__trigger')?.props['aria-expanded'] },
    get trigger() { return findClass('generation-progress-popover__trigger') },
    get dialog() { return flatten(tree, element => element.props?.role === 'dialog') },
    get content() { return flatten(tree, element => element.type?.name === 'GenerationProgress') },
    get focusCount() { return focusCount },
    get timerCount() { return timers.size },
    get document() { return document },
    panelNode, outsideNode,
  }
  try { h.flush(); return fn(h) } finally {
    for (const slot of slots) slot?.cleanup?.()
    globalThis.document = real.document
    globalThis.setInterval = real.interval
    globalThis.clearInterval = real.clearInterval
    Date.now = real.now
  }
}

test('hover opens the full existing details and leaving closes an unpinned disclosure', () => {
  const onResume = () => {}
  withDisclosure({ progress, busy: false, canResume: true, onResume }, h => {
    assert.equal(h.open, false)
    h.enter()
    assert.equal(h.open, true)
    assert.equal(h.dialog.props['aria-label'], 'Generation details')
    assert.equal(h.dialog.props.id, h.trigger.props['aria-controls'])
    assert.equal(h.content.props.progress, progress)
    assert.equal(h.content.props.canResume, true)
    assert.equal(h.content.props.onResume, onResume)
    h.leave()
    assert.equal(h.open, false)
  })
})

test('keyboard focus opens details, stays open inside the popup, and closes when focus leaves', () => {
  withDisclosure({ progress }, h => {
    h.focus()
    assert.equal(h.open, true)
    h.blur(h.panelNode)
    assert.equal(h.open, true)
    h.blur()
    assert.equal(h.open, false)
  })
})

test('click pins details across pointer leave, and the next click closes despite trigger focus', () => {
  withDisclosure({ progress }, h => {
    h.enter(); h.focus(); h.click(); h.leave()
    assert.equal(h.open, true)
    h.click()
    assert.equal(h.open, false)
    h.enter()
    assert.equal(h.open, true)
  })
})

test('Escape closes pinned details and returns focus without reopening or escaping to the underlying dialog', () => {
  withDisclosure({ progress }, h => {
    h.click()
    h.document.activeElement = h.outsideNode
    let prevented = false, stopped = false
    h.dispatch('keydown', { key: 'Escape', preventDefault() { prevented = true }, stopPropagation() { stopped = true } })
    assert.equal(h.open, false)
    assert.equal(h.focusCount, 1)
    assert.equal(prevented, true)
    assert.equal(stopped, true)
  })
})

test('outside pointer closes details, inside pointer keeps them open, and the close button restores focus', () => {
  withDisclosure({ progress }, h => {
    h.enter(); h.click()
    h.dispatch('pointerdown', { target: h.panelNode })
    assert.equal(h.open, true)
    h.dispatch('pointerdown', { target: h.outsideNode })
    assert.equal(h.open, false)
    h.click()
    assert.equal(h.open, true)
    h.close()
    assert.equal(h.open, false)
    assert.equal(h.focusCount, 1)
  })
})

test('the collapsed chip keeps ticking while busy and freezes at Stop with accumulated active time', () => {
  withDisclosure({ progress: { ...progress, finishedAt: undefined, elapsedBefore: 5000 }, busy: true }, h => {
    assert.match(h.trigger.props['aria-label'], /elapsed 00:30/)
    assert.equal(h.timerCount, 1)
    h.tick(65000)
    assert.match(h.trigger.props['aria-label'], /elapsed 01:35/)
    h.flush({ progress: { ...progress, stage: 'stopped', finishedAt: 91000, elapsedBefore: 5000 }, busy: false })
    assert.equal(h.timerCount, 0)
    h.tick(60000)
    assert.match(h.trigger.props['aria-label'], /elapsed 01:35/)
  })
})
