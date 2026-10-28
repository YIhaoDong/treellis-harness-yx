import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { normalizeSceneFilename, suggestSceneFilename } from '../src/utils/sceneFilename.mjs'

test('scene filenames support readable Unicode names and add JSON only when needed', () => {
  assert.deepEqual(normalizeSceneFilename('精细飞机 v2'), { filename: '精细飞机 v2.json', error: '' })
  assert.equal(normalizeSceneFilename('Plane.JSON').filename, 'Plane.JSON')
  assert.equal(normalizeSceneFilename('  Plane.json').filename, 'Plane.json')
  assert.equal(normalizeSceneFilename('Plane.v2').filename, 'Plane.v2.json')
})

test('invalid and reserved Windows filenames are rejected before download', () => {
  for (const name of ['', '  ', '.json', '.JSON', '.', '..', 'file.', 'file ', 'a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', '<a>', 'a|b', 'a\nb', 'file\n', '\tfile', 'CON', 'nul.json', 'COM1', 'LPT9.json', 'COM¹', 'CON .json']) {
    const result = normalizeSceneFilename(name)
    assert.ok(result.error, `${JSON.stringify(name)} should be rejected`)
    assert.equal(result.filename, undefined)
  }
  assert.equal(normalizeSceneFilename('console').filename, 'console.json')
  assert.equal(normalizeSceneFilename('COM10').filename, 'COM10.json')
})

test('filename length includes the appended extension', () => {
  assert.equal(normalizeSceneFilename('a'.repeat(250)).filename.length, 255)
  assert.ok(normalizeSceneFilename('a'.repeat(251)).error)
})

test('suggested filenames prefer supplied name then scene title and remain portable', () => {
  const now = new Date('2026-10-21T11:52:55.906Z')
  assert.equal(suggestSceneFilename({ name: 'Detailed Aircraft' }, 'custom.json', now), 'custom.json')
  assert.equal(suggestSceneFilename({ name: '飞机: final/v2?' }, undefined, now), '飞机- final-v2-.json')
  assert.equal(suggestSceneFilename({ name: 'CON' }, undefined, now), 'scene_2026-10-21T11-52-55-906Z.json')
  assert.equal(suggestSceneFilename(null, undefined, now), 'scene_2026-10-21T11-52-55-906Z.json')
})

const compiled = await build({
  entryPoints: [fileURLToPath(new URL('../src/components/SaveScene.jsx', import.meta.url))],
  bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'react-dom'],
})

function harness(props) {
  const slots = [], effects = [], downloads = [], timers = [], blobs = [], revoked = []
  let index = 0, dirty = true, tree
  const priorFocus = { isConnected: true, focus() { document.activeElement = priorFocus } }
  const document = {
    activeElement: priorFocus,
    body: { appendChild(anchor) { anchor.attached = true } },
    createElement(tag) {
      assert.equal(tag, 'a')
      return { click() { downloads.push({ filename: this.download, url: this.href }) }, remove() { this.attached = false } }
    },
  }
  const same = (a, b) => !!a && a.length === b.length && a.every((item, i) => Object.is(item, b[i]))
  const react = {
    Fragment: Symbol('Fragment'),
    createElement(type, attributes, ...children) {
      const element = { type, props: attributes || {}, children: children.flat(), isConnected: true,
        focus() { document.activeElement = element }, select() { element.selected = true },
        querySelectorAll() { return descendants(element).filter(node => ['button', 'input'].includes(node.type) && !node.props.disabled) } }
      if (element.props.ref) element.props.ref.current = element
      return element
    },
    useState(initial) {
      const i = index++
      slots[i] ??= { value: initial }
      return [slots[i].value, next => { if (!Object.is(next, slots[i].value)) { slots[i].value = next; dirty = true } }]
    },
    useRef(initial) { const i = index++; slots[i] ??= { current: initial }; return slots[i] },
    useEffect(effect, deps) {
      const i = index++
      if (!same(slots[i]?.deps, deps)) {
        const previous = slots[i]
        slots[i] = { deps }
        effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = effect() })
      }
    },
  }
  function descendants(node) {
    if (!node || typeof node !== 'object') return []
    return [node, ...(node.children || []).flatMap(descendants)]
  }
  const url = { createObjectURL(blob) { blobs.push(blob); return `blob:test-${blobs.length}` }, revokeObjectURL(value) { revoked.push(value) } }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', 'document', 'URL', 'Blob', 'setTimeout', compiled.outputFiles[0].text)(
    name => name === 'react' ? react : { createPortal: child => child }, module, module.exports,
    document, url, Blob, callback => timers.push(callback),
  )
  const render = () => {
    let passes = 0
    while (dirty) {
      assert.ok(++passes < 15)
      dirty = false; index = 0; tree = module.exports.default(props)
      while (effects.length) effects.shift()()
    }
    return tree
  }
  const find = predicate => descendants(tree).find(predicate)
  render()
  return {
    downloads, blobs, revoked, document, priorFocus,
    act(callback) { callback(); render() },
    button(label) { return find(node => node.type === 'button' && node.children.includes(label)) },
    get input() { return find(node => node.type === 'input') },
    get form() { return find(node => node.type === 'form') },
    get overlay() { return find(node => node.props.className === 'ttcs-modal-overlay') },
    get alert() { return find(node => node.props.role === 'alert') },
    flushTimers() { while (timers.length) timers.shift()() },
  }
}

