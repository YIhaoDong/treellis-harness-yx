import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { boundedNodeConversation, followupNodeAt, nodeFollowupSuggestions, nodeReplyConversation } from '../src/utils/nodeFollowup.mjs'

const scene = { name: 'Plane', children: [{ name: 'Wheel', children: [{ name: 'Treads' }] }, { name: 'Wing' }] }
const path = '0.0.0'
const question = '这些是什么？'
const message = '这是胎纹。可以去掉胎纹，也可以在轮胎父节点修复。'
const suggestions = [
  { label: '去掉胎纹', instruction: 'Remove the tread blocks.', path },
  { label: '修复整个轮胎', instruction: 'Repair the wheel while preserving other parts.', path: '0.0' },
]

test('node follow-up only exposes explicit actions targeting the selected node or existing ancestors', () => {
  const source = JSON.stringify(scene)
  const result = nodeFollowupSuggestions(scene, path, [...suggestions,
    { label: 'Wrong sibling', instruction: 'Change wing', path: '0.1' },
    { label: 'Missing target', instruction: 'Change missing node', path: '0.0.7' },
    { label: 'Invalid full path', instruction: 'Change root', path: '00' },
  ])
  assert.equal(result.length, 2)
  assert.equal(result[0].name, 'Treads')
  assert.equal(result[0].parentScope, false)
  assert.equal(result[1].name, 'Wheel')
  assert.equal(result[1].parentScope, true)
  assert.equal(followupNodeAt(scene, '0.0.__proto__'), null)
  assert.equal(followupNodeAt(scene, '0.0.0.9'), null)
  assert.equal(JSON.stringify(scene), source)
})

test('conversation keeps actual user/assistant turns within six messages, 4000 each and 12000 total', () => {
  const turns = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `${i}${'x'.repeat(4500)}` }))
  const result = boundedNodeConversation([{ role: 'system', content: 'wrong' }, ...turns, { role: 'assistant', summary: 'not a dialog answer' }])
  assert.ok(result.length <= 6)
  assert.ok(result.every(item => item.content.length <= 4000))
  assert.ok(result.reduce((total, item) => total + item.content.length, 0) <= 12000)
  assert.equal(result.at(-1).content[0], '9')
  assert.ok(result.every(item => ['user', 'assistant'].includes(item.role)))
  const provided = [{ role: 'user', content: question }, { role: 'assistant', content: message }]
  assert.deepEqual(nodeReplyConversation({ prompt: question, message, conversation: provided }), provided)
  assert.deepEqual(nodeReplyConversation({ prompt: question, message }), provided)
})

const compiled = await build({ entryPoints: [fileURLToPath(new URL('../src/components/NodePromptModal.jsx', import.meta.url))],
  bundle: true, write: false, format: 'cjs', platform: 'node', plugins: [{ name: 'modal-harness', setup(builder) {
    builder.onResolve({ filter: /^react$/ }, () => ({ path: 'react', external: true }))
    builder.onResolve({ filter: /useGenerationRun\.jsx$/ }, () => ({ path: 'mock-generation', external: true }))
    builder.onResolve({ filter: /useGenerationService\.jsx$/ }, () => ({ path: 'mock-service', external: true }))
    builder.onResolve({ filter: /PromptControls\.jsx$/ }, () => ({ path: 'mock-controls', external: true }))
    builder.onResolve({ filter: /\.css$/ }, () => ({ path: 'empty-css', namespace: 'harness' }))
    builder.onLoad({ filter: /.*/, namespace: 'harness' }, () => ({ contents: '', loader: 'js' }))
  } }] })

function harness() {
  const slots = [], effects = [], requests = [], scopes = []
  let index = 0, dirty = true, tree, hookProps, focused = 0
  const props = { open: true, path, node: scene.children[0].children[0], scene, onScopeChange: value => scopes.push(value) }
  const generation = { busy: false, error: '', errorCode: '', progress: null, clarification: null, canResume: false,
    cancel() { generation.busy = false; dirty = true },
    reset() { if (generation.clarification || generation.error) dirty = true; generation.clarification = null; generation.error = ''; generation.errorCode = '' },
    setError(value) { generation.error = value; dirty = true },
    run(input) { requests.push({ input, hookPath: hookProps.path }); generation.busy = true; generation.clarification = null; dirty = true },
  }
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]))
  const react = {
    createElement(type, input, ...children) {
      const p = { ...input, children: children.length === 1 ? children[0] : children }
      if (typeof type === 'function') return type(p)
      if (type === 'textarea' && p.ref) p.ref.current = { focus() { focused++ }, scrollIntoView() {} }
      return { type, props: p }
    },
    useState(initial) { const n = index++; slots[n] ??= { value: initial }; return [slots[n].value, update => {
      const value = typeof update === 'function' ? update(slots[n].value) : update
      if (!Object.is(value, slots[n].value)) { slots[n].value = value; dirty = true }
    }] },
    useRef(initial) { const n = index++; slots[n] ??= { current: initial }; return slots[n] },
    useEffect(fn, deps) { const n = index++; if (!same(slots[n]?.deps, deps)) {
      const old = slots[n]; slots[n] = { deps }; effects.push(() => { old?.cleanup?.(); slots[n].cleanup = fn() })
    } },
  }
  const controls = {
    ModelModeSelect: () => null, GenerationStrategySelect: () => null, GenerationProgress: () => null,
    GenerateButton: p => react.createElement('button', p, 'Generate'),
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(name => {
    if (name === 'react') return react
    if (name === 'mock-generation') return { __esModule: true, default: value => {
      hookProps = value
      return { ...generation, clarificationIsCurrent: !generation.busy && generation.clarification?.path === value.path && generation.clarification?.revision === JSON.stringify(value.scene) }
    } }
    if (name === 'mock-service') return { __esModule: true, default: () => ({ ready: true, localKeyAvailable: true }) }
    if (name === 'mock-controls') return controls
    throw new Error(`Unexpected import: ${name}`)
  }, module, module.exports)
  const Modal = module.exports.default
  globalThis.localStorage = { getItem() { return null } }
  globalThis.document = { addEventListener() {}, removeEventListener() {} }
  const flatten = value => !value ? [] : Array.isArray(value) ? value.flatMap(flatten) : typeof value === 'object' ? [value, ...flatten(value.props?.children)] : []
  const text = value => !value ? '' : Array.isArray(value) ? value.map(text).join(' ') : typeof value === 'object' ? text(value.props?.children) : String(value)
  const h = { requests, scopes, props, generation,
    flush() { let loops = 0; while (dirty) { assert.ok(++loops < 30, 'Modal updates should settle'); dirty = false; index = 0; tree = Modal(props); while (effects.length) effects.shift()() }; return tree },
    act(fn) { fn(); return h.flush() },
    update(value) { Object.assign(props, value); dirty = true; return h.flush() },
    clarify(overrides = {}) { generation.busy = false; generation.errorCode = 'CLARIFICATION'; generation.clarification = {
      message, prompt: question, path, revision: JSON.stringify(props.scene), suggestions,
      conversation: [{ role: 'user', content: question }, { role: 'assistant', content: message }], ...overrides,
    }; dirty = true; return h.flush() },
    all() { return flatten(tree) }, text() { return text(tree) },
    button(label) { const button = h.all().find(item => item.type === 'button' && text(item).includes(label)); assert.ok(button, `Missing button ${label}`); return button },
    textarea() { return h.all().find(item => item.type === 'textarea') },
    get focused() { return focused }, get hookProps() { return hookProps },
    unmount() { for (const slot of slots) slot?.cleanup?.() },
  }
  h.flush()
  return h
}

