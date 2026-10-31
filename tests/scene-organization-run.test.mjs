import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { groupSceneNodes } from '../src/utils/sceneGrouping.mjs'

// Exercise the actual orchestration hook and grouping utility. Only React's
// commit scheduler, timers and the network boundary are controlled here.
const compiled = await build({
  entryPoints: [fileURLToPath(new URL('../src/hooks/useSceneOrganization.jsx', import.meta.url))],
  bundle: true, write: false, format: 'cjs', platform: 'node',
  external: ['react', '__organization_request__'],
  plugins: [{ name: 'organization-network-boundary', setup(builder) {
    builder.onResolve({ filter: /generation\/client\.mjs$/ }, () => ({ path: 'client', namespace: 'organization-test' }))
    builder.onLoad({ filter: /.*/, namespace: 'organization-test' }, () => ({
      contents: "export { requestGeneration } from '__organization_request__';", loader: 'js',
    }))
  } }],
})
const part = (name, x) => ({ name, uid: name, primitive: { type: 'sphere', r: 0.3 }, transform: { t: [x, 0, 0], r: [0, 0, 0], s: [1, 1, 1] } })
const fixture = () => ({ name: 'Propeller', operation: 'union', children: [part('Blade A', -1), part('Spinner', 0), part('Blade B', 1)] })
const abortError = () => new DOMException('Stopped', 'AbortError')

function harness({ scene = fixture(), selectedPaths = ['0.0', '0.2'], blocked = false, ignoreAbort = false } = {}) {
  const slots = [], layouts = [], effects = [], history = [], applied = [], selections = [], remaps = [], requests = []
  const timers = new Map()
  let hookIndex = 0, timerId = 0, dirty = true, value
  const props = {
    scene, selectedPaths, blocked,
    recordGeneration(next, tag, meta) { history.push({ scene: next, tag, meta }) },
    enterDraftFromRoot(next) { applied.push(next); props.scene = next; dirty = true },
    selectPaths(paths, options) { selections.push({ paths, options }); props.selectedPaths = paths; dirty = true },
    remapSelection(pathMap, options) { remaps.push({ pathMap, options }) },
  }
  const same = (a, b) => !!a && a.length === b.length && a.every((item, i) => Object.is(item, b[i]))
  const effectHook = queue => (effect, deps) => {
    const i = hookIndex++
    if (same(slots[i]?.deps, deps)) return
    const previous = slots[i]
    const slot = { deps }; slots[i] = slot
    queue.push(() => { previous?.cleanup?.(); slot.cleanup = effect() })
  }
  const hooks = {
    useState(initial) {
      const i = hookIndex++
      slots[i] ??= { value: typeof initial === 'function' ? initial() : initial }
      return [slots[i].value, update => {
        const next = typeof update === 'function' ? update(slots[i].value) : update
        if (!Object.is(next, slots[i].value)) { slots[i].value = next; dirty = true }
      }]
    },
    useRef(initial) { const i = hookIndex++; slots[i] ??= { current: initial }; return slots[i] },
    useMemo(factory, deps) {
      const i = hookIndex++
      if (!same(slots[i]?.deps, deps)) slots[i] = { value: factory(), deps }
      return slots[i].value
    },
    useEffect: effectHook(effects), useLayoutEffect: effectHook(layouts),
  }
  const requestGeneration = (input, options) => new Promise((resolve, reject) => {
    const pending = { input, options, resolve, reject }
    requests.push(pending)
    if (!ignoreAbort) options.signal.addEventListener('abort', () => reject(abortError()), { once: true })
  })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', 'setInterval', 'clearInterval', compiled.outputFiles[0].text)(name => {
    if (name === 'react') return hooks
    if (name === '__organization_request__') return { requestGeneration }
    throw new Error(`Unexpected dependency ${name}`)
  }, module, module.exports, callback => { const id = ++timerId; timers.set(id, callback); return id }, id => timers.delete(id))
  const useSceneOrganization = module.exports.default
  const flush = () => {
    let turns = 0
    while (dirty) {
      assert.ok(++turns < 25, 'Organization state updates must settle')
      dirty = false; hookIndex = 0; value = useSceneOrganization(props)
      while (layouts.length) layouts.shift()()
      while (effects.length) effects.shift()()
    }
    return value
  }
  flush()
  return {
    get value() { return value }, get scene() { return props.scene },
    history, applied, selections, remaps, requests, timers,
    act(callback) { const result = callback(value); flush(); return result },
    update(update) { Object.assign(props, update); dirty = true; return flush() },
    async settle(promise) { await promise; flush(); return value },
    dispose() { for (const slot of slots) slot?.cleanup?.() },
  }
}