const scene = { name: 'Detailed Aircraft', type: 'cube', params: { width: 7 }, children: [] }
const event = () => ({ preventDefault() {}, stopPropagation() {} })

test('Save As opens a named dialog and cancel or Escape never downloads', () => {
  const h = harness({ scene })
  h.act(() => h.button('💾 Save As').props.onClick())
  assert.equal(h.input.props.value, 'Detailed Aircraft.json')
  assert.equal(h.document.activeElement, h.input)
  assert.ok(h.input.selected)
  assert.equal(h.form.props['aria-modal'], 'true')
  assert.equal(h.downloads.length, 0)
  h.act(() => h.button('Cancel').props.onClick())
  assert.equal(h.form, undefined)
  assert.equal(h.document.activeElement, h.priorFocus)
  h.act(() => h.button('💾 Save As').props.onClick())
  h.act(() => h.overlay.props.onKeyDown({ ...event(), key: 'Escape' }))
  assert.equal(h.form, undefined)
  assert.equal(h.downloads.length, 0)
})

test('Save As validation keeps the dialog open with a clear error and no download', () => {
  const h = harness({ scene })
  h.act(() => h.button('💾 Save As').props.onClick())
  h.act(() => h.input.props.onChange({ target: { value: 'bad/path' } }))
  h.act(() => h.form.props.onSubmit(event()))
  assert.ok(h.alert.children[0].includes('cannot contain'))
  assert.equal(h.input.props['aria-invalid'], true)
  assert.equal(h.downloads.length, 0)
  h.act(() => h.input.props.onChange({ target: { value: 'correct name' } }))
  assert.equal(h.alert, undefined)
  assert.equal(h.input.props['aria-invalid'], false)
})

test('Save As downloads exactly the chosen JSON name and preserves wrapped or raw scene data', async () => {
  for (const wrap of [true, false]) {
    const h = harness({ scene, filename: 'initial.json', wrap })
    h.act(() => h.button('💾 Save As').props.onClick())
    assert.equal(h.input.props.value, 'initial.json')
    h.act(() => h.input.props.onChange({ target: { value: '我的飞机' } }))
    h.act(() => h.form.props.onSubmit(event()))
    assert.equal(h.downloads.length, 1)
    assert.equal(h.downloads[0].filename, '我的飞机.json')
    assert.equal(await h.blobs[0].text(), JSON.stringify(wrap ? { scene } : scene, null, 2))
    assert.equal(h.blobs[0].type, 'application/json')
    assert.equal(h.form, undefined)
    assert.deepEqual(h.revoked, [])
    h.flushTimers()
    assert.deepEqual(h.revoked, ['blob:test-1'])
  }
})

test('the save dialog traps keyboard focus and cannot open without a scene', () => {
  const h = harness({ scene })
  h.act(() => h.button('💾 Save As').props.onClick())
  const save = h.button('Save')
  save.focus()
  h.act(() => h.overlay.props.onKeyDown({ ...event(), key: 'Tab' }))
  assert.equal(h.document.activeElement.props['aria-label'], 'Close save dialog')
  h.act(() => h.overlay.props.onKeyDown({ ...event(), key: 'Tab', shiftKey: true }))
  assert.equal(h.document.activeElement, save)
  const disabled = harness({ scene: null })
  assert.equal(disabled.button('💾 Save As').props.disabled, true)
  disabled.act(() => disabled.button('💾 Save As').props.onClick())
  assert.equal(disabled.form, undefined)
})