test('formal reply has named executable options plus custom answer; typing is not cleared again by rerenders', () => {
  const h = harness()
  h.clarify()
  assert.match(h.text(), /胎纹/)
  assert.match(h.text(), /Parent scope\s+·\s+Wheel\s+·\s+0\.0/)
  assert.equal(h.textarea().props.value, '')
  const focusBefore = h.focused
  h.act(() => h.button('Custom answer').props.onClick())
  assert.ok(h.focused > focusBefore)
  assert.equal(h.requests.length, 0)
  h.act(() => h.textarea().props.onChange({ target: { value: '保留六个胎纹就好' } }))
  h.update({})
  assert.equal(h.textarea().props.value, '保留六个胎纹就好')
  h.act(() => h.button('Continue').props.onClick())
  assert.equal(h.requests.length, 1)
  assert.equal(h.requests[0].input.prompt, '保留六个胎纹就好')
  assert.deepEqual(h.requests[0].input.conversation, [{ role: 'user', content: question }, { role: 'assistant', content: message }])
  h.unmount()
})

test('accepting a parent suggestion commits the new modal scope before generation and resists double clicks', () => {
  const h = harness()
  h.clarify()
  const action = h.button('修复整个轮胎')
  h.act(() => { action.props.onClick(); action.props.onClick() })
  assert.equal(h.requests.length, 1)
  assert.equal(h.requests[0].hookPath, '0.0')
  assert.equal(h.requests[0].input.path, '0.0')
  assert.equal(h.requests[0].input.node.name, 'Wheel')
  assert.equal(h.requests[0].input.prompt, suggestions[1].instruction)
  assert.deepEqual(h.scopes, ['0.0'])
  assert.equal(h.props.path, path)
  assert.equal(h.textarea().props.value, suggestions[1].instruction)
  h.unmount()
})

test('legacy clarification without options offers custom reply and carries the real question and answer', () => {
  const h = harness()
  h.clarify({ suggestions: [], conversation: undefined })
  assert.match(h.text(), /Reply below to continue/)
  h.act(() => h.button('Custom answer').props.onClick())
  h.act(() => h.textarea().props.onChange({ target: { value: '全部去掉' } }))
  h.act(() => h.button('Continue').props.onClick())
  assert.deepEqual(h.requests[0].input.conversation, [{ role: 'user', content: question }, { role: 'assistant', content: message }])
  h.unmount()
})

test('scene edits disable stale actions and replies; a new question explicitly drops obsolete conversation', () => {
  const h = harness()
  h.clarify()
  h.act(() => h.textarea().props.onChange({ target: { value: '全部去掉' } }))
  h.update({ scene: { ...scene, name: 'Manually updated plane' } })
  assert.equal(h.button('去掉胎纹').props.disabled, true)
  assert.equal(h.button('Continue').props.disabled, true)
  h.act(() => { h.button('去掉胎纹').props.onClick(); h.button('Continue').props.onClick() })
  assert.equal(h.requests.length, 0)
  h.act(() => h.button('Start new question').props.onClick())
  assert.equal(h.textarea().props.value, question)
  h.act(() => h.button('Generate').props.onClick())
  assert.equal(h.requests.length, 1)
  assert.deepEqual(h.requests[0].input.conversation, [])
  h.unmount()
})

test('a scene change between choosing a parent and committing the new scope prevents automatic execution', () => {
  const h = harness()
  h.clarify()
  const action = h.button('修复整个轮胎')
  h.act(() => {
    action.props.onClick()
    h.props.scene = { ...scene, name: 'Changed before scope commit' }
  })
  assert.equal(h.requests.length, 0)
  assert.match(h.text(), /scene, selection or reference images changed/i)
  h.unmount()
})
