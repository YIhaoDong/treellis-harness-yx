import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const compiled = await build({
  stdin: { contents: `export { default as Layers, flattenSceneLayers, layerKind } from './src/components/SceneLayers.jsx'; export { default as Panel } from './src/components/SceneStructurePanel.jsx'`, resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'jsx' },
  bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react'], loader: { '.css': 'empty' },
})
const scene = { name: 'Plane', operation: 'union', children: [
  { name: 'Propeller', operation: 'union', children: [{ name: 'Blade A', primitive: { type: 'sphere' } }, { name: 'Blade B', primitive: { type: 'sphere' } }] },
  { name: 'Struts', kind: 'repeat', repeat: { type: 'linear' }, children: [{ name: 'Strut', primitive: { type: 'cylinder' } }] },
] }

function harness(component, initial) {
  const slots = [], effects = [], frames = new Map(), scrolled = [], focused = []
  let index = 0, frameId = 0, tree, dirty = true
  const props = { ...initial }
  const same = (a, b) => a && b && a.length === b.length && a.every((value, n) => Object.is(value, b[n]))
  const react = {
    createElement(type, input, ...children) {
      const p = { ...input, children: children.length === 1 ? children[0] : children }
      if (typeof type === 'function') return type(p)
      if (p.ref) {
        const element = { scrollTop: 0, clientHeight: 200, getBoundingClientRect: () => ({ top: p['data-path'] ? 400 : 0, height: 35 }), focus() { focused.push(p['data-path']) }, scrollTo(value) { scrolled.push(value) } }
        if (typeof p.ref === 'function') p.ref(element)
        else p.ref.current = element
      }
      return { type, props: p }
    },
    useState(initialValue) { const n = index++; slots[n] ??= { value: typeof initialValue === 'function' ? initialValue() : initialValue }; return [slots[n].value, update => {
      const next = typeof update === 'function' ? update(slots[n].value) : update
      if (!Object.is(next, slots[n].value)) { slots[n].value = next; dirty = true }
    }] },
    useRef(initialValue) { const n = index++; slots[n] ??= { current: initialValue }; return slots[n] },
    useMemo(fn, deps) { const n = index++; if (!same(slots[n]?.deps, deps)) slots[n] = { deps, value: fn() }; return slots[n].value },
    useEffect(fn, deps) { const n = index++; if (!same(slots[n]?.deps, deps)) { const old = slots[n]; slots[n] = { deps }; effects.push(() => { old?.cleanup?.(); slots[n].cleanup = fn() }) } },
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(name => {
    if (name === 'react') return react
    throw Error(`Unexpected import ${name}`)
  }, module, module.exports)
  const Component = module.exports[component]
  globalThis.requestAnimationFrame = fn => { const id = ++frameId; frames.set(id, fn); return id }
  globalThis.cancelAnimationFrame = id => frames.delete(id)
  globalThis.window = { matchMedia: () => ({ matches: false }) }
  const flatten = value => !value ? [] : Array.isArray(value) ? value.flatMap(flatten) : typeof value === 'object' ? [value, ...flatten(value.props?.children)] : []
  const text = value => !value ? '' : Array.isArray(value) ? value.map(text).join(' ') : typeof value === 'object' ? text(value.props?.children) : String(value)
  const h = { props, exports: module.exports, scrolled, focused,
    flush() { let loops = 0; while (dirty) { assert.ok(++loops < 20, 'Updates settle'); dirty = false; index = 0; tree = Component(props); while (effects.length) effects.shift()() } return tree },
    act(fn) { fn(); return h.flush() },
    update(next) { Object.assign(props, next); dirty = true; return h.flush() },
    tickFrames() { const queue = [...frames.values()]; frames.clear(); queue.forEach(fn => fn()); h.flush() },
    all() { return flatten(tree) }, text() { return text(tree) },
    row(path) { return h.all().find(item => item.props?.['data-path'] === path) },
    button(label) { const result = h.all().find(item => item.type === 'button' && (item.props['aria-label'] === label || item.props.title === label || text(item).trim() === label)); assert.ok(result, `Button ${label} exists`); return result },
    unmount() { for (const slot of slots) slot?.cleanup?.() },
  }
  h.flush()
  return h
}

test('layer outline preserves scene and repeat subtrees while folding only the requested group', () => {
  const h = harness('Layers', { scene })
  const before = JSON.stringify(scene)
  const rows = h.exports.flattenSceneLayers(scene, new Set(['0.0']))
  assert.deepEqual(rows.map(row => row.path), ['0', '0.0', '0.1', '0.1.0'])
  assert.equal(h.exports.layerKind(scene.children[1]), 'Linear Repeat')
  assert.equal(JSON.stringify(scene), before)
  assert.equal(h.exports.flattenSceneLayers(null).length, 0)
  h.unmount()
})

test('mouse and keyboard share Shift selection; collapsing does not mutate selection', () => {
  const selected = []
  const h = harness('Layers', { scene, selectedPaths: ['0.0.0', '0.0.1'], activePath: '0.0.1', onSelect: (...args) => selected.push(args) })
  assert.equal(h.row('0.0.0').props['aria-selected'], true)
  assert.equal(h.row('0.0.1').props['aria-selected'], true)
  h.act(() => h.row('0.0.0').props.onClick({ shiftKey: true, currentTarget: { focus() {} } }))
  assert.deepEqual(selected.pop(), ['0.0.0', { shiftKey: true }])
  const target = {}
  let prevented = false
  h.act(() => h.row('0.0.1').props.onKeyDown({ key: ' ', shiftKey: true, target, currentTarget: target, preventDefault() { prevented = true } }))
  assert.equal(prevented, true)
  assert.deepEqual(selected.pop(), ['0.0.1', { shiftKey: true }])
  h.act(() => h.button('Collapse Propeller').props.onClick({ stopPropagation() {} }))
  assert.equal(h.row('0.0.0'), undefined)
  assert.equal(selected.length, 0)
  h.unmount()
})

test('viewport focus reopens folded ancestors and scrolls the outline smoothly', () => {
  const done = []
  const h = harness('Layers', { scene, onFocusDone: (...args) => done.push(args) })
  h.act(() => h.button('Collapse Plane').props.onClick({ stopPropagation() {} }))
  assert.equal(h.row('0.0.1'), undefined)
  h.update({ focusPath: '0.0.1', focusRequestId: 9 })
  assert.ok(h.row('0.0.1'))
  h.tickFrames(); h.tickFrames()
  assert.deepEqual(done, [['0.0.1', 9]])
  assert.equal(h.scrolled[0].behavior, 'smooth')
  assert.ok(h.scrolled[0].top > 0)
  h.unmount()
})

test('outline row actions do not trigger an additional row selection', () => {
  const edited = [], selected = []
  const h = harness('Layers', { scene, onSelect: path => selected.push(path), onNodePrompt: path => edited.push(path) })
  let stopped = false
  h.act(() => h.button('AI edit Blade A').props.onClick({ stopPropagation() { stopped = true } }))
  assert.equal(stopped, true)
  assert.deepEqual(edited, ['0.0.0'])
  assert.deepEqual(selected, [])
  h.unmount()
})

test('shared toolbar switches views, toggles selection mode and exposes action availability', () => {
  const views = [], toggles = []
  const h = harness('Panel', { selectedPaths: ['0.0.0', '0.0.1'], canGroup: true, canUngroup: false, canSmartGroup: true,
    onViewChange: value => views.push(value), onMultiSelectChange: value => toggles.push(value) })
  h.button('Layers').props.onClick()
  h.button('Multi-select').props.onClick()
  assert.deepEqual(views, ['layers'])
  assert.deepEqual(toggles, [true])
  assert.match(h.text(), /2 selected/)
  assert.equal(h.button('Group selected parts').props.disabled, false)
  assert.equal(h.button('Ungroup selected group').props.disabled, true)
  h.update({ groupingBusy: true, multiSelect: true })
  assert.equal(h.button('Group selected parts').props.disabled, true)
  assert.equal(h.button('Organizing…').props.disabled, true)
  assert.equal(h.button('Multi-select').props['aria-pressed'], true)
  h.unmount()
})
