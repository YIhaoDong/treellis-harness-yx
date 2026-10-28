import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const compiled = await build({
  entryPoints: [fileURLToPath(new URL('../src/hooks/useNodePrompt.jsx', import.meta.url))],
  bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react'],
})

const initialScene = {
  name: 'Aircraft',
  children: [
    { name: 'Landing gear', children: [
      { name: 'Wheel', children: [{ name: 'Tread blocks' }, { name: 'Hub' }] },
      { name: 'Strut' },
    ] },
    { name: 'Wing' },
  ],
}

function harness() {
  const slots = [], applied = [], focused = []
  let index = 0, dirty = true, value, liveScene = structuredClone(initialScene)
  const same = (a, b) => !!a && a.length === b.length && a.every((item, i) => Object.is(item, b[i]))
  const hooks = {
    useState(initial) {
      const i = index++
      if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial }
      return [slots[i].value, update => {
        const next = typeof update === 'function' ? update(slots[i].value) : update
        if (!Object.is(next, slots[i].value)) { slots[i].value = next; dirty = true }
      }]
    },
    useRef(initial) { const i = index++; if (!slots[i]) slots[i] = { current: initial }; return slots[i] },
    useCallback(callback, deps) {
      const i = index++
      if (!same(slots[i]?.deps, deps)) slots[i] = { value: callback, deps }
      return slots[i].value
    },
    useMemo(factory, deps) {
      const i = index++
      if (!same(slots[i]?.deps, deps)) slots[i] = { value: factory(), deps }
      return slots[i].value
    },
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(name => {
    assert.equal(name, 'react'); return hooks
  }, module, module.exports)
  const useNodePrompt = module.exports.default
  const applyUpdatedNodeAtPath = (path, node, meta) => applied.push({ path, node, meta })
  const onScopeChange = path => focused.push(path)
  const flush = () => {
    let turns = 0
    while (dirty) {
      assert.ok(++turns < 20, 'Node prompt updates must settle')
      dirty = false; index = 0
      value = useNodePrompt({ liveScene, applyUpdatedNodeAtPath, onScopeChange })
    }
    return value
  }
  flush()
  return {
    get value() { return value }, applied, focused,
    act(callback) { callback(value); return flush() },
    scene(next) { liveScene = next; dirty = true; return flush() },
  }
}

test('node follow-up can apply a current-node edit without changing its modal identity', () => {
  const h = harness()
  h.act(value => value.openNodePrompt('0.0.0.0'))
  const edited = { name: 'Reduced tread blocks' }, meta = { followup: true }
  h.act(value => value.nodePromptModalProps.onApply(edited, meta))
  assert.deepEqual(h.applied, [{ path: '0.0.0.0', node: edited, meta }])
  assert.equal(h.value.nodePromptModalProps.path, '0.0.0.0')
  assert.equal(h.value.nodePrompt.open, true)
})

test('parent and root follow-ups replace their explicit scope and preserve the original modal path', () => {
  const h = harness()
  h.act(value => value.openNodePrompt('0.0.0.0'))
  const parent = { name: 'Smooth wheel' }, root = { name: 'Updated aircraft' }
  h.act(value => value.nodePromptModalProps.onApply(parent, { step: 1 }, '0.0.0'))
  h.act(value => value.nodePromptModalProps.onApply(root, { step: 2 }, '0'))
  assert.deepEqual(h.applied.map(entry => entry.path), ['0.0.0', '0'])
  assert.equal(h.applied[0].node, parent)
  assert.equal(h.applied[1].node, root)
  assert.equal(h.value.nodePromptModalProps.path, '0.0.0.0')
  h.value.nodePromptModalProps.onScopeChange('0.0.0')
  assert.deepEqual(h.focused, ['0.0.0'])
})

test('explicit same-scope retries and a second ancestor adoption never route back to the original leaf', () => {
  const h = harness()
  h.act(value => value.openNodePrompt('0.0.0.0'))
  for (const [scope, name] of [['0.0.0', 'Wheel'], ['0.0.0', 'Retried wheel'], ['0.0', 'Landing gear']]) {
    h.act(value => value.nodePromptModalProps.onApply({ name }, {}, scope))
  }
  assert.deepEqual(h.applied.map(entry => entry.path), ['0.0.0', '0.0.0', '0.0'])
})

