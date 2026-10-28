import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { summarizeScenePalette } from '../src/generation/palette.mjs'
import { buildEditContext } from '../src/generation/geometry.mjs'
import { runGeneration } from '../src/generation/pipeline.mjs'
import { ASSET_NAMES } from '../src/generation/config.mjs'

const cube = (name, color) => ({ name, primitive: { type: 'cube', w: 1, h: 1, d: 1, ...(color === undefined ? {} : { material: { color } }) } })
const clone = value => JSON.parse(JSON.stringify(value))
const scene = () => ({ name: 'Aircraft', operation: 'union', children: [
  cube('Engine', '#fdceff'),
  { name: 'Wing assembly', operation: 'union', children: [cube('Dark mounting plate', '#122334'), cube('Blue wing', '#c7e7ff')] },
] })

test('node context includes actual outside-subtree colors with limited source names and paths', () => {
  const root = scene(), before = JSON.stringify(root)
  const context = buildEditContext(root, '0.0')
  assert.equal(context.selectedPath, '0.0')
  assert.equal(context.scenePalette.readOnly, true)
  const dark = context.scenePalette.colors.find(item => item.color === '#122334')
  assert.deepEqual(dark.sources, [{ path: '0.1.0', name: 'Dark mounting plate' }])
  assert.ok(context.scenePalette.colors.some(item => item.color === '#FDCEFF'))
  assert.ok(context.scenePalette.colors.some(item => item.color === '#C7E7FF'))
  assert.equal(JSON.stringify(root), before)
  assert.equal(context.scenePalette.scanTruncated, false)
})

test('palette summaries have no live scene references, geometry payload or invented dark colors', () => {
  const root = scene(), before = JSON.stringify(root)
  root.children[0].editorPrivate = { token: 'PRIVATE_METADATA_MUST_NOT_APPEAR' }
  const palette = summarizeScenePalette(root, '0.0')
  assert.ok(palette.colors.every(item => Object.keys(item).sort().join(',') === 'color,sources'))
  assert.ok(palette.colors.flatMap(item => item.sources).every(source => Object.keys(source).sort().join(',') === 'name,path'))
  assert.doesNotMatch(JSON.stringify(palette), /primitive|transform|PRIVATE_METADATA/)
  palette.colors[0].color = '#000000'
  palette.colors[0].sources[0].name = 'Changed in context only'
  palette.colors.length = 0
  assert.equal(root.children[0].primitive.material.color, '#fdceff')
  delete root.children[0].editorPrivate
  assert.equal(JSON.stringify(root), before)
  const pastel = summarizeScenePalette({ name: 'Pastels', children: [cube('Pink', '#fdceff'), cube('Green', '#d8ffd4')] })
  assert.deepEqual(pastel.colors.map(item => item.color), ['#FDCEFF', '#D8FFD4'])
  assert.ok(!pastel.colors.some(item => item.color === '#000000'))
})

test('colors are case-insensitively deduplicated and missing or invalid values are not scene facts', () => {
  const values = ['#aAbBcC', '#AABBCC', '#abc', 'blue', ' #123456', '#123456 ', '123456', '#12345g', null, 0x123456, {}, undefined]
  const palette = summarizeScenePalette({ children: values.map((color, i) => cube(`Source ${i}`, color)) })
  assert.deepEqual(palette.colors, [{ color: '#AABBCC', sources: [{ path: '0.0', name: 'Source 0' }, { path: '0.1', name: 'Source 1' }] }])
  assert.equal(palette.omittedSources, 0)
  assert.deepEqual(summarizeScenePalette({ children: [cube('No color')] }).colors, [])
  assert.deepEqual(summarizeScenePalette(null).colors, [])
  assert.deepEqual(summarizeScenePalette({ scene: cube('Wrapped', '#112233') }).colors, [{ color: '#112233', sources: [{ path: '0', name: 'Wrapped' }] }])
})

