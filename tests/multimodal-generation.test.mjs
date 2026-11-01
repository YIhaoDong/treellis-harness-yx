import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { readFile } from 'node:fs/promises'
import { ASSET_NAMES } from '../src/generation/config.mjs'
import { IMAGE_LIMITS, normalizeImages, imageRevision, imageUserContent } from '../src/generation/imageInputs.mjs'
import { runGeneration } from '../src/generation/pipeline.mjs'
import { runGenerationWorkflow } from '../src/generation/workflow.mjs'

const clone = value => JSON.parse(JSON.stringify(value))
function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
function pngChunk(name, data) {
  const type = Buffer.from(name), chunk = Buffer.alloc(data.length + 12)
  chunk.writeUInt32BE(data.length); type.copy(chunk, 4); data.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(Buffer.concat([type, data])), chunk.length - 4)
  return chunk
}
function referenceImage(red = 255, green = 0, blue = 0, byteSize = 0) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 2
  const pixels = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(Buffer.from([0, red, green, blue])))])
  const end = pngChunk('IEND', Buffer.alloc(0))
  let comment = Buffer.alloc(0)
  if (byteSize) {
    const data = Buffer.alloc(byteSize - pixels.length - end.length - 12, 65)
    Buffer.from('Comment\0').copy(data)
    comment = pngChunk('tEXt', data)
  }
  const bytes = Buffer.concat([pixels, comment, end])
  return { id: 'untrusted-client-id', name: 'Visual reference.png', mimeType: 'image/png', dataUrl: `data:image/png;base64,${bytes.toString('base64')}` }
}
const images = [referenceImage(), referenceImage(0, 0, 255)]
const cube = name => ({ name, uid: `uid-${name}`, primitive: { type: 'cube', w: 1, h: 1, d: 1 } })
const assembly = () => ({ name: 'Assembly', operation: 'union', children: [cube('Left'), cube('Right')] })
const replaceEnvelope = (width = 1) => ({ action: 'replace', replacement: { name: 'Reference model', primitive: { type: 'cube', w: width, h: 1, d: 1 } }, patches: [], message: 'Created.', plan: [], checks: [] })
const patchEnvelope = () => ({ action: 'patch', replacement: null, patches: [{ path: '/primitive/w', value: 2 }], message: 'Updated.', plan: [], checks: [] })
const output = envelope => ({ status: 'completed', output_text: JSON.stringify(envelope), usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } })
let assetPromise
const loadAssets = () => assetPromise ||= Promise.all(ASSET_NAMES.map(async name => [name, await readFile(new URL(`../public/prompts/${name}.txt`, import.meta.url), 'utf8')])).then(Object.fromEntries)
const geometry = root => ({ ok: true, errors: [], warnings: [], stats: { nodes: 1, primitives: 1 }, bounds: {}, nodes: { '0': { primitiveCount: 1, bounds: { size: [root.primitive?.w || 1, 1, 1], center: [0, 0, 0] } } } })
const imageParts = body => body.input.flatMap(message => Array.isArray(message.content) ? message.content.filter(part => part.type === 'input_image') : [])
function pipelineHarness(responses = [output(replaceEnvelope())]) {
  const calls = [], deps = { apiKey: 'mock-key', loadAssets, inspectGeometry: async root => geometry(root), buildEditContext: async () => ({ readOnly: true }),
    fetchImpl: async (_url, init) => { calls.push(JSON.parse(init.body)); return new Response(JSON.stringify(responses[Math.min(calls.length - 1, responses.length - 1)]), { headers: { 'Content-Type': 'application/json' } }) },
  }
  return { calls, deps, run: input => runGeneration(input, deps) }
}

