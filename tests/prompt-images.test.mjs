import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { deflateSync } from 'node:zlib'
import { IMAGE_LIMITS, imageRevision } from '../src/generation/imageInputs.mjs'
import { MAX_IMAGE_SOURCE_BYTES, normalizePromptImage, imageByteSize, transferHasFiles, transferImageFiles } from '../src/utils/promptImages.mjs'

function png(index = 0, byteSize = 0) {
  function chunk(type, data) {
    const body = Buffer.concat([Buffer.from(type), data])
    let crc = 0xffffffff
    for (const value of body) {
      crc ^= value
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
    const size = Buffer.alloc(4), tail = Buffer.alloc(4)
    size.writeUInt32BE(data.length); tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
    return Buffer.concat([size, body, tail])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6
  const pixels = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0, index, 30, 200, 255])))])
  const end = chunk('IEND', Buffer.alloc(0))
  if (!byteSize) return Buffer.concat([pixels, end])
  const comment = Buffer.alloc(byteSize - pixels.length - end.length - 12, 65)
  Buffer.from('Comment\0').copy(comment)
  return Buffer.concat([pixels, chunk('tEXt', comment), end])
}
function file(index = 0, name = `reference-${index}.png`) {
  const value = new Blob([png(index)], { type: 'image/png' })
  Object.defineProperty(value, 'name', { value: name })
  return value
}
function image(index = 0, name, byteSize = 0) {
  return { name: name || `reference-${index}.png`, mimeType: 'image/png', dataUrl: `data:image/png;base64,${png(index, byteSize).toString('base64')}`, width: 1, height: 1 }
}
function decoder(width = 200, height = 100) {
  const state = { released: 0, decoded: 0 }
  state.decodeImage = async () => { state.decoded++; return { source: {}, width, height, release: () => state.released++ } }
  return state
}

test('clipboard image items are copied once while normal text and document files remain untouched', () => {
  const picture = file(), text = { name: 'notes.txt', type: 'text/plain' }
  assert.deepEqual(transferImageFiles({ items: [
    { kind: 'string', type: 'text/plain' }, { kind: 'file', getAsFile: () => picture },
  ], files: [picture] }), [picture])
  assert.deepEqual(transferImageFiles({ files: [text] }), [])
  assert.deepEqual(transferImageFiles({ files: [{ name: 'clip.PNG', type: '' }] }).map(item => item.name), ['clip.PNG'])
  assert.deepEqual(transferImageFiles({ items: [{ kind: 'file', getAsFile: () => null }], files: [picture] }), [picture])
  assert.equal(transferHasFiles({ types: ['Files'] }), true)
  assert.equal(transferHasFiles({ items: [{ kind: 'file' }] }), true)
  assert.equal(transferHasFiles({ types: ['text/plain'] }), false)
})

test('small image bytes are preserved and decoder resources are released', async () => {
  const d = decoder()
  const result = await normalizePromptImage(file(), d)
  assert.equal(result.dataUrl, image().dataUrl)
  assert.equal(result.mimeType, 'image/png')
  assert.deepEqual([result.width, result.height], [200, 100])
  assert.equal(d.released, 1)
  assert.equal(imageByteSize(result), png().length)
})

test('unsupported, empty and oversized source files fail before pixel decoding', async () => {
  const d = decoder()
  await assert.rejects(normalizePromptImage({ type: 'image/gif', size: 40 }, d), /PNG, JPEG or WebP/)
  await assert.rejects(normalizePromptImage({ type: 'image/png', size: 0 }, d), /empty/)
  await assert.rejects(normalizePromptImage({ type: 'image/png', size: MAX_IMAGE_SOURCE_BYTES + 1 }, d), /20 MB/)
  assert.equal(d.decoded, 0)
})

test('invalid dimensions and excessive pixel counts release the decoded image', async () => {
  for (const [width, height, pattern] of [[0, 1, /invalid dimensions/], [NaN, 1, /invalid dimensions/], [10000, 10000, /too large/]]) {
    const d = decoder(width, height)
    await assert.rejects(normalizePromptImage(file(), d), pattern)
    assert.equal(d.released, 1)
  }
})

