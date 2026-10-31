import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { imageRevision } from '../src/generation/imageInputs.mjs'

const image = { name: 'reference.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGO4IycCAALoAQ/G7AmPAAAAAElFTkSuQmCC' }
const scene = { name: 'Plane', children: [{ name: 'Wheel', children: [{ name: 'Treads' }] }, { name: 'Wing' }] }
const path = '0.0.0'
const compile = async filename => (await build({ entryPoints: [fileURLToPath(new URL(`../src/components/${filename}.jsx`, import.meta.url))], bundle: true, write: false, format: 'cjs', platform: 'node',
  plugins: [{ name: 'multimodal-composer-harness', setup(builder) {
    builder.onResolve({ filter: /^react$/ }, () => ({ path: 'react', external: true }))
    for (const [filter, mock] of [[/useGenerationRun\.jsx$/, 'generation'], [/useGenerationService\.jsx$/, 'service'], [/usePromptImages\.jsx$/, 'attachments'], [/PromptImageAttachments\.jsx$/, 'preview'], [/PromptControls\.jsx$/, 'controls'], [/GenerationProgressPopover\.jsx$/, 'progress']]) builder.onResolve({ filter }, () => ({ path: `mock-${mock}`, external: true }))
    builder.onResolve({ filter: /\.css$/ }, () => ({ path: 'empty-css', namespace: 'harness' }))
    builder.onLoad({ filter: /.*/, namespace: 'harness' }, () => ({ contents: '', loader: 'js' }))
  } }], })).outputFiles[0].text
const compiled = { global: await compile('PromptPanel'), node: await compile('NodePromptModal') }
const flatten = value => !value ? [] : Array.isArray(value) ? value.flatMap(flatten) : typeof value === 'object' ? [value, ...flatten(value.props?.children)] : []
const text = value => !value ? '' : Array.isArray(value) ? value.map(text).join(' ') : typeof value === 'object' ? text(value.props?.children) : String(value)