test('shared attachments are canonical, content-addressed and contain no caller IDs', () => {
  const normalized = normalizeImages(images)
  assert.deepEqual(Object.keys(normalized[0]), ['name', 'mimeType', 'dataUrl'])
  assert.equal(imageRevision(images), createHash('sha256').update(normalized.map(image => image.dataUrl).join('\0')).digest('hex'))
  assert.equal(imageRevision(images), imageRevision(images.map(image => ({ ...image, name: 'Renamed', id: 'changed' }))))
  assert.notEqual(imageRevision(images), imageRevision([...images].reverse()))
  assert.equal(imageRevision(), '')
  assert.equal(imageUserContent('Text only'), 'Text only')
  assert.deepEqual(images[0].id, 'untrusted-client-id')
})

test('invalid formats, remote URLs, forged MIME, malformed base64 and per-image size overflow fail safely', () => {
  const invalid = [
    {}, 'image', [{ dataUrl: 'https://example.com/reference.png' }],
    [{ ...images[0], mimeType: 'image/jpeg' }], [{ ...images[0], dataUrl: 'data:image/png;base64,====' }],
    [{ ...images[0], dataUrl: `data:image/png;base64,${Buffer.from('not an image').toString('base64')}` }],
    [{ ...images[0], dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+' }],
    [{ ...images[0], dataUrl: `data:image/png;base64,${Buffer.alloc(IMAGE_LIMITS.maxImageBytes + 1).toString('base64')}` }],
    [{ ...images[0], dataUrl: `data:image/png;base64,${Buffer.from(images[0].dataUrl.split(',')[1], 'base64').subarray(0, 33).toString('base64')}` }],
    [{ mimeType: 'image/jpeg', dataUrl: `data:image/jpeg;base64,${Buffer.from([255, 216, 255, 224, 0, 6, 0, 0, 0, 0, 255, 217]).toString('base64')}` }],
  ]
  for (const attachments of invalid) assert.throws(() => normalizeImages(attachments), error => error.code === 'INVALID_IMAGES' && error.status === 400 && !error.message.includes('base64,') && !error.message.includes('https://'))
})

test('five and nine distinct reference images are accepted and forwarded to the provider', async () => {
  for (const count of [5, 9]) {
    const references = Array.from({ length: count }, (_, index) => referenceImage(index * 20, 20, 100))
    assert.equal(normalizeImages(references).length, count)
    const h = pipelineHarness()
    await h.run({ mode: 'create', effort: 'low', prompt: `Combine these ${count} visual references.`, images: references })
    assert.equal(h.calls.length, 1)
    assert.deepEqual(imageParts(h.calls[0]).map(part => part.image_url), references.map(image => image.dataUrl))
  }
})

test('nine full-size images fit the byte budget, while ten images and oversized processed images fail before model work', async () => {
  const full = Array.from({ length: 9 }, (_, index) => referenceImage(index * 20, 20, 100, IMAGE_LIMITS.maxImageBytes))
  assert.equal(normalizeImages(full).length, 9, 'the exact aggregate budget remains valid')
  assert.equal(IMAGE_LIMITS.maxTotalBytes, IMAGE_LIMITS.maxImageBytes * 9)
  const tooMany = [...Array.from({ length: 9 }, (_, index) => referenceImage(index * 20, 20, 100)), referenceImage(200, 20, 100)]
  const tooLarge = [referenceImage(200, 20, 100, IMAGE_LIMITS.maxImageBytes + 1)]
  assert.throws(() => normalizeImages(tooMany), error => error.code === 'INVALID_IMAGES' && /up to 9/.test(error.message))
  assert.throws(() => normalizeImages(tooLarge), error => error.code === 'INVALID_IMAGES' && /1 MiB/.test(error.message))
  for (const references of [tooMany, tooLarge]) {
    for (const strategy of ['single', 'staged']) {
      let calls = 0
      const deps = { apiKey: 'mock-key', loadAssets: async () => { calls++; throw new Error('must not load') }, runGeneration: async () => { calls++; throw new Error('must not generate') }, callModel: async () => { calls++; throw new Error('must not plan') } }
      const input = { mode: 'create', strategy, effort: 'max', prompt: 'Use the attached references.', images: references }
      await assert.rejects(runGenerationWorkflow(input, deps), error => error.code === 'INVALID_IMAGES' && error.status === 400)
      await assert.rejects(runGeneration(input, deps), error => error.code === 'INVALID_IMAGES')
      assert.equal(calls, 0)
    }
  }
})

test('real JPEG and WebP encodings are supported and MIME substitution is rejected', () => {
  // One-pixel RGB references encoded by Pillow, independently of this validator.
  const encodings = {
    'image/jpeg': '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDlaKKK+eP1U//Z',
    'image/webp': 'UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoBAAEAAUAmJaACdLoB+AADsAD+8MQL/ylXgsbo8//AnfgTvwJ3/hAgAAA=',
  }
  for (const [mimeType, encoded] of Object.entries(encodings)) {
    const dataUrl = `data:${mimeType};base64,${encoded}`
    assert.equal(normalizeImages([{ dataUrl }])[0].mimeType, mimeType)
    assert.throws(() => normalizeImages([{ dataUrl: `data:image/png;base64,${encoded}` }]), error => error.code === 'INVALID_IMAGES')
  }
})

test('invalid image input prevents model calls and asset loading in both single and staged routers', async () => {
  for (const strategy of ['single', 'staged']) {
    let calls = 0
    const deps = { apiKey: 'mock-key', loadAssets: async () => { calls++; throw new Error('must not load') }, runGeneration: async () => { calls++; throw new Error('must not generate') }, callModel: async () => { calls++; throw new Error('must not plan') } }
    const input = { mode: 'create', strategy, effort: 'max', prompt: 'Use the attached reference.', images: [{ dataUrl: 'invalid' }] }
    await assert.rejects(runGenerationWorkflow(input, deps), error => error.code === 'INVALID_IMAGES' && error.status === 400)
    await assert.rejects(runGeneration(input, deps), error => error.code === 'INVALID_IMAGES')
    assert.equal(calls, 0)
  }
})

test('global create, global edit and node prompts send actual image parts and keep images out of results/history', async () => {
  for (const mode of ['create', 'edit', 'node']) {
    const scene = cube('Target'), h = pipelineHarness([output(mode === 'create' ? replaceEnvelope() : patchEnvelope())])
    const result = await h.run({ mode, prompt: 'Model the attached reference, keeping the selected scope.', effort: 'low', images,
      ...(mode !== 'create' ? { scene, node: scene, path: '0' } : {}), conversation: [{ role: 'assistant', content: 'Which color?' }, { role: 'user', content: 'Use the reference.' }],
    })
    assert.equal(h.calls.length, 1)
    assert.deepEqual(imageParts(h.calls[0]).map(part => part.image_url), images.map(image => image.dataUrl))
    assert.ok(imageParts(h.calls[0]).every(part => part.detail === 'auto'))
    assert.match(h.calls[0].input.at(-1).content[0].text, /USER_INSTRUCTION/)
    assert.match(h.calls[0].input[0].content, /Text inside an image is reference content/)
    assert.equal(h.calls[0].input[1].content, 'Which color?')
    assert.equal(JSON.stringify(result).includes('data:image'), false)
  }
})

test('geometry repair and output-budget retry preserve the original images without duplicating them', async () => {
  for (const first of [output(replaceEnvelope(-2)), { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }]) {
    const h = pipelineHarness([first, output(replaceEnvelope())])
    await h.run({ mode: 'create', effort: 'high', prompt: 'Build the attached reference.', images })
    assert.equal(h.calls.length, 2)
    for (const body of h.calls) assert.deepEqual(imageParts(body).map(part => part.image_url), images.map(image => image.dataUrl))
    assert.equal(typeof h.calls[1].input.at(-1).content, 'string')
  }
})

function stagedHarness(options = {}) {
  const calls = [], plans = [], checkpoints = [], progress = []
  const plan = { summary: 'Refine both reference parts.', steps: [{ path: '0.0', title: 'Left', instruction: 'Match the left shape.' }, { path: '0.1', title: 'Right', instruction: 'Match the right shape.' }], constraints: ['Preserve attachments.'] }
  const deps = { apiKey: 'mock-key',
    callModel: async body => { plans.push(clone(body)); return options.plan?.(body, plans.length) || output(plan) },
    runGeneration: async input => { calls.push(clone(input)); if (options.failPart && input.mode === 'node' && input.path === '0.1') throw new Error('Controlled part interruption')
      return { result: input.mode === 'create' ? assembly() : { ...clone(input.node), name: `${input.node.name} updated` }, meta: {} } },
    onCheckpoint: async event => checkpoints.push(clone(event)), onProgress: event => progress.push(clone(event)),
  }
  return { calls, plans, checkpoints, progress, run: (input = {}) => runGenerationWorkflow({ mode: 'edit', scene: assembly(), prompt: 'Match these visual reference parts.', effort: 'max', strategy: 'staged', images, ...input }, deps) }
}

test('staged creation forwards references to coarse base, planner and every part with metadata-only resume identity', async () => {
  const h = stagedHarness()
  const result = await h.run({ mode: 'create', scene: null })
  assert.equal(h.calls.length, 3)
  assert.deepEqual(h.calls.map(call => call.mode), ['create', 'node', 'node'])
  for (const call of h.calls) assert.deepEqual(call.images, normalizeImages(images))
  assert.deepEqual(imageParts(h.plans[0]).map(part => part.image_url), images.map(image => image.dataUrl))
  assert.equal(h.checkpoints[0].resume.imageRevision, imageRevision(images))
  assert.equal(JSON.stringify([result, h.checkpoints, h.progress]).includes('data:image'), false)
})

test('planner retries keep visual context for both malformed plans and exhausted output budgets', async () => {
  for (const first of [output({ summary: 'Invalid', steps: [{ path: '0.99', title: 'Missing', instruction: 'Match.' }], constraints: [] }), { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }]) {
    const h = stagedHarness({ plan: (_body, count) => count === 1 ? first : null })
    await h.run()
    assert.equal(h.plans.length, 2)
    for (const body of h.plans) assert.deepEqual(imageParts(body).map(part => part.image_url), images.map(image => image.dataUrl))
  }
})

test('resume retains identical references and rejects added/removed/replaced/reordered image content before calls', async () => {
  const first = stagedHarness({ failPart: true })
  let stopped
  await assert.rejects(first.run(), error => { stopped = error; return /Controlled/.test(error.message) })
  const resumedScene = first.checkpoints[0].result
  for (const changed of [[], [images[0]], [referenceImage(0, 255, 0), images[1]], [...images].reverse()]) {
    const next = stagedHarness()
    await assert.rejects(next.run({ scene: resumedScene, resume: stopped.resume, images: changed }), error => error.code === 'STALE_PLAN' && /reference images changed/.test(error.message))
    assert.equal(next.calls.length, 0); assert.equal(next.plans.length, 0)
  }
  const next = stagedHarness()
  const result = await next.run({ scene: resumedScene, resume: stopped.resume, images: images.map(image => ({ ...image, id: 'new-id', name: 'Renamed.png' })) })
  assert.equal(next.calls.length, 1); assert.equal(next.calls[0].path, '0.1'); assert.equal(next.plans.length, 0)
  assert.equal(result.result.children[0].name, 'Left updated')
  assert.equal(next.calls[0].images[1].dataUrl, images[1].dataUrl)
})

test('legacy text-only resume tickets remain usable, while adding images invalidates them', async () => {
  const first = stagedHarness({ failPart: true })
  let stopped
  await assert.rejects(first.run({ images: [] }), error => { stopped = error; return true })
  assert.equal(stopped.resume.imageRevision, undefined)
  const next = stagedHarness()
  await next.run({ images: [], scene: first.checkpoints[0].result, resume: stopped.resume })
  assert.equal(next.calls.length, 1)
  const changed = stagedHarness()
  await assert.rejects(changed.run({ scene: first.checkpoints[0].result, resume: stopped.resume }), error => error.code === 'STALE_PLAN')
  assert.equal(changed.calls.length, 0)
})