test('large JPEG references resize from original pixels with a bounded long edge', async () => {
  const d = decoder(4000, 2000), calls = []
  const canvas = { getContext: () => ({ drawImage: (...args) => calls.push(args) }), toBlob: (done, type, quality) => {
    calls.push({ type, quality }); done(new Blob(['encoded'], { type }))
  } }
  const result = await normalizePromptImage({ name: 'wide.jpg', type: 'image/jpeg', size: 100 }, { ...d, createCanvas: () => canvas })
  assert.deepEqual([result.width, result.height], [1536, 768])
  assert.deepEqual(calls[1], { type: 'image/jpeg', quality: 0.9 })
  assert.equal(d.released, 1)
})

test('large transparent PNG references use WebP instead of discarding alpha into JPEG', async () => {
  const d = decoder(3000, 3000), types = []
  const canvas = { getContext: () => ({ drawImage() {} }), toBlob: (done, type) => {
    types.push(type)
    done(new Blob([new Uint8Array(type === 'image/png' ? IMAGE_LIMITS.maxImageBytes + 1 : 120)], { type }))
  } }
  const result = await normalizePromptImage(file(), { ...d, createCanvas: () => canvas })
  assert.deepEqual(types, ['image/png', 'image/webp'])
  assert.equal(result.mimeType, 'image/webp')
  assert.deepEqual([result.width, result.height], [1536, 1536])
  assert.equal(d.released, 1)
})

test('failed browser encoding reports a usable error and closes decoded pixels', async () => {
  const d = decoder(3000, 3000)
  const canvas = { getContext: () => ({ drawImage() {} }), toBlob: done => done(null) }
  await assert.rejects(normalizePromptImage(file(), { ...d, createCanvas: () => canvas }), /could not be prepared/)
  assert.equal(d.released, 1)
})

test('image preparation reduces dimensions when encoding quality alone cannot meet the size budget', async () => {
  const d = decoder(3000, 3000), sizes = []
  const canvas = { getContext: () => ({ drawImage: (_source, _x, _y, width) => sizes.push(width) }), toBlob: (done, type) => {
    done(new Blob([new Uint8Array(canvas.width > 1200 ? IMAGE_LIMITS.maxImageBytes + 1 : 100)], { type }))
  } }
  const result = await normalizePromptImage(file(), { ...d, createCanvas: () => canvas })
  assert.deepEqual(sizes, [1536, 1152])
  assert.equal(result.width, 1152)
  assert.ok(imageByteSize(result) <= IMAGE_LIMITS.maxImageBytes)
})

const asModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const reactURL = asModule(`export const useState=(...a)=>globalThis.__promptImageHarness.state(...a);
export const useRef=(...a)=>globalThis.__promptImageHarness.ref(...a);
export const useEffect=(...a)=>globalThis.__promptImageHarness.effect(...a);`)
const hookSource = (await readFile(new URL('../src/hooks/usePromptImages.jsx', import.meta.url), 'utf8'))
  .replace("'react'", JSON.stringify(reactURL))
  .replace("'../generation/imageInputs.mjs'", JSON.stringify(new URL('../src/generation/imageInputs.mjs', import.meta.url).href))
  .replace("'../utils/promptImages.mjs'", JSON.stringify(new URL('../src/utils/promptImages.mjs', import.meta.url).href))
const { default: usePromptImages } = await import(asModule(hookSource))