test('manual grouping is one history action, selects the wrapper, and never calls the network', () => {
  const input = fixture(), original = structuredClone(input), h = harness({ scene: input })
  assert.equal(h.value.canGroup, true)
  assert.equal(h.act(v => v.group('Blades')), true)
  assert.equal(h.history.length, 1)
  assert.equal(h.history[0].tag, 'group')
  assert.equal(h.applied.length, 1)
  assert.deepEqual(h.scene.children.map(node => node.name), ['Blades', 'Spinner'])
  assert.deepEqual(h.scene.children[0].children.map(node => node.name), ['Blade A', 'Blade B'])
  assert.equal(h.history[0].scene, h.scene)
  assert.deepEqual(h.selections, [{ paths: ['0.0'], options: { scene: h.scene } }])
  assert.deepEqual(h.value.pathRemap, { '0': '0', '0.0': '0.0.0', '0.2': '0.0.1', '0.1': '0.1' })
  assert.equal(h.remaps.length, 0)
  assert.equal(h.requests.length, 0)
  assert.deepEqual(input, original)
  assert.equal(h.value.canUngroup, true)
  h.dispose()
})

test('manual ungrouping adds one history action and selects the preserved children', () => {
  const grouped = groupSceneNodes(fixture(), ['0.0', '0.2'], 'Blades')
  const h = harness({ scene: grouped.scene, selectedPaths: ['0.0'] })
  h.act(v => v.ungroup())
  assert.equal(h.history.length, 1)
  assert.equal(h.history[0].tag, 'ungroup')
  assert.deepEqual(h.scene.children.map(node => node.name), ['Blade A', 'Blade B', 'Spinner'])
  assert.deepEqual(h.selections[0].paths, ['0.0', '0.1'])
  assert.equal(h.applied.length, 1)
  assert.equal(h.requests.length, 0)
  h.dispose()
})

test('a generation-blocked hook disables controls and cannot group or start Smart group', async () => {
  const h = harness({ blocked: true }), input = h.scene
  assert.equal(h.value.canGroup, false)
  assert.equal(h.value.canUngroup, false)
  assert.equal(h.act(v => v.group('Blades')), false)
  h.act(v => v.ungroup())
  await h.settle(h.act(v => v.organize()))
  assert.equal(h.requests.length, 0)
  assert.equal(h.history.length, 0)
  assert.equal(h.scene, input)
  h.update({ blocked: false })
  assert.equal(h.value.canGroup, true)
  h.dispose()
})

test('Smart group applies one result and remaps the existing selection against the new scene', async () => {
  const input = fixture(), h = harness({ scene: input })
  const pending = h.act(v => v.organize({ scope: '0', effort: 'max', prompt: 'Group the propeller blades' }))
  assert.equal(h.value.busy, true)
  assert.equal(h.value.canGroup, false)
  assert.equal(h.timers.size, 1)
  assert.deepEqual(h.requests[0].input, { mode: 'organize', scene: input, scope: '0', effort: 'max', prompt: 'Group the propeller blades' })
  assert.equal(h.requests[0].options.signal.aborted, false)
  h.act(() => h.requests[0].options.onProgress({ message: 'Organizing the blades' }))
  assert.match(h.value.status, /Organizing the blades/)
  assert.match(h.value.status, /00:00/)
  const reply = { ...groupSceneNodes(input, ['0.0', '0.2'], 'Blades'), meta: { model: 'test-model', usage: { input: 42 } }, message: 'Blades organized.' }
  h.requests[0].resolve(reply)
  await h.settle(pending)
  assert.equal(h.history.length, 1)
  assert.deepEqual(h.history[0], { scene: reply.scene, tag: 'smart-group', meta: { ...reply.meta, groups: reply.groups } })
  assert.deepEqual(h.applied, [reply.scene])
  assert.deepEqual(h.remaps, [{ pathMap: reply.pathMap, options: { scene: reply.scene } }])
  assert.deepEqual(h.selections, [], 'Smart group preserves and remaps the user selection instead of selecting every new group')
  assert.equal(h.value.pathRemap, reply.pathMap)
  assert.equal(h.value.busy, false)
  assert.equal(h.value.error, '')
  assert.equal(h.value.status, 'Blades organized.')
  assert.equal(h.timers.size, 0)
  h.dispose()
})

test('an active Smart group request prevents duplicate requests and manual mutations', async () => {
  const h = harness(), input = h.scene
  const pending = h.act(v => v.organize())
  await h.settle(h.act(v => v.organize()))
  assert.equal(h.requests.length, 1)
  assert.equal(h.value.busy, true)
  assert.equal(h.act(v => v.group('Blades')), false)
  h.act(v => v.ungroup())
  assert.equal(h.scene, input)
  h.requests[0].resolve({ changed: false, message: 'Already organized.' })
  await h.settle(pending)
  h.dispose()
})