test('palette bounds retain outside references even when the selected subtree has many distinct colors', () => {
  const color = number => `#${number.toString(16).padStart(6, '0')}`
  const root = { children: [
    { name: 'Selected', children: Array.from({ length: 64 }, (_, i) => cube('s'.repeat(200), color(i + 1))) },
    { name: 'Outside', children: Array.from({ length: 64 }, (_, i) => cube('o'.repeat(200), color(i + 101))) },
  ] }
  const palette = summarizeScenePalette(root, { scopePath: '0.0', preferredPaths: ['0.1.63'] })
  assert.equal(palette.colors.length, 16)
  assert.equal(palette.omittedColors, 112)
  assert.ok(palette.colors.some(item => item.sources.some(source => source.path.startsWith('0.0.'))))
  assert.ok(palette.colors.some(item => item.sources.some(source => source.path === '0.1.63')))
  assert.ok(palette.colors.flatMap(item => item.sources).every(source => source.name.length <= 80))
  assert.ok(JSON.stringify(palette).length < 10000)
  const repeated = summarizeScenePalette({ children: Array.from({ length: 30 }, (_, i) => cube(`Source ${i}`, '#778899')) }, '0.0')
  assert.equal(repeated.colors[0].sources.length, 3)
  assert.equal(repeated.omittedSources, 27)
})

test('palette traversal is bounded for excessive depth, size and shared or cyclic objects', () => {
  const shared = cube('Shared', '#112233')
  const cyclic = { children: [shared, shared] }
  cyclic.children.push(cyclic)
  assert.equal(summarizeScenePalette(cyclic).colors.length, 1)
  let deep = cube('Deep', '#112233')
  for (let i = 0; i < 40; i++) deep = { children: [deep] }
  assert.equal(summarizeScenePalette(deep).scanTruncated, true)
  const huge = summarizeScenePalette({ children: Array.from({ length: 5000 }, (_, i) => cube(`Part ${i}`, '#112233')) })
  assert.equal(huge.scanTruncated, true)
  assert.equal(huge.colors[0].sources.length, 3)
})

test('outside palette context reaches the node model without expanding its editable scope', async () => {
  const root = scene(), before = JSON.stringify(root)
  let captured, inspected = false
  const loadAssets = async () => Object.fromEntries(await Promise.all(ASSET_NAMES.map(async name => [name, await readFile(new URL(`../public/prompts/${name}.txt`, import.meta.url), 'utf8')])))
  await assert.rejects(runGeneration({ mode: 'node', scene: root, node: root.children[0], path: '0.0', prompt: 'Add small engine details matching nearby colors.', effort: 'max' }, {
    apiKey: 'mock-key', maxRepairs: 0, loadAssets, buildEditContext,
    inspectGeometry: async () => { inspected = true; throw new Error('Out-of-scope patch must be rejected before geometry') },
    fetchImpl: async (_url, init) => {
      captured = JSON.parse(init.body)
      const envelope = { action: 'patch', replacement: null, patches: [{ path: '/children/1/children/0/primitive/material/color', value: '#000000' }], message: 'Changed an outside color.', suggestions: [], plan: [], checks: [] }
      return new Response(JSON.stringify({ id: 'resp_palette', status: 'completed', output_text: JSON.stringify(envelope) }), { headers: { 'Content-Type': 'application/json' } })
    },
  }), error => error.code === 'VALIDATION_FAILED' && /outside the selected scope/.test(error.message))
  const userContext = captured.input.filter(message => message.role === 'user').map(message => message.content).join('\n')
  assert.match(userContext, /scenePalette/)
  assert.match(userContext, /#122334/)
  assert.match(userContext, /Dark mounting plate/)
  assert.match(userContext, /read-only/)
  assert.equal(inspected, false)
  assert.equal(JSON.stringify(root), before)
  assert.deepEqual(root, clone(root))
})
