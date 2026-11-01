import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const compiled = await build({ entryPoints: [fileURLToPath(new URL('../src/hooks/useSceneSelection.jsx', import.meta.url))],
  bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react'] })
const scene = { name: 'Aircraft', children: [{ name: 'Wing' }, { name: 'Engine' }] }

function harness(initialScene = scene) {
  const slots = [], effects = []
  let index = 0, dirty = true, liveScene = initialScene, value
  const same = (a, b) => !!a && a.length === b.length && a.every((item, i) => Object.is(item, b[i]))
  const hooks = {
    useState(initial) {
      const i = index++
      slots[i] ??= { value: typeof initial === 'function' ? initial() : initial }
      return [slots[i].value, update => {
        const next = typeof update === 'function' ? update(slots[i].value) : update
        if (!Object.is(next, slots[i].value)) { slots[i].value = next; dirty = true }
      }]
    },
    useRef(initial) { const i = index++; slots[i] ??= { current: initial }; return slots[i] },
    useCallback(callback, deps) {
      const i = index++
      if (!same(slots[i]?.deps, deps)) slots[i] = { value: callback, deps }
      return slots[i].value
    },
    useEffect(effect, deps) {
      const i = index++
      if (!same(slots[i]?.deps, deps)) {
        const old = slots[i]
        slots[i] = { deps }
        effects.push(() => { old?.cleanup?.(); slots[i].cleanup = effect() })
      }
    },
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(name => {
    assert.equal(name, 'react'); return hooks
  }, module, module.exports)
  const useSelection = module.exports.default
  const flush = () => {
    let turns = 0
    while (dirty) {
      assert.ok(++turns < 20, 'Selection updates must settle')
      dirty = false; index = 0; value = useSelection({ liveScene })
      while (effects.length) effects.shift()()
    }
    return value
  }
  flush()
  return { get value() { return value }, act(callback) { callback(value); return flush() },
    scene(next, callback) { callback?.(value); liveScene = next; dirty = true; return flush() } }
}

test('hover without selection is transient and does not leave a stale highlighted part', () => {
  const h = harness()
  const hover = h.value.handleSceneHoverPath
  h.act(v => v.handleSceneHoverPath('0.0'))
  assert.equal(h.value.highlightPath, '0.0')
  assert.equal(h.value.selectedPath, null)
  h.act(v => v.handleSceneHoverPath(null))
  assert.equal(h.value.highlightPath, null)
  assert.equal(h.value.handleSceneHoverPath, hover)
})

test('selected viewport parts keep their highlight across hover changes and closing the parameter panel', () => {
  const h = harness()
  h.act(v => v.handleSceneClickPath('0.1'))
  assert.equal(h.value.panelTitle, 'Engine')
  assert.equal(h.value.treeFocusPath, '0.1')
  h.act(v => v.handleSceneHoverPath('0.0'))
  assert.equal(h.value.highlightPath, '0.1')
  h.act(v => v.clearPanel())
  assert.equal(h.value.panelPath, null)
  assert.equal(h.value.selectedPath, '0.1')
  assert.equal(h.value.highlightPath, '0.1')
  h.act(v => v.handleSceneHoverPath(null))
  assert.equal(h.value.highlightPath, '0.1')
  h.act(v => v.handleSceneClickPath('0.0'))
  assert.equal(h.value.highlightPath, '0.0')
  assert.equal(h.value.panelTitle, 'Wing')
})

test('repeat clicks request a fresh tree focus and an older completion cannot clear the new request', () => {
  const h = harness()
  const acknowledge = h.value.acknowledgeTreeFocus
  h.act(v => v.handleSceneClickPath('0.1'))
  const first = h.value.treeFocusRequestId
  h.act(v => v.handleSceneClickPath('0.1'))
  const second = h.value.treeFocusRequestId
  assert.ok(second > first)
  h.act(v => v.acknowledgeTreeFocus('0.1', first))
  assert.equal(h.value.treeFocusPath, '0.1')
  h.act(v => v.acknowledgeTreeFocus('0.1', second))
  assert.equal(h.value.treeFocusPath, null)
  assert.equal(h.value.selectedPath, '0.1')
  assert.equal(h.value.acknowledgeTreeFocus, acknowledge)
})

test('explicit empty-space clicks clear selection while invalid stale mesh paths are ignored', () => {
  const h = harness()
  h.act(v => v.handleSceneClickPath('0.0'))
  h.act(v => v.handleSceneClickPath('0.8'))
  assert.equal(h.value.selectedPath, '0.0')
  h.act(v => v.handleSceneClickPath(null))
  assert.equal(h.value.selectedPath, null)
  assert.equal(h.value.highlightPath, null)
  assert.equal(h.value.panelPath, null)
  assert.equal(h.value.treeFocusPath, null)
  assert.deepEqual(scene, { name: 'Aircraft', children: [{ name: 'Wing' }, { name: 'Engine' }] })
})

test('tree selection and existing add/paste selection APIs retain the same persistent behavior', () => {
  const h = harness()
  h.act(v => v.handleOpenPanel({ path: '0.0', title: 'Wing' }))
  h.act(v => v.setPanelPath('0.1'))
  assert.equal(h.value.selectedPath, '0.1')
  assert.equal(h.value.highlightPath, '0.1')
  h.act(v => v.clearPanel())
  assert.equal(h.value.highlightPath, '0.1')
  h.act(v => v.setHighlightPath(null))
  assert.equal(h.value.selectedPath, null)
  assert.equal(h.value.highlightPath, null)
})

test('legacy add/paste setters can select a new path in the same batch as its scene update', () => {
  const h = harness()
  const next = { ...scene, children: [...scene.children, { name: 'New propeller' }] }
  h.scene(next, v => { v.setPanelPath('0.2'); v.setHighlightPath('0.2') })
  assert.deepEqual(h.value.selectedPaths, ['0.2'])
  assert.equal(h.value.panelPath, '0.2')
  assert.equal(h.value.panelTitle, 'New propeller')
})

test('parameter titles still follow scene edits without losing the selected part', () => {
  const h = harness()
  h.act(v => v.handleSceneClickPath('0.1'))
  h.scene({ ...scene, children: [scene.children[0], { name: 'Detailed Engine' }] })
  assert.equal(h.value.panelTitle, 'Detailed Engine')
  assert.equal(h.value.highlightPath, '0.1')
})

test('Shift clicks across tree and viewport toggle a shared set and choose the latest primary', () => {
  const h = harness()
  h.act(v => v.handleOpenPanel({ path: '0.0', title: 'Wing' }))
  h.act(v => v.handleSceneClickPath('0.1', { shiftKey: true }))
  assert.deepEqual(h.value.selectedPaths, ['0.0', '0.1'])
  assert.deepEqual(h.value.highlightPaths, ['0.0', '0.1'])
  assert.equal(h.value.selectedPath, '0.1')
  assert.equal(h.value.panelTitle, 'Engine')
  h.act(v => v.handleOpenPanel({ path: '0.1', title: 'Engine', shiftKey: true }))
  assert.deepEqual(h.value.selectedPaths, ['0.0'])
  assert.equal(h.value.panelPath, '0.0')
  assert.equal(h.value.panelTitle, 'Wing')
  h.act(v => v.handleSceneClickPath('0.1'))
  assert.deepEqual(h.value.selectedPaths, ['0.1'])
})

test('multi-select mode accepts ordinary taps, preserves its set across hover and panel close, and can clear', () => {
  const h = harness()
  h.act(v => {
    v.setMultiSelect(true)
    v.handleSceneClickPath('0.0')
    v.handleSceneClickPath('0.1')
  })
  assert.equal(h.value.multiSelect, true)
  assert.deepEqual(h.value.selectedPaths, ['0.0', '0.1'])
  h.act(v => { v.handleSceneHoverPath('0'); v.clearPanel() })
  assert.deepEqual(h.value.highlightPaths, ['0.0', '0.1'])
  h.act(v => v.handleSceneClickPath(null))
  assert.deepEqual(h.value.selectedPaths, ['0.0', '0.1'], 'additive blank tap is non-destructive')
  h.act(v => v.handleSceneClickPath('0.1'))
  assert.deepEqual(h.value.selectedPaths, ['0.0'])
  h.act(v => v.handleSceneClickPath('0.0'))
  assert.deepEqual(h.value.selectedPaths, [])
  assert.deepEqual(h.value.highlightPaths, [])
  assert.equal(h.value.panelPath, null)
  h.act(v => { v.handleSceneClickPath('0.0'); v.deselectAll() })
  assert.deepEqual(h.value.selectedPaths, [])
  assert.equal(h.value.multiSelect, true, 'clearing selection does not disable the mode')
})

test('turning multi-select off retains selection until a normal replacement click', () => {
  const h = harness()
  h.act(v => v.selectPaths(['0.0', '0.1']))
  h.act(v => v.setMultiSelect(false))
  assert.deepEqual(h.value.selectedPaths, ['0.0', '0.1'])
  h.act(v => v.handleOpenPanel({ path: '0.0' }))
  assert.deepEqual(h.value.selectedPaths, ['0.0'])
  h.act(v => v.handleSceneClickPath(null))
  assert.deepEqual(h.value.selectedPaths, [])
})

test('scene removal prunes invalid selections and returns the panel to the surviving primary', () => {
  const h = harness()
  h.act(v => v.selectPaths(['0.0', '0.1', '0.0', '0.99', 'garbage']))
  assert.deepEqual(h.value.selectedPaths, ['0.0', '0.1'])
  h.scene({ name: 'Aircraft', children: [{ name: 'Wing' }] })
  assert.deepEqual(h.value.selectedPaths, ['0.0'])
  assert.deepEqual(h.value.highlightPaths, ['0.0'])
  assert.equal(h.value.panelPath, '0.0')
  assert.equal(h.value.panelTitle, 'Wing')
  h.scene({ name: 'Empty aircraft' })
  assert.deepEqual(h.value.selectedPaths, [])
  assert.equal(h.value.panelPath, null)
  assert.equal(h.value.treeFocusPath, null)
})

test('programmatic selection and remapping use the next scene and retain descendant selection', () => {
  const h = harness()
  const grouped = { name: 'Aircraft', children: [{ name: 'Assembly', children: scene.children }] }
  h.scene(grouped, v => v.selectPaths(['0.0.0', '0.0.1'], { focusPath: '0.0.0', scene: grouped }))
  assert.deepEqual(h.value.selectedPaths, ['0.0.0', '0.0.1'])
  assert.equal(h.value.panelTitle, 'Wing')
  const renamed = { name: 'Aircraft', children: [scene.children[0], { name: 'Assembly', children: scene.children }] }
  h.scene(renamed, v => v.remapSelection(new Map([['0.0', '0.1']]), { scene: renamed }))
  assert.deepEqual(h.value.selectedPaths, ['0.1.0', '0.1.1'])
  assert.equal(h.value.selectedPath, '0.1.0')
  assert.equal(h.value.panelTitle, 'Wing')
  h.act(v => v.remapSelection({ '0.1.0': null }))
  assert.deepEqual(h.value.selectedPaths, ['0.1.1'])
  assert.equal(h.value.panelTitle, 'Engine')
})