test('a Smart group no-op preserves the scene and creates no history or selection action', async () => {
  const h = harness(), input = h.scene
  const pending = h.act(v => v.organize())
  h.requests[0].resolve({ changed: false, scene: structuredClone(input), pathMap: { '0': '0' }, groups: [], message: 'No additional groups needed.' })
  await h.settle(pending)
  assert.equal(h.scene, input)
  assert.deepEqual(h.history, [])
  assert.deepEqual(h.applied, [])
  assert.deepEqual(h.selections, [])
  assert.deepEqual(h.remaps, [])
  assert.equal(h.value.pathRemap, null)
  assert.equal(h.value.busy, false)
  assert.equal(h.value.status, 'No additional groups needed.')
  h.dispose()
})

test('Stop aborts Smart group and keeps the scene and history intact', async () => {
  const h = harness(), input = h.scene
  const pending = h.act(v => v.organize())
  h.act(v => v.cancel())
  assert.equal(h.requests[0].options.signal.aborted, true)
  await h.settle(pending)
  assert.equal(h.value.busy, false)
  assert.equal(h.value.error, '')
  assert.match(h.value.status, /stopped.*Scene kept/i)
  assert.equal(h.scene, input)
  assert.deepEqual(h.history, [])
  assert.deepEqual(h.remaps, [])
  assert.equal(h.timers.size, 0)
  h.dispose()
})

test('editing the scene during Smart group aborts its stale revision and preserves the latest edit', async () => {
  const h = harness(), input = h.scene
  const pending = h.act(v => v.organize())
  const latest = structuredClone(input); latest.children[0].transform.t[1] = 5
  h.update({ scene: latest })
  assert.equal(h.requests[0].options.signal.aborted, true)
  await h.settle(pending)
  assert.equal(h.scene, latest)
  assert.match(h.value.error, /scene changed.*latest edits were kept/i)
  assert.equal(h.value.busy, false)
  assert.deepEqual(h.history, [])
  assert.deepEqual(h.applied, [])
  h.dispose()
})

test('an aborted transport that still resolves cannot overwrite a scene edited during organization', async () => {
  const h = harness({ ignoreAbort: true }), input = h.scene
  const pending = h.act(v => v.organize())
  const latest = structuredClone(input); latest.children[1].name = 'User-renamed spinner'
  h.update({ scene: latest })
  const reply = groupSceneNodes(input, ['0.0', '0.2'], 'Stale blades')
  h.requests[0].resolve(reply)
  await h.settle(pending)
  assert.equal(h.scene, latest)
  assert.deepEqual(h.history, [])
  assert.deepEqual(h.applied, [])
  assert.deepEqual(h.remaps, [])
  assert.equal(h.value.busy, false)
  h.dispose()
})

test('network failure keeps scene data and allows a subsequent Smart group attempt', async () => {
  const h = harness(), input = h.scene
  const pending = h.act(v => v.organize())
  h.requests[0].reject(new Error('Service unavailable'))
  await h.settle(pending)
  assert.equal(h.value.error, 'Service unavailable')
  assert.equal(h.value.busy, false)
  assert.equal(h.scene, input)
  assert.deepEqual(h.history, [])
  const retry = h.act(v => v.organize())
  assert.equal(h.requests.length, 2)
  assert.equal(h.value.error, '')
  h.requests[1].resolve({ changed: false })
  await h.settle(retry)
  assert.equal(h.scene, input)
  assert.deepEqual(h.history, [])
  h.dispose()
})

test('an invalid manual group name preserves scene and creates no partial history', () => {
  const h = harness(), input = h.scene
  assert.equal(h.act(v => v.group('   ')), false)
  assert.match(h.value.error, /group name/i)
  assert.equal(h.scene, input)
  assert.deepEqual(h.history, [])
  assert.deepEqual(h.applied, [])
  assert.deepEqual(h.selections, [])
  h.dispose()
})

test('unmount aborts an in-flight request and rejects any late result application', async () => {
  const h = harness({ ignoreAbort: true }), input = h.scene
  const pending = h.act(v => v.organize())
  h.dispose()
  assert.equal(h.requests[0].options.signal.aborted, true)
  assert.equal(h.timers.size, 0)
  h.requests[0].resolve(groupSceneNodes(input, ['0.0', '0.2'], 'Late blades'))
  await pending
  assert.equal(h.scene, input)
  assert.deepEqual(h.history, [])
  assert.deepEqual(h.applied, [])
})