function harness(kind = 'global') {
  const slots = [], effects = [], requests = [], scopes = []
  let index = 0, dirty = true, tree, generationProps, imageOptions
  const props = kind === 'node' ? { open: true, path, node: scene.children[0].children[0], scene, onScopeChange: value => scopes.push(value) } : { currentScene: scene }
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]))
  const react = {
    createElement(type, input, ...children) { const p = { ...input, children: children.length === 1 ? children[0] : children }; if (typeof type === 'function') return type(p)
      if (type === 'textarea' && p.ref) p.ref.current = { focus() {}, scrollIntoView() {} }
      return { type, props: p }
    },
    useState(initial) { const n = index++; slots[n] ??= { value: typeof initial === 'function' ? initial() : initial }; return [slots[n].value, update => { const value = typeof update === 'function' ? update(slots[n].value) : update; if (!Object.is(value, slots[n].value)) { slots[n].value = value; dirty = true } }] },
    useRef(initial) { const n = index++; slots[n] ??= { current: initial }; return slots[n] },
    useEffect(fn, deps) { const n = index++; if (!same(slots[n]?.deps, deps)) { const old = slots[n]; slots[n] = { deps }; effects.push(() => { old?.cleanup?.(); slots[n].cleanup = fn() }) } },
  }
  const attachments = { images: [], revision: '', loading: false, composerProps: { onPaste() {}, onDrop() {} },
    clear() { if (attachments.images.length || attachments.loading) { attachments.images = []; attachments.revision = ''; attachments.loading = false; dirty = true } },
    clearIfCurrent(current) { if (imageRevision(current) === attachments.revision) attachments.clear() },
  }
  const generation = { busy: false, error: '', errorCode: '', progress: null, clarification: null, canResume: false,
    reset() { if (generation.clarification || generation.error) dirty = true; generation.clarification = null; generation.error = ''; generation.errorCode = '' },
    cancel() { generation.busy = false; dirty = true }, setError(value) { generation.error = value; dirty = true },
    run(input, options) { requests.push({ input, options, hookPath: generationProps.path }); generation.busy = true; generation.clarification = null; dirty = true },
  }
  const controls = { ModelModeSelect: p => react.createElement('model-select', p), GenerationStrategySelect: p => react.createElement('strategy-select', p),
    GenerateButton: p => react.createElement('button', p, 'Generate'), GenerationProgress: p => react.createElement('generation-progress', p),
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', compiled[kind])(name => {
    if (name === 'react') return react
    if (name === 'mock-generation') return { __esModule: true, default: value => { generationProps = value; return { ...generation, clarificationIsCurrent: !generation.busy && generation.clarification?.path === value.path && generation.clarification?.revision === JSON.stringify(value.scene) && (!generation.clarification?.imageRevision || generation.clarification.imageRevision === value.imageRevision) } } }
    if (name === 'mock-service') return { __esModule: true, default: () => ({ ready: true, localKeyAvailable: true }) }
    if (name === 'mock-attachments') return { __esModule: true, default: options => { imageOptions = options; return attachments } }
    if (name === 'mock-preview') return { __esModule: true, default: p => react.createElement('attachment-preview', p) }
    if (name === 'mock-progress') return { __esModule: true, default: p => react.createElement('generation-progress', p) }
    if (name === 'mock-controls') return controls
    throw new Error(`Unexpected import ${name}`)
  }, module, module.exports)
  const Component = module.exports.default
  globalThis.localStorage = { getItem() { return null } }
  globalThis.document = { addEventListener() {}, removeEventListener() {} }
  const h = { props, requests, scopes, generation, attachments,
    flush() { let loops = 0; while (dirty) { assert.ok(++loops < 30, 'Composer updates should settle'); dirty = false; index = 0; tree = Component(props); while (effects.length) effects.shift()() }; return tree },
    act(fn) { fn(); return h.flush() }, update(value) { Object.assign(props, value); dirty = true; return h.flush() },
    attach(value = [image]) { attachments.images = value; attachments.revision = imageRevision(value); dirty = true; return h.flush() },
    loading(value) { attachments.loading = value; dirty = true; return h.flush() },
    finish() { generation.busy = false; generationProps.onComplete?.({}, requests.at(-1).input); dirty = true; return h.flush() },
    pause() { generation.busy = false; generation.canResume = true; generation.error = 'Controlled interruption'; dirty = true; return h.flush() },
    clarify() { generation.busy = false; generation.errorCode = 'CLARIFICATION'; generation.clarification = {
      path, revision: JSON.stringify(props.scene), imageRevision: attachments.revision, prompt: 'What is this reference?', message: 'These are tread blocks. Repair here or at the wheel.',
      suggestions: [{ label: 'Repair the wheel', instruction: 'Repair the wheel using the reference.', path: '0.0' }], conversation: [{ role: 'user', content: 'What is this reference?' }, { role: 'assistant', content: 'These are tread blocks.' }],
    }; dirty = true; return h.flush() },
    all() { return flatten(tree) }, textarea() { return h.all().find(item => item.type === 'textarea') },
    button(label) { const match = h.all().find(item => item.type === 'button' && text(item).includes(label)); assert.ok(match, `Missing ${label}`); return match },
    select(type, value) { h.act(() => { const select = h.all().find(item => item.type === type); assert.ok(select); select.props.onChange({ target: { value } }) }) },
    type(value) { return h.act(() => h.textarea().props.onChange({ target: { value } })) },
    get hookProps() { return generationProps }, get imageOptions() { return imageOptions }, unmount() { for (const slot of slots) slot?.cleanup?.() },
  }
  h.flush(); return h
}

test('global composer defaults to a new scene and only edits the current scene after explicit opt-in', () => {
  for (const useCurrent of [true, false]) {
    const h = harness()
    assert.equal(h.all().find(item => item.type === 'input' && item.props.type === 'checkbox').props.checked, false)
    h.attach(); h.type('Build the visual reference.')
    h.select('model-select', 'max')
    assert.equal(h.all().find(item => item.type === 'strategy-select').props.value, 'staged')
    if (useCurrent) h.act(() => h.all().find(item => item.type === 'input' && item.props.type === 'checkbox').props.onChange({ target: { checked: true } }))
    const all = h.all()
    assert.ok(all.findIndex(item => item.type === 'attachment-preview') < all.findIndex(item => item.type === 'textarea'))
    h.act(() => h.button('Generate').props.onClick())
    assert.equal(h.requests[0].input.mode, useCurrent ? 'edit' : 'create')
    assert.deepEqual(h.requests[0].input.scene, useCurrent ? scene : null)
    assert.equal(h.requests[0].input.strategy, 'staged')
    assert.deepEqual(h.requests[0].input.images, [image])
    assert.equal(h.imageOptions.isDisabled(), true)
    h.finish()
    assert.equal(h.attachments.images.length, 0)
    assert.equal(h.textarea().props.value, '')
    h.unmount()
  }
})

