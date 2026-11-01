import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const entries = ['useEditHistory', 'useSceneSelection']
const compiled = await Promise.all(entries.map(name => build({
  entryPoints: [fileURLToPath(new URL(`../src/hooks/${name}.jsx`, import.meta.url))],
  bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react'],
})))

// Run the actual App handlers rather than repeating their selection policy here.
// The hooks are bundled separately so this regression needs no WebGL or DOM.
const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8')
const handlerBodies = Object.fromEntries(['Undo', 'Redo'].map(action => {
  const body = appSource.match(new RegExp(`on${action}=\\{\\(\\) => \\{([\\s\\S]*?)\\n          \\}\\}`))?.[1]
  assert.ok(body, `The App ${action} handler must be available to exercise`)
  return [action.toLowerCase(), new Function('undo', 'redo', 'deselectAll', 'setReloadKey', body)]
}))

const initialScene = {
  name: 'Aircraft', operation: 'union', children: [
    { name: 'Wing', transform: { t: [0, 0, 0] }, primitive: { type: 'box', material: { color: '#aabbcc' } } },
    { name: 'Engine', transform: { t: [0, 0, 0] }, primitive: { type: 'sphere', material: { color: '#aabbcc' } } },
  ],
}
const clone = value => structuredClone(value)

function harness() {
  const slots = [], layoutEffects = [], effects = []
  let index = 0, dirty = true, liveScene = clone(initialScene), history, selection, reloads = 0
  const same = (a, b) => !!a && a.length === b.length && a.every((item, i) => Object.is(item, b[i]))
  const effectHook = queue => (effect, deps) => {
    const i = index++
    if (!same(slots[i]?.deps, deps)) {
      const old = slots[i]
      slots[i] = { deps }
      queue.push(() => { old?.cleanup?.(); slots[i].cleanup = effect() })
    }
  }
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
    useLayoutEffect: effectHook(layoutEffects),
    useEffect: effectHook(effects),
  }
  const [useHistory, useSelection] = compiled.map(result => {
    const module = { exports: {} }
    new Function('require', 'module', 'exports', result.outputFiles[0].text)(name => {
      assert.equal(name, 'react'); return hooks
    }, module, module.exports)
    return module.exports.default
  })
  const setLiveScene = scene => { liveScene = scene; dirty = true }
  const flush = () => {
    let turns = 0
    while (dirty) {
      assert.ok(++turns < 30, 'History and selection updates must settle')
      dirty = false; index = 0
      history = useHistory({ liveScene, setLiveScene })
      selection = useSelection({ liveScene })
      while (layoutEffects.length) layoutEffects.shift()()
      while (effects.length) effects.shift()()
    }
  }
  const act = callback => { const result = callback(); flush(); return result }
  flush()
  return {
    act,
    get history() { return history }, get selection() { return selection },
    get scene() { return liveScene }, get reloads() { return reloads },
    select(paths, focusPath = paths.at(-1)) {
      act(() => selection.selectPaths(paths, { focusPath }))
    },
    edit(tag, mutate, { finish = true } = {}) {
      act(() => {
        history.beginEdit()
        const next = clone(liveScene)
        mutate(next)
        setLiveScene(next)
        history.editDirtyRef.current = true
        history.editTagRef.current = tag
      })
      if (finish) act(() => history.endEdit(tag))
    },
    generate(tag, next) {
      act(() => { history.recordGeneration(next, tag); setLiveScene(next) })
    },
    navigate(direction) {
      act(() => handlerBodies[direction](history.undo, history.redo, selection.deselectAll,
        update => { reloads = typeof update === 'function' ? update(reloads) : update }))
    },
  }
}

function assertSelection(h, paths, primary = paths.at(-1) ?? null) {
  assert.deepEqual(h.selection.selectedPaths, paths)
  assert.deepEqual(h.selection.highlightPaths, paths)
  assert.equal(h.selection.selectedPath, primary)
  assert.equal(h.selection.highlightPath, primary)
  assert.equal(h.selection.panelPath, primary)
}

const mutations = {
  'param-change': scene => { scene.children[0].transform.t[0] = 3.5 },
  rename: scene => { scene.children[0].name = 'Long Wing' },
  color: scene => { scene.children[0].primitive.material.color = '#ff0000' },
}

for (const [tag, mutate] of Object.entries(mutations)) {
  for (const paths of [['0.0'], ['0.1', '0.0']]) {
    test(`${tag} Undo/Redo keeps ${paths.length === 1 ? 'single selection' : 'multi-selection'} and its parameter target`, () => {
      const h = harness()
      h.select(paths)
      const focusRequest = h.selection.treeFocusRequestId
      const before = clone(h.scene)
      h.edit(tag, mutate)
      const after = clone(h.scene)
      assert.notDeepEqual(after, before)
      for (let repeat = 0; repeat < 3; repeat++) {
        h.navigate('undo')
        assert.deepEqual(h.scene, before)
        assertSelection(h, paths)
        assert.equal(h.selection.panelTitle, 'Wing')
        h.navigate('redo')
        assert.deepEqual(h.scene, after)
        assertSelection(h, paths)
        assert.equal(h.selection.panelTitle, tag === 'rename' ? 'Long Wing' : 'Wing')
      }
      assert.equal(h.selection.treeFocusRequestId, focusRequest, 'History must not recenter the selected tree node')
      assert.equal(h.reloads, 0, 'Attribute history must not reframe the 3D camera')
    })
  }
}