function harness(initial = {}) {
  const slots = [], effects = []
  let index = 0, dirty = true, props = initial, value
  const h = {
    state(initialValue) {
      const i = index++
      if (!slots[i]) slots[i] = { value: initialValue }
      return [slots[i].value, update => {
        const next = typeof update === 'function' ? update(slots[i].value) : update
        if (!Object.is(next, slots[i].value)) { slots[i].value = next; dirty = true }
      }]
    },
    ref(initialValue) { const i = index++; if (!slots[i]) slots[i] = { current: initialValue }; return slots[i] },
    effect(fn, deps) {
      const i = index++, previous = slots[i]
      if (!previous || deps.some((item, n) => !Object.is(item, previous.deps[n]))) {
        slots[i] = { deps, cleanup: previous?.cleanup }
        effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = fn() })
      }
    },
    flush(nextProps) {
      if (nextProps) { props = { ...props, ...nextProps }; dirty = true }
      globalThis.__promptImageHarness = h
      let loops = 0
      while (dirty) {
        assert.ok(++loops < 20)
        dirty = false; index = 0; value = usePromptImages(props)
        while (effects.length) effects.shift()()
      }
      return value
    },
    unmount() { for (const slot of slots) slot?.cleanup?.() },
  }
  h.flush()
  return h
}
const normalizeFile = async source => image(source.index || 0, source.name)
const sourceFile = (index = 0, name) => ({ index, name: name || `reference-${index}.png`, type: 'image/png' })
function event(transfer, field = 'clipboardData') {
  return { [field]: transfer, prevented: 0, stopped: 0, preventDefault() { this.prevented++ }, stopPropagation() { this.stopped++ } }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

test('attachment state deduplicates image bytes independently of names, and remove updates request identity', async () => {
  const h = harness({ normalizeFile })
  await h.flush().addFiles([sourceFile(1), sourceFile(1, 'renamed.png'), sourceFile(2)])
  let current = h.flush()
  assert.equal(current.images.length, 2)
  assert.equal(current.revision, imageRevision([image(1), image(2)]))
  current.remove(current.images[0].id)
  current = h.flush()
  assert.equal(current.revision, imageRevision([image(2)]))
  assert.equal(current.images.length, 1)
})

test('concurrent file batches accept nine distinct references and still deduplicate image bytes', async () => {
  const h = harness({ normalizeFile })
  await Promise.all([h.flush().addFiles([1, 2, 3, 4, 5].map(index => sourceFile(index))), h.flush().addFiles([6, 7, 8, 9].map(index => sourceFile(index)).concat(sourceFile(1, 'duplicate.png')))])
  let current = h.flush()
  assert.equal(current.images.length, 9)
  assert.equal(current.canAdd, false)
  assert.equal(current.loading, false)
  assert.equal(current.error, '')
  await current.addFiles([sourceFile(10)])
  current = h.flush()
  assert.equal(current.images.length, 9)
  assert.match(current.error, /up to 9 images/)
  current.remove(current.images[0].id)
  assert.equal(h.flush().canAdd, true)
  await h.flush().addFiles([sourceFile(10)])
  assert.equal(h.flush().images.length, 9)
  assert.equal(h.flush().error, '')
})

test('nine full-size processed images fit the aggregate byte budget exactly', async () => {
  const h = harness({ normalizeFile: async source => image(source.index, source.name, IMAGE_LIMITS.maxImageBytes) })
  await Promise.all([h.flush().addFiles([1, 2, 3, 4, 5].map(index => sourceFile(index))), h.flush().addFiles([6, 7, 8, 9].map(index => sourceFile(index)))])
  const current = h.flush()
  assert.equal(current.images.length, 9)
  assert.equal(current.images.reduce((sum, item) => sum + imageByteSize(item), 0), IMAGE_LIMITS.maxTotalBytes)
  assert.equal(current.canAdd, false)
  assert.equal(current.loading, false)
  assert.equal(current.error, '')
})

test('clearing while image decode is pending prevents stale attachment resurrection without blocking the next session', async () => {
  let completeFirst
  const h = harness({ normalizeFile: async source => source.index === 1 ? new Promise(resolve => { completeFirst = () => resolve(image(1)) }) : image(source.index) })
  const first = h.flush().addFiles([sourceFile(1)])
  await tick()
  assert.equal(h.flush().loading, true)
  h.flush().clear()
  await h.flush().addFiles([sourceFile(2)])
  completeFirst(); await first
  const current = h.flush()
  assert.equal(current.loading, false)
  assert.deepEqual(current.images.map(item => item.name), [image(2).name])
})

test('unmount discards pending image results', async () => {
  let finish
  const h = harness({ normalizeFile: () => new Promise(resolve => { finish = () => resolve(image(1)) }) })
  const pending = h.flush().addFiles([sourceFile(1)])
  await tick(); h.unmount(); finish()
  assert.deepEqual(await pending, [])
  assert.equal(h.flush().images.length, 0)
})

test('native paste intercepts image clipboard files, while Ctrl+V of text is left to the textarea', async () => {
  const h = harness({ normalizeFile })
  const picture = sourceFile(2)
  const paste = event({ items: [{ kind: 'file', type: 'image/png', getAsFile: () => picture }], files: [picture] })
  h.flush().composerProps.onPaste(paste)
  await tick()
  assert.deepEqual([paste.prevented, paste.stopped], [1, 1])
  assert.equal(h.flush().images.length, 1)
  const text = event({ types: ['text/plain'], items: [{ kind: 'string', type: 'text/plain' }] })
  h.flush().composerProps.onPaste(text)
  assert.deepEqual([text.prevented, text.stopped], [0, 0])
})

test('drag/drop highlights only file transfers, clears drag depth and attaches the image', async () => {
  const h = harness({ normalizeFile })
  const transfer = { types: ['Files'], files: [sourceFile(2)] }
  h.flush().composerProps.onDragEnter(event(transfer, 'dataTransfer'))
  h.flush().composerProps.onDragEnter(event(transfer, 'dataTransfer'))
  assert.equal(h.flush().composerProps['data-image-dragover'], true)
  h.flush().composerProps.onDragLeave(event(transfer, 'dataTransfer'))
  assert.equal(h.flush().composerProps['data-image-dragover'], true)
  const drop = event(transfer, 'dataTransfer')
  h.flush().composerProps.onDrop(drop)
  await tick()
  assert.equal(h.flush().composerProps['data-image-dragover'], false)
  assert.equal(h.flush().images.length, 1)
  assert.equal(drop.prevented, 1)
})

test('dropping an unsupported file prevents navigation and reports a local error', () => {
  const h = harness({ normalizeFile })
  const drop = event({ types: ['Files'], files: [{ name: 'notes.txt', type: 'text/plain' }] }, 'dataTransfer')
  h.flush().composerProps.onDrop(drop)
  assert.equal(drop.prevented, 1)
  assert.match(h.flush().error, /PNG, JPEG or WebP/)
})

test('busy callbacks block new attachments and removals without being invoked during render', async () => {
  let locked = false, checks = 0
  const h = harness({ normalizeFile, isDisabled: () => { checks++; return locked } })
  assert.equal(checks, 0)
  await h.flush().addFiles([sourceFile(1)])
  locked = true
  const current = h.flush()
  current.remove(current.images[0].id)
  await current.addFiles([sourceFile(2)])
  const paste = event({ files: [sourceFile(3)] })
  h.flush().composerProps.onPaste(paste)
  await tick()
  assert.equal(h.flush().images.length, 1)
  assert.equal(paste.prevented, 1)
  assert.ok(checks > 0)
})

test('completion clears submitted references only if the user has not changed attachments', async () => {
  const h = harness({ normalizeFile })
  await h.flush().addFiles([sourceFile(1)])
  const submitted = h.flush().images
  await h.flush().addFiles([sourceFile(2)])
  h.flush().clearIfCurrent(submitted)
  assert.equal(h.flush().images.length, 2)
  h.flush().clearIfCurrent(h.flush().images)
  assert.equal(h.flush().images.length, 0)
  assert.equal(h.flush().revision, '')
})

test('removing an image also suppresses a duplicate already decoding, while explicit reattachment remains possible', async () => {
  let finishDuplicate, delay = false
  const h = harness({ normalizeFile: async source => delay ? new Promise(resolve => { finishDuplicate = () => resolve(image(source.index)) }) : image(source.index) })
  await h.flush().addFiles([sourceFile(1)])
  delay = true
  const duplicate = h.flush().addFiles([sourceFile(1)])
  await tick()
  h.flush().remove(h.flush().images[0].id)
  finishDuplicate(); await duplicate
  assert.equal(h.flush().images.length, 0)
  delay = false
  await h.flush().addFiles([sourceFile(1)])
  assert.equal(h.flush().images.length, 1)
})

test('file picker copies the FileList before resetting its value, enabling the same file to be added again', async () => {
  const h = harness({ normalizeFile })
  const target = { files: [sourceFile(1)], value: 'C:\\fakepath\\reference-1.png' }
  h.flush().inputProps.onChange({ currentTarget: target })
  await tick()
  assert.equal(target.value, '')
  assert.equal(h.flush().images.length, 1)
  assert.match(h.flush().inputProps.accept, /image\/png/)
})