test('node follow-ups reject siblings, descendants, other branches and malformed paths', () => {
  const h = harness()
  h.act(value => value.openNodePrompt('0.0.0'))
  for (const path of ['0.0.1', '0.1', '0.0.0.0', '0.00', '0.0x', '0.-1', '1', '', null]) {
    h.act(value => value.nodePromptModalProps.onApply({ name: 'Wrong target' }, {}, path))
  }
  assert.equal(h.applied.length, 0)
})

test('node follow-ups reject an explicit scope removed from the latest scene', () => {
  const h = harness()
  h.act(value => value.openNodePrompt('0.0.0.0'))
  h.scene({ name: 'Empty scene', children: [] })
  h.act(value => value.nodePromptModalProps.onApply({ name: 'Late wheel' }, {}, '0.0.0'))
  assert.equal(h.applied.length, 0)
})

test('closing a modal prevents its captured asynchronous callback from applying a late follow-up', () => {
  const h = harness()
  h.act(value => value.openNodePrompt('0.0.0.0'))
  const capturedApply = h.value.nodePromptModalProps.onApply
  h.act(value => value.closeNodePrompt())
  capturedApply({ name: 'Late wheel' }, {}, '0.0.0')
  assert.equal(h.applied.length, 0)
  assert.equal(h.value.nodePrompt.open, false)
})

test('reopening the same node creates a new session and rejects the previous session callback', () => {
  const h = harness()
  h.act(value => value.openNodePrompt('0.0.0.0'))
  const capturedApply = h.value.nodePromptModalProps.onApply
  h.act(value => value.closeNodePrompt())
  h.act(value => value.openNodePrompt('0.0.0.0'))
  capturedApply({ name: 'Previous session wheel' }, {}, '0.0.0')
  assert.equal(h.applied.length, 0)
  h.act(value => value.nodePromptModalProps.onApply({ name: 'Current wheel' }, {}, '0.0.0'))
  assert.equal(h.applied.length, 1)
})

// Render the actual modal and both real hooks. Only the network and visual-only
// controls are substituted; button callbacks and React commit ordering stay real.
const modalCompiled = await build({
  stdin: {
    contents: `export { default as NodePromptModal } from './src/components/NodePromptModal.jsx';
      export { default as useNodePrompt } from './src/hooks/useNodePrompt.jsx';
      export { replaceNodeAtPath } from './src/utils/tree.jsx';`,
    resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'jsx',
  },
  bundle: true, write: false, format: 'cjs', platform: 'node',
  external: ['react', '__followup_test_request__'],
  plugins: [{ name: 'modal-boundaries', setup(build) {
    build.onResolve({ filter: /useGenerationService\.jsx$/ }, () => ({ path: 'service', namespace: 'followup-test' }))
    build.onResolve({ filter: /PromptControls\.jsx$/ }, () => ({ path: 'controls', namespace: 'followup-test' }))
    build.onResolve({ filter: /generation\/client\.mjs$/ }, () => ({ path: 'client', namespace: 'followup-test' }))
    build.onLoad({ filter: /.*/, namespace: 'followup-test' }, ({ path }) => ({
      contents: path === 'service'
        ? 'export default function useGenerationService(){ return { ready:true, localKeyAvailable:true }; }'
        : path === 'client'
          ? "export { request as requestGeneration } from '__followup_test_request__';"
          : 'export function GenerateButton(){}; export function GenerationProgress(){}; export function GenerationStrategySelect(){}; export function ModelModeSelect(){};',
    }))
    build.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'js' }))
  } }],
})