test('global resume sends retained image attachments; loading and disabled prevent click and keyboard requests', () => {
  const h = harness()
  h.attach(); h.type('Match the reference.'); h.select('model-select', 'max')
  h.loading(true)
  h.act(() => { h.button('Generate').props.onClick(); h.textarea().props.onKeyDown({ ctrlKey: true, key: 'Enter', preventDefault() {} }) })
  assert.equal(h.requests.length, 0)
  h.loading(false); h.update({ disabled: true })
  h.act(() => h.button('Generate').props.onClick()); assert.equal(h.requests.length, 0)
  h.update({ disabled: false }); h.act(() => h.button('Generate').props.onClick()); h.pause()
  const progress = h.all().find(item => item.type === 'generation-progress')
  assert.equal(progress.props.canResume, true)
  h.act(() => progress.props.onResume())
  assert.equal(h.requests[1].options.resume, true)
  assert.deepEqual(h.requests[1].input.images, [image])
  h.unmount()
})

test('node generation and continuation forward images and bind generation identity to attachment content', () => {
  const h = harness('node')
  const noImageIdentity = h.hookProps.identity
  h.attach(); h.type('Use this reference for the selected part.'); h.select('model-select', 'max')
  assert.notEqual(h.hookProps.identity, noImageIdentity)
  assert.equal(h.hookProps.imageRevision, imageRevision([image]))
  h.act(() => h.button('Generate').props.onClick())
  assert.equal(h.requests[0].input.mode, 'node'); assert.equal(h.requests[0].input.path, path)
  assert.equal(h.requests[0].input.strategy, 'staged'); assert.deepEqual(h.requests[0].input.images, [image])
  h.pause()
  h.act(() => h.all().find(item => item.type === 'generation-progress').props.onResume())
  assert.equal(h.requests[1].options.resume, true); assert.deepEqual(h.requests[1].input.images, [image])
  h.unmount()
})

test('one-click ancestor suggestions and custom follow-up answers keep original image context', () => {
  for (const custom of [false, true]) {
    const h = harness('node')
    h.attach(); h.type('What is this reference?'); h.act(() => h.button('Generate').props.onClick()); h.clarify()
    if (custom) { h.act(() => h.button('Custom answer').props.onClick()); h.type('Keep six blocks and match the reference.'); h.act(() => h.button('Continue').props.onClick()) }
    else h.act(() => h.button('Repair the wheel').props.onClick())
    assert.equal(h.requests.length, 2)
    assert.deepEqual(h.requests[1].input.images, [image])
    assert.equal(h.requests[1].input.conversation.length, 2)
    assert.equal(h.requests[1].input.path, custom ? path : '0.0')
    assert.equal(h.requests[1].hookPath, custom ? path : '0.0')
    h.unmount()
  }
})

test('node loading and disabled states block submission, and switching/reopening modal clears previous reference attachments', () => {
  const h = harness('node')
  h.attach(); h.type('Use the reference.'); h.loading(true)
  h.act(() => h.button('Generate').props.onClick()); assert.equal(h.requests.length, 0)
  h.loading(false); h.update({ disabled: true })
  h.act(() => h.button('Generate').props.onClick()); assert.equal(h.requests.length, 0)
  h.update({ disabled: false, path: '0.1', node: scene.children[1] })
  assert.deepEqual(h.attachments.images, [])
  h.attach(); h.update({ open: false }); assert.deepEqual(h.attachments.images, [])
  h.update({ open: true }); assert.deepEqual(h.attachments.images, [])
  h.unmount()
})

test('a changed reference or newly blocked scene prevents a pending suggestion from starting', () => {
  for (const change of ['image', 'disabled']) {
    const h = harness('node')
    h.attach(); h.type('What is this reference?'); h.act(() => h.button('Generate').props.onClick()); h.clarify()
    h.act(() => {
      h.button('Repair the wheel').props.onClick()
      if (change === 'image') { h.attachments.images = []; h.attachments.revision = '' }
      else h.props.disabled = true
    })
    assert.equal(h.requests.length, 1, 'only the original question was submitted')
    assert.match(h.generation.error, /reference images changed.*another task is running/)
    h.unmount()
  }
})