test('editing A and selecting B before Undo keeps the current selection B', () => {
  const h = harness()
  h.select(['0.0'])
  h.edit('param-change', mutations['param-change'])
  h.select(['0.1'])
  h.navigate('undo')
  assertSelection(h, ['0.1'])
  assert.equal(h.selection.panelTitle, 'Engine')
  assert.equal(h.scene.children[0].transform.t[0], 0)
  h.navigate('redo')
  assertSelection(h, ['0.1'])
  assert.equal(h.scene.children[0].transform.t[0], 3.5)
})

test('Undo before an attribute edit ends keeps selection and transfers its policy to Redo', () => {
  const h = harness()
  h.select(['0.0', '0.1'])
  h.edit('param-change', mutations['param-change'], { finish: false })
  assert.equal(h.history.editingRef.current, true)
  h.navigate('undo')
  assertSelection(h, ['0.0', '0.1'])
  assert.equal(h.scene.children[0].transform.t[0], 0)
  assert.equal(h.history.editingRef.current, false)
  assert.equal(h.history.editDirtyRef.current, false)
  assert.equal(h.history.editTagRef.current, null)
  h.navigate('redo')
  assertSelection(h, ['0.0', '0.1'])
  assert.equal(h.scene.children[0].transform.t[0], 3.5)
})

for (const finish of [false, true]) {
  test(`focus without changing a value ${finish ? 'then blur' : 'before blur'} does not clear selection on Undo/Redo`, () => {
    const h = harness()
    h.select(['0.0'])
    h.act(() => h.history.beginEdit())
    if (finish) h.act(() => h.history.endEdit('param-change'))
    const before = clone(h.scene)
    h.navigate('undo')
    assertSelection(h, ['0.0'])
    assert.deepEqual(h.scene, before)
    h.navigate('redo')
    assertSelection(h, ['0.0'])
    assert.deepEqual(h.scene, before)
  })
}

test('Undo/Redo across mixed attribute and structural checkpoints never reuse the wrong selection policy', () => {
  const h = harness()
  h.select(['0.0'])
  h.edit('param-change', mutations['param-change'])
  h.edit('delete', scene => { scene.children.splice(0, 1) })
  h.select(['0.0']) // Engine now occupies the old Wing path.
  h.navigate('undo')
  assertSelection(h, [])
  assert.equal(h.scene.children[0].name, 'Wing')
  h.select(['0.1'])
  h.navigate('undo')
  assertSelection(h, ['0.1'])
  assert.equal(h.scene.children[0].transform.t[0], 0)
  h.navigate('redo')
  assertSelection(h, ['0.1'])
  h.navigate('redo')
  assertSelection(h, [])
  assert.equal(h.scene.children[0].name, 'Engine')
})

for (const tag of ['add', 'delete', 'paste-as-union']) {
  test(`${tag} checkpoints keep structural Undo/Redo selection clearing`, () => {
    const h = harness()
    h.edit(tag, scene => { scene.children.unshift({ name: 'Inserted part' }) })
    h.select(['0.0'])
    h.navigate('undo')
    assertSelection(h, [])
    h.select(['0.0'])
    h.navigate('redo')
    assertSelection(h, [])
    assert.equal(h.reloads, 0)
  })
}

for (const tag of ['group', 'ungroup', 'smart-group', 'node-prompt', 'prompt', 'library-load']) {
  test(`${tag} replacements clear selection on both history directions`, () => {
    const h = harness()
    const next = { name: 'Replacement', operation: 'union', children: [{ name: 'Other part' }] }
    h.generate(tag, next)
    h.select(['0.0'])
    h.navigate('undo')
    assertSelection(h, [])
    h.select(['0.0'])
    h.navigate('redo')
    assertSelection(h, [])
    assert.equal(h.reloads, tag === 'library-load' ? 2 : 0)
  })
}

test('empty Undo/Redo and reset history keep the current selection', () => {
  const h = harness()
  h.select(['0.0', '0.1'])
  h.navigate('undo')
  h.navigate('redo')
  assertSelection(h, ['0.0', '0.1'])
  h.edit('param-change', mutations['param-change'])
  h.navigate('undo')
  h.act(() => h.history.resetHistory())
  assert.equal(h.history.canUndo, false)
  assert.equal(h.history.canRedo, false)
  h.navigate('undo')
  h.navigate('redo')
  assertSelection(h, ['0.0', '0.1'])
  assert.equal(h.reloads, 0)
})