function modalHarness() {
  const slots = [], pending = { layout: [], passive: [] }, requests = [], applied = [], focused = []
  let index = 0, dirty = true, hook, tree, scene = structuredClone(initialScene)
  const same = (a, b) => !!a && a.length === b.length && a.every((item, i) => Object.is(item, b[i]))
  const hooks = {
    createElement(type, props, ...children) { return { type, props: { ...props, children: children.flat(Infinity) } } },
    useState(initial) {
      const i = index++
      if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial }
      return [slots[i].value, update => {
        const next = typeof update === 'function' ? update(slots[i].value) : update
        if (!Object.is(next, slots[i].value)) { slots[i].value = next; dirty = true }
      }]
    },
    useRef(initial) { const i = index++; if (!slots[i]) slots[i] = { current: initial }; return slots[i] },
    useCallback(callback, deps) {
      const i = index++
      if (!same(slots[i]?.deps, deps)) slots[i] = { value: callback, deps }
      return slots[i].value
    },
    useMemo(factory, deps) {
      const i = index++
      if (!same(slots[i]?.deps, deps)) slots[i] = { value: factory(), deps }
      return slots[i].value
    },
    useEffect(fn, deps) { effect('passive', fn, deps) },
    useLayoutEffect(fn, deps) { effect('layout', fn, deps) },
  }
  function effect(kind, fn, deps) {
    const i = index++, old = slots[i]
    if (!same(old?.deps, deps)) {
      slots[i] = { deps, cleanup: old?.cleanup }
      pending[kind].push(() => { slots[i].cleanup?.(); slots[i].cleanup = fn() })
    }
  }
  const request = (input, options) => {
    let resolve, reject
    const promise = new Promise((yes, no) => { resolve = yes; reject = no })
    requests.push({ input, ...options, resolve, reject })
    return promise
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', modalCompiled.outputFiles[0].text)(name => {
    if (name === 'react') return hooks
    assert.equal(name, '__followup_test_request__'); return { request }
  }, module, module.exports)
  const { useNodePrompt, NodePromptModal, replaceNodeAtPath } = module.exports
  const applyUpdatedNodeAtPath = (path, node, meta) => {
    applied.push({ path, node, meta })
    scene = replaceNodeAtPath(scene, path, node)
    dirty = true
  }
  const onScopeChange = path => focused.push(path)
  const oldDocument = globalThis.document
  globalThis.document = { addEventListener() {}, removeEventListener() {} }
  const flush = () => {
    let loops = 0
    while (dirty) {
      assert.ok(++loops < 30, 'Modal updates must settle')
      dirty = false; index = 0
      hook = useNodePrompt({ liveScene: scene, applyUpdatedNodeAtPath, onScopeChange })
      tree = NodePromptModal(hook.nodePromptModalProps)
      for (const kind of ['layout', 'passive']) while (pending[kind].length) pending[kind].shift()()
    }
  }
  const nodes = () => {
    const result = []
    const visit = node => {
      if (!node || typeof node !== 'object') return
      result.push(node)
      for (const child of node.props?.children || []) visit(child)
    }
    visit(tree)
    return result
  }
  const find = predicate => {
    const found = nodes().find(predicate)
    assert.ok(found, 'Expected modal control exists')
    return found
  }
  flush()
  return {
    requests, applied, focused,
    get hook() { return hook },
    open(path = '0.0.0.0') { hook.openNodePrompt(path); flush() },
    close() { hook.closeNodePrompt(); flush() },
    input(text) {
      find(node => node.type === 'textarea').props.onChange({ target: { value: text } }); flush()
    },
    submit() {
      const button = find(node => node.type?.name === 'GenerateButton' || (node.type === 'button' && node.props.className === 'prompt-generate'))
      assert.equal(button.props.disabled, false)
      button.props.onClick(); flush()
    },
    choose(label, { deferCommit = false } = {}) {
      const button = find(node => node.type === 'button' && node.props.className === 'node-reply__suggestion' &&
        node.props.children[0].props.children.includes(label))
      assert.equal(button.props.disabled, false)
      button.props.onClick()
      if (!deferCommit) flush()
    },
    async clarify(suggestions, message = 'Please choose how to proceed.') {
      const failure = Object.assign(new Error(message), { code: 'CLARIFICATION', suggestions })
      requests.at(-1).reject(failure)
      await Promise.resolve(); flush()
    },
    async finish(result) { requests.at(-1).resolve({ result, meta: { adopted: true } }); await Promise.resolve(); flush() },
    editScene(next) { scene = next; dirty = true; flush() },
    disabledSuggestions() { return nodes().filter(node => node.props?.className === 'node-reply__suggestion').every(node => node.props.disabled) },
    suggestionLabels() { return nodes().filter(node => node.props?.className === 'node-reply__suggestion').map(node => node.props.children[0].props.children[0]) },
    cleanup() {
      for (const slot of slots) slot?.cleanup?.()
      globalThis.document = oldDocument
    },
  }
}

test('real modal routes parent adoption, same-scope retry and a second ancestor adoption before applying the root once', async () => {
  const h = modalHarness()
  try {
    h.open()
    h.input('What are these blocks?')
    h.submit()
    await h.clarify([{ label: 'Edit wheel', instruction: 'Remove its tread blocks', path: '0.0.0' }])
    h.choose('Edit wheel')
    assert.equal(h.requests[1].input.path, '0.0.0')
    assert.equal(h.requests[1].input.node.name, 'Wheel')
    await h.clarify([{ label: 'Retry wheel', instruction: 'Use a smoother tyre instead', path: '0.0.0' }])
    h.choose('Retry wheel')
    assert.equal(h.requests[2].input.path, '0.0.0')
    await h.clarify([{ label: 'Edit whole aircraft', instruction: 'Keep only the required parts', path: '0' }])
    h.choose('Edit whole aircraft')
    assert.equal(h.requests[3].input.path, '0')
    assert.equal(h.requests[3].input.node.name, 'Aircraft')
    assert.deepEqual(h.focused, ['0.0.0', '0.0.0', '0'])
    const result = { name: 'Clean aircraft' }
    await h.finish(result)
    assert.deepEqual(h.applied.map(entry => entry.path), ['0'])
    assert.deepEqual(h.applied[0].node, result)
    assert.equal(h.hook.nodePrompt.open, false)
  } finally { h.cleanup() }
})

test('real modal sends a custom reply with previous dialog and blocks options after an intervening scene edit', async () => {
  const h = modalHarness()
  try {
    h.open()
    h.input('Why are these blocks here?')
    h.submit()
    await h.clarify([{ label: 'Remove blocks', instruction: 'Remove all tread blocks', path: '0.0.0.0' }], 'These are tread blocks. Remove or reduce them?')
    h.input('Keep only six blocks.')
    h.submit()
    assert.equal(h.requests[1].input.prompt, 'Keep only six blocks.')
    assert.deepEqual(h.requests[1].input.conversation, [
      { role: 'user', content: 'Why are these blocks here?' },
      { role: 'assistant', content: 'These are tread blocks. Remove or reduce them?' },
    ])
    await h.clarify([{ label: 'Use six', instruction: 'Keep six tread blocks', path: '0.0.0.0' }])
    h.editScene({ ...structuredClone(initialScene), name: 'Manually edited aircraft' })
    assert.equal(h.disabledSuggestions(), true)
    assert.equal(h.requests.length, 2)
    assert.equal(h.applied.length, 0)
  } finally { h.cleanup() }
})

test('after adopting a parent scope the real modal filters suggestions that jump back down or sideways', async () => {
  const h = modalHarness()
  try {
    h.open()
    h.input('Fix the extra tread blocks.')
    h.submit()
    await h.clarify([{ label: 'Edit wheel', instruction: 'Edit the wheel assembly', path: '0.0.0' }])
    h.choose('Edit wheel')
    await h.clarify([
      { label: 'Back to leaf', instruction: 'Edit tread blocks again', path: '0.0.0.0' },
      { label: 'Sideways', instruction: 'Edit the wing', path: '0.1' },
      { label: 'Edit landing gear', instruction: 'Edit the landing gear assembly', path: '0.0' },
    ])
    assert.deepEqual(h.suggestionLabels(), ['Edit landing gear'])
    assert.equal(h.requests.length, 2)
  } finally { h.cleanup() }
})

test('an intervening scene commit cancels a queued suggestion before its request begins', async () => {
  const h = modalHarness()
  try {
    h.open()
    h.input('Fix the wheel.')
    h.submit()
    await h.clarify([{ label: 'Edit wheel', instruction: 'Remove extra blocks', path: '0.0.0' }])
    h.choose('Edit wheel', { deferCommit: true })
    h.editScene({ ...structuredClone(initialScene), name: 'Newer manual changes' })
    assert.equal(h.requests.length, 1)
    assert.equal(h.applied.length, 0)
  } finally { h.cleanup() }
})

test('closing during a queued suggestion cancels it before the request begins', async () => {
  const h = modalHarness()
  try {
    h.open()
    h.input('Fix the wheel.')
    h.submit()
    await h.clarify([{ label: 'Edit wheel', instruction: 'Remove extra blocks', path: '0.0.0' }])
    h.choose('Edit wheel', { deferCommit: true })
    h.close()
    assert.equal(h.requests.length, 1)
    assert.equal(h.applied.length, 0)
    assert.equal(h.hook.nodePrompt.open, false)
  } finally { h.cleanup() }
})
